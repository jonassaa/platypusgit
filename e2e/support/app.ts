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
 * once at session start (wdio.conf.ts `before` hook). */
export async function armDriverBridge(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const w = window as unknown as Record<string, any>;
        const core = w.__TAURI__?.core;
        if (!core?.invoke) return false;
        w.__wdio_original_core__ = core;
        return true;
      }),
    {
      timeout: 20_000,
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
}

export async function waitRepoLoaded(): Promise<void> {
  // Welcome gone + repo chrome present
  await $('[data-testid="branch-chip"]').waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: "branch chip never appeared after opening repo",
  });
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
  await row.click();
  await waitRepoLoaded();
}

/** WebDriver can't drive native prompt/confirm — stub them in-page BEFORE the
 *  action that triggers them. Reset by any refresh. */
export async function stubNativeDialogs(
  opts: { promptText?: string; confirm?: boolean } = {},
): Promise<void> {
  await browser.execute(
    (promptText: string | null, confirm: boolean) => {
      (window as any).prompt = () => promptText;
      (window as any).confirm = () => confirm;
    },
    opts.promptText ?? "e2e",
    opts.confirm ?? true,
  );
}

export async function switchScreen(id: string): Promise<void> {
  await $(`[data-activity="${id}"]`).click();
}
