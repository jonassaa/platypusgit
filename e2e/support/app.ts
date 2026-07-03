import { browser, $ } from "@wdio/globals";

/** Kill the embedded driver's 5s-per-command latency.
 *
 * The tauri-service runs a window-focus check before every find/click
 * protocol command. That check executes a script which requires
 * `window.__wdio_original_core__` — normally set by the `@wdio/tauri-plugin`
 * guest JS, which this app deliberately does not ship. Without it, every
 * find/click paid a 5s in-page wait (measured 5-30s per command; the whole
 * suite took ~13min). The E2E build enables `withGlobalTauri`
 * (src-tauri/tauri.e2e.conf.json), so the real core API is on the page and we
 * can hand it to the driver ourselves. `browser.execute` is exempt from the
 * focus check, so this bootstrap itself is fast.
 *
 * Page globals reset on every (re)load — call this after each refresh and
 * once at session start (wdio.conf.ts `before` hook).
 *
 * Reload race (why this isn't a one-shot execute): `browser.refresh()` can
 * resolve before the embedded driver's "current document" actually points
 * at the newly loaded page — the outgoing document is still fully parsed
 * (`readyState === "complete"`) and, since `withGlobalTauri` injects
 * `window.__TAURI__` from a head script, it ALSO still has a live
 * `__TAURI__.core`. So a naive check succeeds instantly against the dying
 * document: `__wdio_original_core__` gets set there, that document is torn
 * down a moment later, and the real post-refresh document never gets armed
 * — every command for the rest of the test then pays the 5s poll (observed:
 * 22min instead of ~1min). `waitUntil` retrying the same check doesn't fix
 * this by itself, because the very first attempt is the one that falsely
 * "succeeds".
 *
 * There's no reliable in-page signal that survives a full document swap
 * (window state resets on navigation, by design), so this can't be solved
 * by polling harder inside a single armed state. Instead, callers must
 * re-arm once they have independent proof — a real DOM query that matched —
 * that navigation has settled on the final document. See the re-arm calls
 * in `resetApp`/`waitRepoLoaded` below: the *first* find after a refresh may
 * still pay a one-off slow poll (bounded — it's one element appearing), but
 * every command after that point is guaranteed post-arm. */
export async function armDriverBridge(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        if (document.readyState !== "complete") return false;
        const w = window as unknown as Record<string, any>;
        const core = w.__TAURI__?.core;
        if (!core?.invoke) return false;
        w.__wdio_original_core__ = core;
        // Read back via `window` (not the closed-over `core` local) so a
        // same-tick realm teardown — the execute call's document getting
        // swapped out between the assignment and this line — shows up as a
        // mismatch/throw here instead of silently reporting success.
        return w.__wdio_original_core__?.invoke === core.invoke;
      }),
    {
      timeout: 20_000,
      interval: 100,
      timeoutMsg:
        "window.__TAURI__.core.invoke never appeared — was the e2e binary built with --config src-tauri/tauri.e2e.conf.json (withGlobalTauri)?",
    },
  );
}

export async function resetApp(): Promise<void> {
  await browser.execute(() => localStorage.clear());
  await browser.refresh();
  await armDriverBridge();
  await $("div*=Welcome to PlatypusGit").waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "Welcome screen did not reappear after reset",
  });
  // Re-arm: this find only succeeds once the document has settled on the
  // real post-refresh page, which is the earliest point we can trust that
  // an arm attempt actually lands (and stays) there. See armDriverBridge
  // doc for why the pre-Welcome arm above can't be trusted on its own.
  await armDriverBridge();
}

export async function waitRepoLoaded(): Promise<void> {
  // Welcome gone + repo chrome present
  await $('[data-testid="branch-chip"]').waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "branch chip never appeared after opening repo",
  });
  // Re-arm here too: the syncing-poll loop below can run many iterations,
  // and this is the first point after opening a repo where we know for
  // certain we're on the settled document (see armDriverBridge doc).
  await armDriverBridge();
  // initial status/log fetch done — status bar's "syncing…" PGStatusItem
  // renders its label in a <span>, so scope the text selector (bare `*=`
  // is partial-LINK-text and only matches anchors).
  await browser.waitUntil(
    async () => !(await $("span*=syncing").isExisting()),
    { timeout: 20_000, timeoutMsg: "app stuck syncing" },
  );
}

export async function openRepo(repoPath: string): Promise<void> {
  await browser.execute((p: string) => {
    localStorage.clear();
    localStorage.setItem(
      "pg-recent-repos",
      JSON.stringify([{ path: p, openedAt: 1 }]),
    );
  }, repoPath);
  await browser.refresh();
  await armDriverBridge();
  const row = $(`[data-testid="recent-repo"][data-path="${repoPath}"]`);
  await row.waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "recent-repo row for temp repo never appeared",
  });
  // Re-arm: same reasoning as resetApp — this find is the first proof the
  // post-refresh document is the one that's actually current.
  await armDriverBridge();
  await row.click();
  await waitRepoLoaded();
}

/** Reload the page WITHOUT clearing localStorage, then reopen the repo via
 *  its recent-row. This is the persistence-test primitive: `openRepo` starts
 *  with `localStorage.clear()`, which would wipe pg-settings-v2 and defeat
 *  any "survives reload" assertion. Follows the re-arm rule: matched find →
 *  re-arm (see armDriverBridge doc). */
export async function reopenRepo(repoPath: string): Promise<void> {
  await browser.refresh();
  await armDriverBridge();
  const row = $(`[data-testid="recent-repo"][data-path="${repoPath}"]`);
  await row.waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "recent-repo row missing after reload — recents not persisted?",
  });
  await armDriverBridge();
  await row.click();
  await waitRepoLoaded();
}

/** WebDriver can't drive native prompt/confirm — stub them in-page BEFORE the
 *  action that triggers them. Reset by any refresh.
 *  `promptQueue`: successive `window.prompt` calls consume queue entries in
 *  order (Add remote fires TWO prompts: name, then URL — a single string
 *  would set name === url). Falls back to `promptText` when drained.
 *  Confirm calls are counted on `window.__pgConfirmCalls` — read it via
 *  `confirmCallCount()` to prove a confirm gate fired (or didn't). */
export async function stubNativeDialogs(
  opts: { promptText?: string; confirm?: boolean; promptQueue?: string[] } = {},
): Promise<void> {
  await browser.execute(
    (promptText: string | null, confirm: boolean, queue: string[]) => {
      const q = [...queue];
      (window as any).__pgConfirmCalls = 0;
      (window as any).prompt = () => (q.length ? q.shift()! : promptText);
      (window as any).confirm = () => {
        (window as any).__pgConfirmCalls++;
        return confirm;
      };
    },
    opts.promptText ?? "e2e",
    opts.confirm ?? true,
    opts.promptQueue ?? [],
  );
}

export function confirmCallCount(): Promise<number> {
  return browser.execute(() => (window as any).__pgConfirmCalls ?? 0);
}

export async function switchScreen(id: string): Promise<void> {
  await $(`[data-activity="${id}"]`).click();
}

export const stagedRow = (p: string) =>
  $(`[data-testid="staged-list"] [data-path="${p}"]`);
export const changeRow = (p: string) =>
  $(`[data-testid="changes-list"] [data-path="${p}"]`);

/** Open a context menu via an in-page `contextmenu` MouseEvent.
 *
 * This is the one interaction that cannot be a real WebDriver action: the
 * embedded driver's actions endpoint only synthesizes mousedown/mouseup/
 * click events and never `contextmenu` (verified in
 * tauri-plugin-wdio-webdriver 1.2.0 executor source and empirically —
 * `click({ button: "right" })` completes without error but no menu opens). */
export const jsContextMenu = (selector: string, opts?: { text?: string }) =>
  browser.execute(
    (sel: string, text: string | undefined) => {
      const candidates = Array.from(document.querySelectorAll(sel));
      const el = (
        text
          ? candidates.find((c) => c.textContent?.includes(text))
          : candidates[0]
      ) as HTMLElement | undefined;
      if (!el) {
        throw new Error(
          `jsContextMenu: element not found: ${sel}${text ? ` (text: ${text})` : ""}`,
        );
      }
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
          button: 2,
        }),
      );
    },
    selector,
    opts?.text,
  );

/** Click an open context-menu item by its label-span text (menus are
 *  portals rendered to document.body, so a plain CSS selector on the label
 *  text is the reliable way to find them). */
export async function jsClickMenuItem(label: string): Promise<void> {
  const ok = await browser.execute((text: string) => {
    const spans = Array.from(document.querySelectorAll("span"));
    const el = spans.find((s) => s.textContent === text);
    if (!el) return false;
    const target = (el.closest("div") as HTMLElement | null) ?? (el as HTMLElement);
    target.click();
    return true;
  }, label);
  if (!ok) throw new Error(`menu item not found: ${label}`);
}

/** Hover a context-menu item to open its submenu (menus are portals; the
 *  driver can't hover, so dispatch the events React listens for). */
export async function jsHoverMenuItem(label: string): Promise<void> {
  const ok = await browser.execute((text: string) => {
    const spans = Array.from(document.querySelectorAll("span"));
    const el = spans.find((s) => s.textContent === text);
    if (!el) return false;
    const target = el.closest("div") ?? el;
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    return true;
  }, label);
  if (!ok) throw new Error(`menu item not found for hover: ${label}`);
}

/** The command palette dialog and its query input. The dialog is portaled to
 *  document.body — always scope palette selectors under paletteDialog so they
 *  can't match screen content behind it. */
export const paletteDialog = '[role="dialog"][aria-label="Command palette"]';
export const paletteInput = `${paletteDialog} input`;

/** Open the palette. AppShell listens for ⌘P on `window`
 *  (src/AppShell.tsx), so an in-page KeyboardEvent dispatch is deterministic
 *  — no reliance on the embedded driver synthesizing Meta-key chords. */
export async function openPalette(): Promise<void> {
  await browser.execute(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true }),
    );
  });
  await $(paletteDialog).waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: "command palette did not open on synthesized ⌘P",
  });
}

/** Dispatch a keydown (Enter / Escape / ArrowDown / …) on an element.
 *  CommandPalette handles keys via React onKeyDown on the dialog; a bubbling
 *  native KeyboardEvent reaches React's root-delegated listener. Use this for
 *  control keys; use setValue() for typing text. */
export async function jsKey(selector: string, key: string): Promise<void> {
  const ok = await browser.execute(
    (sel: string, k: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return false;
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
      return true;
    },
    selector,
    key,
  );
  if (!ok) throw new Error(`jsKey: element not found: ${selector}`);
}
