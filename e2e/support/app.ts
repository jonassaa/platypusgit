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

/** macOS focus self-heal (issue #32).
 *
 * The e2e debug binary is unbundled and doesn't reliably win foreground
 * focus at launch. When another app (e.g. Remote Desktop) holds foreground,
 * WKWebView reports `document.visibilityState === "hidden"` /
 * `document.hasFocus() === false`, and WebDriver's isDisplayed() returns
 * false for elements that exist in the DOM — waits then die with "... never
 * appeared". @wdio/tauri-service's own self-heal (ensureActiveWindowFocus)
 * can't help: it invokes `plugin:wdio|get_window_states`, which
 * tauri-plugin-wdio-webdriver 1.2.0 (latest as of 2026-07) does not ship —
 * and our wdio.conf disables that check anyway (see guard 1 there).
 *
 * So we self-heal here: if the page reports unfocused/hidden, call the
 * window's own `setFocus()` through the global Tauri API. On macOS that is
 * tao's `makeKeyAndOrderFront` + `activateIgnoringOtherApps:YES` — forces
 * activation over whatever app holds foreground, no Automation/TCC prompt
 * (unlike osascript). Requires `core:window:allow-set-focus`, granted by the
 * e2e-only inline capability in src-tauri/tauri.e2e.conf.json.
 *
 * No-op off macOS: Linux CI (xvfb) never loses focus and must not be
 * touched. Cheap when already focused (one execute, no setFocus call), so
 * it runs at session start AND before every test (wdio.conf hooks) to heal
 * mid-suite focus steals too. Call sites assume an armed, settled page —
 * don't call it mid-refresh. */
export async function ensureMacAppFocus(): Promise<void> {
  if (process.platform !== "darwin") return;
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const focused =
          document.visibilityState === "visible" && document.hasFocus();
        if (!focused) {
          const w = window as unknown as Record<string, any>;
          // Fire-and-forget: focus lands asynchronously (main-thread hop in
          // tao); the next poll observes it. Swallow rejection so a missing
          // permission surfaces as this wait's timeoutMsg, not an unhandled
          // rejection in the page.
          w.__TAURI__?.window
            ?.getCurrentWindow?.()
            ?.setFocus?.()
            ?.catch?.(() => {});
        }
        return focused;
      }),
    {
      timeout: 15_000,
      interval: 250,
      timeoutMsg:
        "webview never reported visible+focused after setFocus() retries — " +
        "is core:window:allow-set-focus granted (src-tauri/tauri.e2e.conf.json " +
        "e2e-focus capability), and was the binary rebuilt with that config?",
    },
  );
}

/** Reload the page, wait for `gate` to match, then re-arm the bridge.
 *
 *  **The only place in `e2e/` allowed to call `browser.refresh()`** — pinned by
 *  `test/e2eRefreshGate.test.ts`, because the ORDER of the three lines below is
 *  the whole of issue #194, and every hand-rolled refresh site in the tree got
 *  it wrong in the same way.
 *
 *  What #194 measured: 70–80% of e2e wall time was the driver waiting out a 30s
 *  script timeout — 13 to 23 stalls per `main` run — with every spec over 30s
 *  coming out as `n × 30` plus small change. The cause is not the specs. An
 *  `execute()` that lands while a `refresh()` navigation is mid-document-swap
 *  has its completion handler silently dropped, so the driver waits the FULL
 *  W3C script timeout before erroring and the caller retries. Every refresh
 *  site used to fire `armDriverBridge()` — an `execute()` — as its very first
 *  post-refresh command: one roll of that die per refresh, and `openRepo`
 *  refreshes once per `it()` (`keymap`: 28×). That is why stall count tracked
 *  REFRESH count rather than spec complexity, and why adding one refresh per
 *  spec file took the suite from 528s to 1064s (run 32246987758).
 *
 *  So the rule is: **after a refresh, the next command must be a WebDriver
 *  find, never a script.** A find cannot lose the same way — issued mid-swap it
 *  either matches (which is the driver's own proof that navigation settled, see
 *  `armDriverBridge`) or misses and is re-polled for pennies. Only once it HAS
 *  matched do we run a script, and by then the swap is over. The arm that used
 *  to run before that find was not merely early, it was worthless: it can land
 *  on the dying document (`armDriverBridge` doc), which is exactly why every
 *  call site already armed a second time afterwards. Deleting it costs nothing
 *  and removes the roll.
 *
 *  `gate`'s FIRST command must therefore be a real WebDriver query —
 *  `waitForDisplayed`, `waitForExist`, `waitUntil` over `isExisting()`, or a
 *  helper that begins with one (`waitRepoLoaded`). It must NOT be
 *  `browser.execute` in any form, `waitForSelector` included: that one polls in
 *  page, and would reinstate the very stall this exists to remove. */
export async function refreshAndSettle(
  gate: () => Promise<unknown>,
): Promise<void> {
  await browser.refresh();
  await gate();
  await armDriverBridge();
}

export async function resetApp(): Promise<void> {
  await browser.execute(() => localStorage.clear());
  await refreshAndSettle(() =>
    $("div*=Welcome to PlatypusGit").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "Welcome screen did not reappear after reset",
    }),
  );
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
  const rowSel = `[data-testid="recent-repo"][data-path="${repoPath}"]`;
  // The row find IS the settle gate — see refreshAndSettle. Resolved inside the
  // gate and again for the click, so the handle can only come from the settled
  // document.
  await refreshAndSettle(() =>
    $(rowSel).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "recent-repo row for temp repo never appeared",
    }),
  );
  await $(rowSel).click();
  await waitRepoLoaded();
}

/** Reload the page WITHOUT clearing localStorage, then reopen the repo via
 *  its recent-row. This is the persistence-test primitive: `openRepo` starts
 *  with `localStorage.clear()`, which would wipe pg-settings-v2 and defeat
 *  any "survives reload" assertion. Follows the re-arm rule: matched find →
 *  re-arm (see armDriverBridge doc). */
export async function reopenRepo(repoPath: string): Promise<void> {
  const rowSel = `[data-testid="recent-repo"][data-path="${repoPath}"]`;
  const chipSel = '[data-testid="branch-chip"]';
  // Since #90 the OPEN SET persists too (`pg-open-repos`), and this helper
  // deliberately keeps localStorage — so the reload may reopen the repository by
  // itself and never render a Welcome row at all. Waiting for the row
  // unconditionally would hang every persistence spec. Either branch is a
  // matched find, so the disjunction is a valid settle gate.
  await refreshAndSettle(() =>
    browser.waitUntil(
      async () =>
        (await $(chipSel).isExisting()) || (await $(rowSel).isExisting()),
      {
        timeout: 20_000,
        timeoutMsg:
          "after reload neither the restored repo (branch chip) nor its " +
          "recent-repo row appeared — recents/open-set not persisted?",
      },
    ),
  );
  if (!(await $(chipSel).isExisting())) {
    await $(rowSel).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "recent-repo row missing after reload — recents not persisted?",
    });
    await $(rowSel).click();
  }
  await waitRepoLoaded();
}

/** Seed the persisted open set (#90) and reload, so the app restores `paths` as
 *  tabs with `active` opened. The only way to get TWO repositories open in e2e:
 *  the `+` button and ⌘O go through the real OS folder picker, which WebDriver
 *  cannot drive.
 *
 *  Recents are seeded alongside, because that is the state a real session that
 *  opened both would have left behind — and the palette's repository switcher
 *  reads them. */
export async function seedOpenRepos(
  paths: string[],
  active: string,
): Promise<void> {
  // executeOnce, not bare execute: this WRITES, and a driver script-timeout
  // (routine under xvfb) makes WebdriverIO retry the command. A retried
  // `localStorage.clear()` landing after the setItem pair would wipe the seed
  // and leave the app booting with no open set — which looks like a render bug
  // in the strip rather than a lost write.
  await executeOnce(
    (ps: string[], act: string) => {
      localStorage.clear();
      localStorage.setItem(
        "pg-recent-repos",
        JSON.stringify(ps.map((p, i) => ({ path: p, openedAt: ps.length - i }))),
      );
      localStorage.setItem(
        "pg-open-repos",
        JSON.stringify({ paths: ps, active: act }),
      );
    },
    paths,
    active,
  );
  // Read the key back on BOTH sides of the reload rather than trusting the
  // write. "Repository opens but no tab appears" has two very different causes
  // — a clobbered seed and a strip that failed to render — and they are
  // indistinguishable from the spec's own assertion. Naming which one happened
  // is worth two read-only round trips.
  const afterWrite = await browser.execute(() =>
    localStorage.getItem("pg-open-repos"),
  );
  if (!afterWrite) {
    throw new Error(
      "seedOpenRepos: pg-open-repos is empty immediately after the write — " +
        "the seed never landed on this document",
    );
  }
  // Settle on a find BEFORE reading the key back — this read used to be the
  // first post-refresh command, i.e. the mid-swap `execute()` that stalls for a
  // whole script timeout (refreshAndSettle). Gating on "chip OR Welcome" keeps
  // the diagnostic below reachable in both outcomes: waiting for the repo to
  // load instead would turn a clobbered seed into a timeout that says nothing
  // about which of the two failures happened.
  await refreshAndSettle(() =>
    browser.waitUntil(
      async () =>
        (await $('[data-testid="branch-chip"]').isExisting()) ||
        (await $("div*=Welcome to PlatypusGit").isExisting()),
      {
        timeout: 20_000,
        timeoutMsg: "after seeding the open set the app rendered neither a repo nor Welcome",
      },
    ),
  );
  const afterBoot = await browser.execute(() =>
    localStorage.getItem("pg-open-repos"),
  );
  if (!afterBoot) {
    throw new Error(
      "seedOpenRepos: pg-open-repos was present before the reload and is gone " +
        "after it — the seed was clobbered during boot, not mis-rendered",
    );
  }
  await waitRepoLoaded();
}

/** A tab row, matched on the tail of its path.
 *
 *  Not the full path: `open_repo` returns the canonicalised workdir, which on
 *  macOS turns `/var/folders/…` (what `tmpdir()` hands out) into
 *  `/private/var/folders/…`. The temp-repo basename is unique per fixture, so
 *  the suffix is an exact identity match without depending on symlink
 *  resolution. */
export function repoTab(repoPath: string) {
  const name = repoPath.split("/").filter(Boolean).pop() ?? repoPath;
  return $(`[data-testid="repo-tab"][data-path$="${name}"]`);
}

export function repoTabClose(repoPath: string) {
  const name = repoPath.split("/").filter(Boolean).pop() ?? repoPath;
  return $(`[data-testid="repo-tab-close"][data-path$="${name}"]`);
}

/** Number of open repository tabs. */
export function repoTabCount(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-testid="repo-tab"]').length,
  );
}

/** Path of the active tab, straight from the DOM. */
export function activeRepoTabPath(): Promise<string | null> {
  return browser.execute(
    () =>
      document
        .querySelector('[data-testid="repo-tab"][data-active="true"]')
        ?.getAttribute("data-path") ?? null,
  );
}

/** Serial for executeOnce tokens — unique per logical call within a runner
 *  process (sessions never share a runner, so no cross-session collision). */
let execOnceSeq = 0;

/** Run a side-effectful in-page script AT MOST ONCE per logical call, even
 *  when the driver retries the execute.
 *
 *  Why (issue #35): the embedded driver reports "script execution timed out"
 *  whenever an eval finishes later than the session script timeout — routine
 *  under xvfb on CI, where evals stall for seconds. WebdriverIO then retries
 *  the command, re-running a script whose side effects already happened:
 *  context menu re-opened, Enter dispatched twice, settings toggle flipped
 *  back, confirm-call counter zeroed. Each logical call here mints a fresh
 *  token; the page records completed tokens (and their results) on
 *  `window.__pgExecOnce`, so a retry becomes a lookup that returns the first
 *  run's result instead of re-firing the effect.
 *
 *  The registry is a page global, so it dies with the document — the right
 *  lifetime, since a driver retry always re-targets the same document.
 *
 *  Rules for `fn`: self-contained (it is serialized, same as with
 *  browser.execute), and any throw must happen BEFORE the side effect —
 *  throws are not recorded, so a retry after one runs the script again.
 *  Use for every new side-effectful in-page script; read-only scripts
 *  (DOM dumps, localStorage reads) don't need it. */
export function executeOnce<R, A extends readonly unknown[]>(
  fn: (...args: [...A]) => R,
  ...args: A
): Promise<R> {
  return browser.execute(
    buildExecuteOnceScript(fn),
    `t${++execOnceSeq}`,
    ...args,
  ) as Promise<R>;
}

/** The token-guarded wrapper body behind executeOnce. Exported only so the
 *  harness self-test (harness.e2e.ts) can replay the SAME script with the
 *  SAME token — the exact shape of a driver retry. String script: the driver
 *  executes it as a W3C function body with the call's `arguments`, so the
 *  guard itself runs in-page on every attempt. */
export function buildExecuteOnceScript(fn: (...args: never[]) => unknown): string {
  return `
    var reg = (window.__pgExecOnce = window.__pgExecOnce || {});
    var token = arguments[0];
    if (Object.prototype.hasOwnProperty.call(reg, token)) return reg[token];
    var fn = (${fn.toString()});
    var result = fn.apply(null, Array.prototype.slice.call(arguments, 1));
    reg[token] = result === undefined ? null : result;
    return reg[token];
  `;
}

/** Auto-answer the app's confirm/prompt dialogs. Install BEFORE the action that
 *  triggers them; reset by any refresh.
 *
 *  These used to be native `window.confirm` / `window.prompt`, which WebDriver
 *  can't drive, so they were stubbed out. Since #61 C3 they are real in-page
 *  modals (`[data-pg-dialog]`) that a driver CAN click — but a spec would then
 *  have to interleave a click into every destructive action. Instead this
 *  installs an observer that answers each dialog as it appears, so every call
 *  site below keeps the same shape it had against the native stubs.
 *
 *  `promptQueue`: successive PROMPT dialogs consume queue entries in order
 *  (Add remote fires TWO: name, then URL — a single string would set
 *  name === url). Falls back to `promptText` when drained.
 *  `confirm: false` dismisses instead of accepting.
 *  Confirm dialogs are counted on `window.__pgConfirmCalls` — read it via
 *  `confirmCallCount()` to prove a confirm gate fired (or didn't). Prompts are
 *  not counted, matching the old native-stub behavior. */
export async function stubNativeDialogs(
  opts: { promptText?: string; confirm?: boolean; promptQueue?: string[] } = {},
): Promise<void> {
  // executeOnce: a driver-retry re-run would zero __pgConfirmCalls after a
  // confirm already fired, re-clone the prompt queue mid-consumption, and
  // attach a second observer that double-answers every dialog.
  await executeOnce(
    (promptText: string | null, confirm: boolean, queue: string[]) => {
      const q = [...queue];
      const w = window as any;
      w.__pgConfirmCalls = 0;

      // Natives are still stubbed: harmless, and keeps any path that has not
      // been converted from blocking the driver.
      w.prompt = () => (q.length ? q.shift()! : promptText);
      w.confirm = () => {
        w.__pgConfirmCalls++;
        return confirm;
      };

      const handled = new WeakSet<Element>();
      const testId = (root: Element, id: string) =>
        root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

      const answer = () => {
        const root = document.querySelector("[data-pg-dialog]");
        if (!root || handled.has(root)) return;
        handled.add(root);

        if (root.getAttribute("data-pg-dialog-kind") === "confirm") {
          w.__pgConfirmCalls++;
        }

        const input = testId(root, "dialog-input") as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (confirm && input) {
          // React tracks the previous value on the DOM node, so assigning
          // `.value` directly is swallowed as a no-op change. Go through the
          // prototype setter, then dispatch the event React listens for.
          //
          // The prototype has to match the element: a multi-line prompt (the
          // squash message) renders a <textarea>, and HTMLInputElement's setter
          // does nothing for it — the dialog would then be answered with its
          // prefilled text instead of the test's, or not at all.
          const value = q.length ? q.shift()! : (promptText ?? "");
          const proto =
            input.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // `requireValue` / `requireText` keep the primary button disabled until
        // React has re-rendered with the value above, so poll briefly rather
        // than clicking into the void.
        const wanted = confirm ? "dialog-confirm" : "dialog-cancel";
        let tries = 0;
        const click = () => {
          const live = document.querySelector("[data-pg-dialog]");
          if (!live) return;
          const btn = testId(live, wanted) as HTMLButtonElement | null;
          if (btn && !btn.disabled) {
            btn.click();
            return;
          }
          if (tries++ < 50) setTimeout(click, 20);
        };
        setTimeout(click, 0);
      };

      // A dialog already up when this installs is answered too.
      const obs = new MutationObserver(() => answer());
      obs.observe(document.body, { childList: true, subtree: true });
      w.__pgDialogObserver = obs;
      answer();
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

/** Open the Settings screen via the titlebar gear.
 *
 * The gear is rendered unconditionally, and AppShell's body gate is
 * `repo || screen === "settings"` — so this works with no repository open. */
export async function openSettings(): Promise<void> {
  await $('button[title="Settings"]').click();
  await $("div*=Default pull mode").waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: "Settings screen never appeared",
  });
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
  // executeOnce: a driver-retry re-run would re-open the menu, resetting any
  // hover/submenu state a subsequent helper already depends on. The
  // not-found throw happens before the dispatch, so it is safe to re-run.
  executeOnce(
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

/** Read-only poll: wait for a menu item's label span to be in the DOM.
 *
 *  The portal menu renders one or two React commits AFTER the script that
 *  triggered it returns (contextmenu dispatch → state → portal render;
 *  hover → effect → onOpenSubmenu → submenu portal), so the item is never
 *  present synchronously. Locally the next driver round-trip is slower than
 *  those commits; under xvfb CI load it occasionally isn't, and a single-shot
 *  lookup throws "menu item not found" (seen with the History reset submenu).
 *  Bare execute is fine — the poll has no side effects. */
async function waitForMenuItem(label: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (text: string) =>
          Array.from(document.querySelectorAll("span")).some(
            (s) => s.textContent === text,
          ),
        label,
      ),
    { timeout: 10_000, timeoutMsg: `menu item never rendered: ${label}` },
  );
}

/** Click an open context-menu item by its label-span text (menus are
 *  portals rendered to document.body, so a plain CSS selector on the label
 *  text is the reliable way to find them). */
export async function jsClickMenuItem(label: string): Promise<void> {
  await waitForMenuItem(label);
  // executeOnce: the click closes the menu, so a driver-retry re-run finds
  // no item and reports false — failing the test even though the click
  // already landed (the CI double-run flake, issue #35).
  const ok = await executeOnce((text: string) => {
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
  await waitForMenuItem(label);
  const ok = await executeOnce((text: string) => {
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
  // executeOnce is belt-and-braces here (⌘P maps to an open-only store
  // action, not a toggle), but keeps every synthesized-input dispatch under
  // the same no-double-run guarantee.
  await executeOnce(() => {
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
  // executeOnce: a driver-retry re-run would dispatch the key twice —
  // double Enter runs a palette command twice, double Escape closes layers
  // beyond the intended one.
  const ok = await executeOnce(
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

/** Dispatch a keymap chord as a window-level keydown, in canonical preset
 *  notation ("Mod+Shift+K", "Alt+ArrowLeft", "?", " ", "Tab").
 *
 *  Why synthesized: the embedded driver cannot synthesize modifier chords
 *  (same reason openPalette js-dispatches ⌘P). The keymap's window listener
 *  (AppShell, capture phase) is the entry point under test; everything from
 *  chord resolution onward is real app code.
 *
 *  `Mod` maps to metaKey on macOS and ctrlKey elsewhere — decided IN PAGE from
 *  navigator.platform, the same signal src/features/keymap/chord.ts uses, so
 *  specs stay platform-agnostic. Letters/digits get a proper `code` (KeyK,
 *  Digit1) because chord.ts resolves those from e.code, not e.key.
 *
 *  `target`: CSS selector to dispatch on instead of window — the dispatcher's
 *  text-input policy keys off e.target, so input-policy specs aim at the
 *  input element itself. */
export async function jsChord(
  chord: string,
  opts: { target?: string } = {},
): Promise<void> {
  // executeOnce: a driver-retry re-run would dispatch the chord twice —
  // double toggle, double navigation, double git op.
  const ok = await executeOnce(
    (spec: string, targetSel: string | null) => {
      const parts = spec.split("+");
      // " " (Space) splits to [" "]; "Mod+," keeps "," as base.
      const base = parts.length > 1 ? parts[parts.length - 1] : spec;
      const mods = new Set(parts.slice(0, -1));
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const wantMod = mods.has("Mod");
      let key = base;
      let code = "";
      if (/^[A-Z]$/.test(base)) {
        key = base.toLowerCase();
        code = "Key" + base;
      } else if (/^[0-9]$/.test(base)) {
        code = "Digit" + base;
      }
      const target = targetSel ? document.querySelector(targetSel) : window;
      if (!target) return false;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code,
          metaKey: wantMod && isMac,
          ctrlKey: (wantMod && !isMac) || mods.has("Ctrl"),
          altKey: mods.has("Alt"),
          shiftKey: mods.has("Shift"),
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    },
    chord,
    opts.target ?? null,
  );
  if (!ok) throw new Error(`jsChord: target not found: ${opts.target}`);
}

/** Two lone Shift taps inside the dispatcher's 350ms DoubleShift window —
 *  one script, so the taps land microseconds apart. `target`: dispatch on an
 *  element instead of window (input-policy specs aim at a text input). */
export async function jsDoubleShift(opts: { target?: string } = {}): Promise<void> {
  // executeOnce: a retry would tap Shift twice more — palette.open claims
  // without reopening when already open, so harmless today, but keep the
  // guard uniform.
  const ok = await executeOnce((targetSel: string | null) => {
    const target = targetSel ? document.querySelector(targetSel) : window;
    if (!target) return false;
    for (let i = 0; i < 2; i++) {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Shift",
          code: "ShiftLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    return true;
  }, opts.target ?? null);
  if (!ok) throw new Error(`jsDoubleShift: target not found: ${opts.target}`);
}

/** Read the id of the pane currently holding keymap focus (accent ring). */
export function focusedPaneId(): Promise<string | null> {
  return browser.execute(
    () =>
      document
        .querySelector("[data-pg-pane][data-pg-focused]")
        ?.getAttribute("data-pg-pane") ?? null,
  );
}

/** Open a `PGSelect` and click one of its options (issue 146).
 *
 *  There is no `<select>` in the app any more — WebKitGTK maps one as a GDK
 *  popup surface, and GDK's Wayland backend refuses to map a popup that would
 *  not be the topmost one — so `jsSelectValue`, which set a native select's
 *  value and dispatched `change`, has nothing left to drive. The control is a
 *  `role="combobox"` trigger plus a portalled `[data-pg-listbox]`, so driving it
 *  means the two steps a user takes.
 *
 *  Both steps are in-page MouseEvents rather than WebDriver actions, for the
 *  reason `jsContextMenu` documents plus one measured on WebKitGTK 605 under
 *  xvfb (#161): a real driver pointer action delivers `mousedown` and no
 *  `pointerdown`, so a helper that assumed either alone is a coin flip. The
 *  trigger opens on `mousedown`; the option commits on `click`.
 *
 *  `opts.within` + `opts.text` narrow to one instance when several are on
 *  screen — the Rebase plan mounts one picker per row, so the row is named by
 *  its own selector and its text, exactly like `jsContextMenu`'s `text`.
 *
 *  Only one listbox can be open at a time (opening a second closes the first),
 *  so `[data-pg-listbox]` is an unambiguous scope once the trigger is open. */
export async function jsPickOption(
  selector: string,
  value: string,
  opts?: { within?: string; text?: string },
): Promise<void> {
  // executeOnce: a driver-retry re-run would toggle the list shut again, and
  // the not-found throws all happen before any dispatch.
  const opened = await executeOnce(
    (sel: string, within: string | null, text: string | null) => {
      let scope: ParentNode = document;
      if (within) {
        const hosts = Array.from(document.querySelectorAll(within));
        const host = text
          ? hosts.find((h) => h.textContent?.includes(text))
          : hosts[0];
        if (!host) return false;
        scope = host;
      }
      const el = scope.querySelector(sel) as HTMLElement | null;
      if (!el) return false;
      if (el.getAttribute("aria-expanded") === "true") return true;
      el.focus();
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return true;
    },
    selector,
    opts?.within ?? null,
    opts?.text ?? null,
  );
  if (!opened) {
    throw new Error(
      `jsPickOption: trigger not found: ${selector}` +
        (opts?.within ? ` (within ${opts.within}${opts.text ? `, text: ${opts.text}` : ""})` : ""),
    );
  }

  // The listbox is a portal rendered one React commit after the mousedown, so
  // poll for the option rather than looking once (the `waitForMenuItem` rule).
  const option = `[data-pg-listbox] [data-pg-option][data-value="${value}"]`;
  await $(option).waitForExist({
    timeout: 10_000,
    timeoutMsg: `option "${value}" never appeared for ${selector}`,
  });
  const clicked = await executeOnce((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
    return true;
  }, option);
  if (!clicked) throw new Error(`jsPickOption: option "${value}" vanished before the click`);
  // The listbox closing is the only in-page signal that the commit landed.
  await $("[data-pg-listbox]").waitForExist({
    reverse: true,
    timeout: 10_000,
    timeoutMsg: `the listbox never closed after picking "${value}"`,
  });
}

/**
 * Drag `fromSel` onto `toSel` with a real pointer sequence (#91).
 *
 * Why synthesized rather than `browser.performActions`: the embedded driver's
 * actions endpoint synthesizes mousedown/mouseup/click only — it never emits
 * `pointerdown`/`pointermove`/`pointerup`, which is the whole gesture
 * (`features/dnd/dragController.ts`). Same class of limitation that forces
 * `jsContextMenu` and `jsChord`.
 *
 * The events go out as real `PointerEvent`s dispatched ON the element under the
 * pointer, because that is what a hardware move produces and what the
 * controller's hit test reads (`e.target.closest("[data-pg-drop-id]")`).
 * Coordinates come from live `getBoundingClientRect()` centres, so the drop
 * lands wherever the layout actually put the target.
 *
 * Two moves: the first clears the 4px slop and arms the drag, the second lands
 * on the target so a resolution is computed before the release.
 */
export async function jsDrag(fromSel: string, toSel: string): Promise<void> {
  // executeOnce: a driver-retry re-run would perform the drag twice — a second
  // stage/unstage or, on the graph, a second confirm.
  const ok = await executeOnce(
    (from: string, to: string) => {
      const src = document.querySelector(from) as HTMLElement | null;
      const dst = document.querySelector(to) as HTMLElement | null;
      if (!src || !dst) return false;
      const centre = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const a = centre(src);
      const b = centre(dst);
      const fire = (el: HTMLElement, type: string, p: { x: number; y: number }) => {
        const Ctor =
          typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
        el.dispatchEvent(
          new Ctor(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: p.x,
            clientY: p.y,
          } as PointerEventInit),
        );
      };
      fire(src, "pointerdown", a);
      // Halfway first: clears the slop while still over the source, so the
      // gesture arms exactly as a hardware drag does.
      fire(dst, "pointermove", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      fire(dst, "pointermove", b);
      fire(dst, "pointerup", b);
      return true;
    },
    fromSel,
    toSel,
  );
  if (!ok) throw new Error(`jsDrag: element not found (${fromSel} -> ${toSel})`);
}

/**
 * Drag a `PGResizeHandle` by `delta` px along its axis.
 *
 * Separate from `jsDrag`, for two reasons. The pane handle is the one drag
 * gesture in the app that is NOT the pointer-event primitive from
 * `features/dnd`: it takes `mousedown` on itself and then `mousemove` /
 * `mouseup` on `document`, so a `pointermove` on the handle reaches nothing.
 *
 * And the grab must be its OWN round trip. Those document listeners are
 * registered by an effect that the mousedown's state update schedules, and React
 * runs passive effects after the commit rather than inside the dispatch — so a
 * mousemove fired in the same task lands before the listener exists, silently
 * does nothing, and leaves the handle stuck in its dragging state with no
 * mouseup ever delivered. A second driver command is a whole event-loop turn
 * later, which is all the effect needs.
 *
 * One move is enough once armed: the handler tracks the previous position and
 * reports the delta between them, so a single 2000px move is a 2000px delta.
 */
export async function jsDragHandle(
  selector: string,
  delta: number,
  axis: "x" | "y" = "x",
): Promise<void> {
  // executeOnce on both halves: a driver-retry re-run would re-grab or re-apply.
  const from = await executeOnce((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: p.x,
        clientY: p.y,
      }),
    );
    return p;
  }, selector);
  if (!from) throw new Error(`jsDragHandle: element not found (${selector})`);

  const to =
    axis === "y" ? { x: from.x, y: from.y + delta } : { x: from.x + delta, y: from.y };
  await executeOnce((p: { x: number; y: number }) => {
    for (const type of ["mousemove", "mouseup"]) {
      document.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: p.x,
          clientY: p.y,
        }),
      );
    }
    return true;
  }, to);
}

/** In-page `dblclick` — the pane handle's reset gesture. */
export async function jsDoubleClick(selector: string): Promise<void> {
  const ok = await executeOnce((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
    return true;
  }, selector);
  if (!ok) throw new Error(`jsDoubleClick: element not found (${selector})`);
}

/** Full length of the windowed History list, from the container's data-total. */
export async function commitListTotal(): Promise<number> {
  const raw = await $('[data-testid="commit-list"]').getAttribute("data-total");
  return Number(raw ?? "0");
}

/**
 * Scroll the History list until a commit row containing `text` is mounted.
 *
 * History is windowed (#68 G10): a commit that exists in the model may not be
 * in the DOM at all, so a bare `waitForDisplayed` on its text would time out on
 * a row that is merely off-screen. Small fixtures fit in the first window and
 * return immediately, so this is cheap to call unconditionally.
 *
 * Read-only probing, so bare `browser.execute` is correct here — `executeOnce`
 * exists for scripts whose effects must not be replayed on a driver retry, and
 * setting scrollTop to an absolute value is idempotent.
 */
export async function scrollCommitListTo(
  text: string,
  timeout = 15_000,
): Promise<void> {
  const sel = `[data-testid="commit-row"]*=${text}`;
  let top = 0;
  // Waits AND scrolls in one loop: the row may be missing because the log is
  // still loading, or because it is simply outside the window. Treating those
  // as one condition keeps this as forgiving as the waitForDisplayed it
  // replaces, instead of failing fast on a slow fixture.
  await browser.waitUntil(
    async () => {
      if (await $(sel).isExisting()) return true;
      await browser.execute((y: number) => {
        const el = document.querySelector<HTMLElement>(
          '[data-pg-pane="history.list"] [data-pg-focus-target]',
        );
        if (el) el.scrollTop = y;
      }, top);
      // Step by roughly a screenful; wrap so a short list keeps re-probing the
      // top rather than scrolling past the end forever.
      top = top >= 20_000 ? 0 : top + 400;
      return $(sel).isExisting();
    },
    {
      timeout,
      timeoutMsg: `no commit row matching "${text}" appeared while scrolling the list`,
    },
  );
}

/**
 * Wait until History's HEAD marker sits on the commit whose subject contains
 * `subject`.
 *
 * The UI signal for "a ref move has landed, all of it". `PGCommitRow` carries
 * `data-head="true"` for the row matching the branch tip `refreshAll` read, so
 * the marker can only move after the whole backend call returned — which is
 * what makes it the right wait for an op that keeps working after the ref moves
 * (see the hard-reset comment in history-ops.e2e.ts).
 *
 * An in-page query rather than a selector, for two reasons. Identity has to be
 * part of the condition — `[data-testid="commit-row"][data-head="true"]` alone
 * matches the row HEAD is leaving, so it is satisfied before anything happens —
 * and WebdriverIO cannot express "two attributes AND partial text" (its
 * extended-XPath grammar allows exactly one `[attr=value]` before `*=`, so the
 * combined form silently degrades to an invalid CSS selector). Read-only, so
 * bare `browser.execute` is correct.
 *
 * History is windowed, so this only works while the HEAD row is mounted — true
 * for every small fixture, since HEAD sits at or near the top. A fixture deep
 * enough to scroll HEAD out needs `scrollCommitListTo` first.
 */
export async function waitHeadMarkerOn(
  subject: string,
  timeout = 20_000,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (want: string) =>
          document
            .querySelector('[data-testid="commit-row"][data-head="true"]')
            ?.textContent?.includes(want) ?? false,
        subject,
      ),
    {
      timeout,
      timeoutMsg: `the HEAD marker never moved to the commit matching "${subject}"`,
    },
  );
}

export interface DiffRowInk {
  /** Diff code rows measured (`fill` and hunk rows alike; folds and spacers skipped). */
  rows: number;
  /** Rows whose drawn text is taller than the row box the window sized for them. */
  tall: number;
  /** Rows whose text reaches past the next row's top edge. */
  overlaps: number;
  /** Tallest ink / row-box ratio seen, for the failure message. */
  worst: { rowH: number; inkH: number; lineBoxes: number; text: string } | null;
}

/**
 * Measure whether any unified diff row DRAWS taller than the box the row model
 * sized for it — i.e. whether a code line wrapped under a fixed-pitch row and is
 * therefore painting over its neighbours.
 *
 * Read-only, so bare `browser.execute` is correct.
 *
 * Two things make this the only layer that can catch the regression. jsdom
 * performs no layout, so a component test can pin the `white-space` declaration
 * and nothing more. And the code span is a FLEX ITEM stretched to the row's
 * height, so its own `getBoundingClientRect()` reports the row's height whatever
 * its content does — the honest measurement is a `Range` over its contents, which
 * yields one client rect per line box.
 */
export async function diffRowInk(paneId: string): Promise<DiffRowInk> {
  return (await browser.execute((pane: string) => {
    const anchor = document.querySelector(`[data-pg-pane="${pane}"] [data-hunk-index]`);
    const root = anchor?.parentElement;
    const empty = { rows: 0, tall: 0, overlaps: 0, worst: null };
    if (!root) return empty;
    const metrics: { rowH: number; inkH: number; top: number; lineBoxes: number; text: string }[] = [];
    for (const child of Array.from(root.children)) {
      if (child.hasAttribute("data-pg-spacer")) continue;
      const row = (
        child.hasAttribute("data-hunk-index") ? child.firstElementChild : child
      ) as HTMLElement | null;
      // A diff row is the line-number gutters + marker + code span; a fold
      // separator is not, and has nothing to overflow.
      if (!row || row.children.length < 4) continue;
      const span = row.lastElementChild as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(span);
      const rects = Array.from(range.getClientRects());
      const box = row.getBoundingClientRect();
      metrics.push({
        rowH: box.height,
        inkH: rects.length
          ? Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
          : 0,
        top: box.top,
        lineBoxes: rects.length,
        text: (row.textContent ?? "").slice(0, 60),
      });
    }
    let tall = 0;
    let overlaps = 0;
    let worst: (typeof metrics)[number] | null = null;
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      if (m.inkH - m.rowH > 1) tall++;
      if (!worst || m.inkH - m.rowH > worst.inkH - worst.rowH) worst = m;
      const next = metrics[i + 1];
      if (next && m.top + m.inkH - next.top > 1) overlaps++;
    }
    return {
      rows: metrics.length,
      tall,
      overlaps,
      worst: worst
        ? { rowH: worst.rowH, inkH: worst.inkH, lineBoxes: worst.lineBoxes, text: worst.text }
        : null,
    };
  }, paneId)) as DiffRowInk;
}

/**
 * Start recording every `pgFlash` toast the page raises, into `window.__pgFlashLog`.
 *
 * The toast removes itself after `PG_FLASH_MS` (1.7s) and reuses ONE element, so
 * reading it in a round trip of its own is a race the moment CI is loaded — and a
 * missed read is indistinguishable from a toast that never appeared. A recorder
 * installed BEFORE the action turns that into an exact assertion: the keymap
 * dispatcher runs synchronously on keydown and `pgFlash` appends synchronously
 * inside it, so the mutation has landed by the time the dispatching script returns.
 *
 * Read-only observer, so no `executeOnce` token is needed for correctness — but it
 * keeps one anyway, since a retry that re-installed the observer would double
 * every entry from then on.
 *
 * Wiped by any reload; install after `openRepo`.
 */
export const watchFlashes = (): Promise<boolean> =>
  executeOnce(() => {
    const w = window as unknown as { __pgFlashLog?: string[] };
    if (w.__pgFlashLog) return true;
    const log: string[] = (w.__pgFlashLog = []);
    // Sample on ANY body mutation rather than matching added nodes: the second
    // flash reuses the element and only replaces its text node, so an
    // added-node-only observer would see the first toast and nothing after it.
    const sample = () => {
      const t = document.querySelector("[data-pg-flash]")?.textContent ?? null;
      if (t !== null && t !== log[log.length - 1]) log.push(t);
    };
    new MutationObserver(sample).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return true;
  });

/** Toasts recorded since `watchFlashes()`, oldest first. Consecutive identical
 *  messages collapse to one entry — assert on the LAST, not on the length. */
export const flashLog = (): Promise<string[]> =>
  browser.execute(
    () => (window as unknown as { __pgFlashLog?: string[] }).__pgFlashLog ?? [],
  );

/**
 * Wait for a selector to MATCH IN THE PAGE, re-querying it in page on each poll.
 *
 * For anything WINDOWING can mount and unmount — a diff row, its
 * `[data-hunk-active]` marker — this is the wait to use rather than
 * `waitForDisplayed`. That helper is `waitUntil(() => isDisplayed())` over an
 * element HANDLE, and `isDisplayed` passes the handle into an in-page script:
 * a detached node answers "not displayed" honestly instead of raising stale, so
 * WebdriverIO's error handler never refetches and the wait can poll a dead node
 * for its whole budget while the row it was looking for is on screen. A selector
 * re-evaluated in page has nothing to bind to and cannot go stale.
 *
 * Read-only, so it stays on bare `browser.execute` (see `executeOnce`).
 */
export function waitForSelector(
  selector: string,
  timeoutMsg: string,
  timeout = 20_000,
): Promise<true | void> {
  return browser.waitUntil(
    async () =>
      Boolean(
        await browser.execute(
          (sel: string) => !!document.querySelector(sel),
          selector,
        ),
      ),
    { timeout, timeoutMsg },
  );
}
