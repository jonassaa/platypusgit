// Merge resolver window (docs/superpowers/specs/2026-07-07-merge-resolver-window-design.md
// + docs/superpowers/specs/2026-08-14-conflict-flow-design.md): second Tauri
// window (label "merge"), conflicted-file sidebar, per-conflict accepts, apply +
// auto-advance, finalize back in the main window's operation bar.
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

import { browser, $, $$, expect } from "@wdio/globals";
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
} from "../support/app";

// --- helpers copied from merge-conflict.e2e.ts (spec files never cross-import) ---

/** Open picker, context-menu the branch row, click "Merge into current".
 *  Confirm dialogs must already be stubbed. */
async function mergeBranchViaPicker(name: string): Promise<void> {
  await $('[data-testid="branch-chip"]').click();
  const row = $(`[data-branch-row]*=${name}`);
  await row.waitForDisplayed({ timeout: 10_000, timeoutMsg: `branch row ${name} missing` });
  await jsContextMenu(`[data-branch-row]`, { text: name });
  await jsClickMenuItem("Merge into current");
}

/** open + stub + merge clash → wait for the operation bar. Since #108 that bar
 *  is the app's conflict signal AND the launcher for this window. */
async function startConflictedMerge(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  await stubNativeDialogs({ confirm: true });
  await mergeBranchViaPicker("clash");
  await $('[data-testid="operation-bar"]').waitForDisplayed({
    timeout: 20_000, timeoutMsg: "conflicted merge did not surface",
  });
}

/** Launch the resolver from the operation bar. It names no file — the window
 *  picks the first unresolved one from its own list. */
async function launchMergeWindow(): Promise<void> {
  const open = $('[data-testid="operation-resolve"]');
  await open.waitForDisplayed({ timeout: 10_000, timeoutMsg: "operation-resolve missing" });
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

/** Finish the merge from the main window's operation bar. */
async function finalizeOperation(): Promise<void> {
  const finish = $('[data-testid="operation-continue"]');
  await finish.waitForDisplayed({
    timeout: 20_000, timeoutMsg: "Finalize never appeared after the window applied",
  });
  await finish.click();
  await $('[data-testid="operation-bar"]').waitForDisplayed({
    reverse: true, timeout: 20_000,
    timeoutMsg: "operation bar stayed up after finalize",
  });
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
    await finalizeOperation();
    // repo truth is the acceptance:
    expect(repo.read("conflict.txt")).toBe("theirs change\n");
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("lists both conflicts and auto-advances to the second after Apply", async () => {
    repo = conflictRepoTwoFiles();
    await startConflictedMerge(repo);
    await launchMergeWindow();

    await switchToMergeWindow();
    // The sidebar shows the whole set, not just the open file (#108).
    await $('[data-testid="merge-file-row"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "conflict list never rendered",
    });
    await browser.waitUntil(
      async () => [...(await $$('[data-testid="merge-file-row"]'))].length === 2,
      { timeout: 10_000, timeoutMsg: "conflict list did not list both files" },
    );
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
    // The applied file stays listed, marked resolved, so the list does not
    // shift under the user.
    await expect(
      $(`[data-testid="merge-file-row"][data-path="${firstPath}"]`),
    ).toHaveAttribute("data-resolved", "true");
    // Wait for the second file's fresh model to have SEEDED ITS REGIONS before
    // driving it — the counter reading `0/N`, not "Apply is disabled".
    //
    // "Apply is disabled" is ambiguous, and the gap between its two meanings is
    // where the CI-only "Apply never enabled for the second file" flake lived.
    // `canApply` is `!loading && !!model && !chooser && allResolved`, and
    // `allResolved` is `regionStates.every(...)` — which is TRUE for an empty
    // list (deliberately: a zero-conflict auto-merge file is applyable). So the
    // retarget goes disabled (loading) → briefly ENABLED with zero regions
    // (model in, regionStates not seeded yet) → disabled again (one unresolved
    // region). The old wait was satisfied by the FIRST of those, so ⌘1 could
    // land in the second and be dropped for want of a region to accept, and
    // Apply then never enabled. `0/N` can only be the fresh unresolved file:
    // file one's counter read `1/1` before its Apply. try/catch treats a
    // mid-transition window as not-ready-yet.
    await browser.waitUntil(
      async () => {
        try {
          return /^0\/[1-9]/.test(
            await $('[data-testid="merge-conflict-counter"]').getText(),
          );
        } catch {
          return false;
        }
      },
      {
        timeout: 10_000,
        timeoutMsg: "the second file's conflict regions never seeded (counter never read 0/N)",
      },
    );
    // Resolve the second file too (keyboard ⌘1 = take ours); window closes.
    await jsChord("Mod+1");
    await browser.waitUntil(async () => $('[data-testid="merge-apply"]').isEnabled(), {
      timeout: 10_000, timeoutMsg: "Apply never enabled for the second file",
    });
    await $('[data-testid="merge-apply"]').click();

    await switchToMainWindow();
    // Both files resolved as ours and staged on disk (saveResolution writes +
    // stages before the window closes) — repo truth is the acceptance.
    await finalizeOperation();
    expect(repo.read("alpha.txt")).toBe("ours a\n");
    expect(repo.read("beta.txt")).toBe("ours b\n");
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
  });
});
