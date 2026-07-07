// Merge resolver window (docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md):
// second Tauri window (label "merge"), per-conflict accepts, apply +
// auto-advance, finalize back in the main window.
//
// MULTI-WINDOW: this spec drives a SECOND Tauri window via the embedded wdio
// driver (`switchToMergeWindow` → `browser.tauri.switchWindow("merge")`) and
// runs the full in-window flow — chord/chevron accept → Apply → auto-advance
// → finalize — asserted against repo truth.
//
// PLATFORM: reliable HEADLESS on Linux/WebKitGTK (CI + `pnpm test:e2e:docker`)
// — verified green 3/3. NOT reliable on a macOS-NATIVE run (`pnpm test:e2e`
// on a Mac): WKWebView's foreground-focus self-heal (ensureMacAppFocus) can't
// keep a consistent active window across the second window's
// open/transition/close, so switchWindow intermittently reports "No window
// could be found". Run this spec headless (Docker/CI), not macOS-native.

import { browser, $, expect } from "@wdio/globals";
import { conflictRepo, conflictRepoTwoFiles, TempRepo } from "../support/tempRepo";
import {
  armDriverBridge,
  ensureMacAppFocus,
  jsChord,
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  stubNativeDialogs,
  switchScreen,
} from "../support/app";

// --- helpers copied from merge-conflict.e2e.ts (spec files never cross-import) ---

/** Open picker, context-menu the branch row, click "Merge into current".
 *  window.confirm must already be stubbed. */
async function mergeBranchViaPicker(name: string): Promise<void> {
  await $('[data-testid="branch-chip"]').click();
  const row = $(`[data-branch-row]*=${name}`);
  await row.waitForDisplayed({ timeout: 10_000, timeoutMsg: `branch row ${name} missing` });
  await jsContextMenu(`[data-branch-row]`, { text: name });
  await jsClickMenuItem("Merge into current");
}

/** open + stub + merge clash → wait for the conflict list to appear.
 *  Generalized from merge-conflict.e2e.ts's startConflictedMerge: waits for
 *  ANY conflict row (the two-file fixture has no conflict.txt), not a
 *  path-specific one. */
async function startConflictedMerge(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  await stubNativeDialogs({ confirm: true });
  await mergeBranchViaPicker("clash");
  await switchScreen("conflict");
  await $('[data-testid="conflict-row"]').waitForDisplayed({
    timeout: 20_000, timeoutMsg: "conflicted merge did not surface",
  });
}

/** Select the first conflict row, then launch the resolver window from the
 *  detail action bar. */
async function launchMergeWindow(): Promise<void> {
  await $('[data-testid="conflict-row"]').click();
  const open = $('[data-testid="open-merge-editor"]');
  await open.waitForDisplayed({ timeout: 10_000, timeoutMsg: "open-merge-editor missing" });
  await open.click();
}

/** Attach the driver to the resolver window. First call is the multi-window
 *  spike (see file header). Re-arms the driver bridge + heals focus because
 *  we've moved to a DIFFERENT document (per e2e-testing skill re-arm rule). */
async function switchToMergeWindow(): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        await browser.tauri.switchWindow("merge");
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 15_000, timeoutMsg: "merge window never became switchable" },
  );
  await armDriverBridge();          // new document — re-arm the driver bridge
  await ensureMacAppFocus();
  await $('[data-testid="merge-window"]').waitForDisplayed({ timeout: 10_000 });
}

async function switchToMainWindow(): Promise<void> {
  await browser.tauri.switchWindow("main");
  await armDriverBridge();          // back on main's document — re-arm
}

describe("merge resolver window", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    // If a merge window is still open (e.g. a failed test), close it so
    // resetApp sees main. window.close() does NOT close a Tauri window — go
    // through the Tauri API (withGlobalTauri is on in the e2e build).
    try {
      await browser.tauri.switchWindow("merge");
      await browser.execute(() => {
        const w = window as unknown as Record<string, any>;
        void w.__TAURI__?.window?.getCurrentWindow?.().close();
      });
    } catch {
      /* no merge window — fine */
    }
    await switchToMainWindow();
    await resetApp();
    repo?.dispose();
    repo = null;
  });

  it("resolves a single-file conflict via the window and finalizes", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await launchMergeWindow();

    await switchToMergeWindow();
    await expect($('[data-testid="merge-file-path"]')).toHaveText("conflict.txt", {
      containing: true,
    });
    // Keyboard accept: ⌘2/Ctrl+2 = take theirs for the current conflict.
    await jsChord("Mod+2");
    await browser.waitUntil(async () => $('[data-testid="merge-apply"]').isEnabled(), {
      timeout: 10_000, timeoutMsg: "Apply never enabled after accept chord",
    });
    await $('[data-testid="merge-apply"]').click();
    // Last conflicted file → the window closes itself.

    await switchToMainWindow();
    await browser.waitUntil(
      async () => $('[data-testid="conflict-finalize"]').isEnabled(),
      { timeout: 10_000, timeoutMsg: "Finalize never enabled after window apply" },
    );
    await $('[data-testid="conflict-finalize"]').click();
    await $("div*=No conflicts").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "conflict screen did not clear after finalize",
    });
    // repo truth is the acceptance:
    expect(repo.read("conflict.txt")).toBe("theirs change\n");
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("auto-advances to the second conflicted file after Apply", async () => {
    repo = conflictRepoTwoFiles();
    await startConflictedMerge(repo);
    await launchMergeWindow();

    await switchToMergeWindow();
    const firstPath = await $('[data-testid="merge-file-path"]').getText();
    // Chevron path this time (mouse parity with the chord path): take ours for
    // the first conflict region.
    await $('[data-testid="accept-chevron-ours-0"]').click();
    await browser.waitUntil(async () => $('[data-testid="merge-apply"]').isEnabled(), {
      timeout: 10_000, timeoutMsg: "Apply never enabled after chevron accept",
    });
    await $('[data-testid="merge-apply"]').click();
    // Not the last file → the window stays open and retargets the next one.
    await browser.waitUntil(
      async () => (await $('[data-testid="merge-file-path"]').getText()) !== firstPath,
      { timeout: 10_000, timeoutMsg: "window never advanced to the next file" },
    );
    // Wait for the second file's fresh (unresolved) model to finish loading
    // before driving it: Apply stays disabled until the new region is seeded.
    // Sending the accept chord earlier races the async sides fetch + editor
    // remount. try/catch treats a mid-transition window as not-ready-yet.
    await browser.waitUntil(
      async () => {
        try {
          return !(await $('[data-testid="merge-apply"]').isEnabled());
        } catch {
          return false;
        }
      },
      { timeout: 10_000, timeoutMsg: "second file never settled as unresolved" },
    );
    // Resolve the second file too (keyboard ⌘1 = take ours); window closes.
    await jsChord("Mod+1");
    await browser.waitUntil(async () => $('[data-testid="merge-apply"]').isEnabled(), {
      timeout: 10_000, timeoutMsg: "Apply never enabled for the second file",
    });
    await $('[data-testid="merge-apply"]').click();

    await switchToMainWindow();
    await browser.waitUntil(
      async () => $('[data-testid="conflict-finalize"]').isEnabled(),
      { timeout: 10_000, timeoutMsg: "Finalize never enabled after both files applied" },
    );
    // Both files resolved as ours and staged on disk (saveResolution writes +
    // stages before the window closes) — repo truth is the acceptance.
    expect(repo.read("alpha.txt")).toBe("ours a\n");
    expect(repo.read("beta.txt")).toBe("ours b\n");
  });
});
