import { browser, $, expect } from "@wdio/globals";
import { conflictRepo, cherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsClickMenuItem,
} from "../support/app";

/** Open picker, context-menu the branch row, click "Merge into current".
 *  window.confirm must already be stubbed. */
async function mergeBranchViaPicker(name: string): Promise<void> {
  await $('[data-testid="branch-chip"]').click();
  const row = $(`[data-branch-row]*=${name}`);
  await row.waitForDisplayed({ timeout: 10_000, timeoutMsg: `branch row ${name} missing` });
  await jsContextMenu(`[data-branch-row]`, { text: name });
  await jsClickMenuItem("Merge into current");
}

/** conflictRepo + open + stub + merge clash → wait for conflict row. */
async function startConflictedMerge(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  await stubNativeDialogs({ confirm: true });
  await mergeBranchViaPicker("clash");
  await switchScreen("conflict");
  await $('[data-testid="conflict-row"][data-path="conflict.txt"]').waitForDisplayed({
    timeout: 20_000, timeoutMsg: "conflicted merge did not surface",
  });
}

describe("merge & conflict", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("merges a branch cleanly from the branch picker", async () => {
    repo = cherryRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await mergeBranchViaPicker("feature");
    // repo-truth wait: no dedicated UI signal for merge completion. `main`
    // has no divergent history from `feature` here, so `git merge` fast-
    // forwards (no merge commit) — wait for HEAD to land on feature's tip
    // rather than assuming a "Merge branch" commit message.
    await browser.waitUntil(
      async () => repo.git("log", "-1", "--pretty=%s").trim() === "feat: cherry commit",
      { timeout: 20_000, timeoutMsg: "merge never completed" },
    );
    expect(repo.git("status", "--porcelain").trim()).toBe("");
    expect(repo.read("cherry.txt")).toBe("cherry\n");
  });

  it("shows conflict state immediately when a merge conflicts", async () => {
    repo = conflictRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await mergeBranchViaPicker("clash");
    // error banner appears...
    await $('[role="alert"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "error banner never appeared",
    });
    // ...AND conflict state is visible WITHOUT any manual refresh:
    await switchScreen("conflict");
    await $('[data-testid="conflict-row"][data-path="conflict.txt"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "conflict row not shown — refreshAll-on-error fix missing?",
    });
    // ...AND the status-bar badge reflects it too (same refreshAll-on-error fix).
    await $("span*=1 conflict").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "status-bar conflict badge never appeared",
    });
    expect(repo.hasRef("MERGE_HEAD")).toBe(true);
  });

  it("resolves with accept-ours and finalizes the merge", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await $('[data-testid="conflict-row"][data-path="conflict.txt"]').click();
    await $('[data-testid="accept-ours"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "detail action bar missing",
    });
    await $('[data-testid="accept-ours"]').click();
    // accept-ours may auto-mark the file resolved (row leaves the list) —
    // only click mark-resolved if it's still present. TOCTOU guard (#35):
    // the post-accept refresh can unmount the button between isExisting()
    // and click() — the button vanishing IS the resolved state, so swallow
    // the re-find failure; the finalize wait + repo-truth asserts below
    // remain the real gates.
    const markResolvedBtn = $('[data-testid="mark-resolved"]');
    try {
      if (await markResolvedBtn.isExisting()) await markResolvedBtn.click();
    } catch {
      // button unmounted mid-flight — file already resolved
    }
    const finalize = $('[data-testid="conflict-finalize"]');
    await browser.waitUntil(async () => finalize.isEnabled(), {
      timeout: 10_000, timeoutMsg: "Finalize never enabled after resolving",
    });
    await finalize.click();
    await $("div*=No conflicts").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "conflict screen did not clear after finalize",
    });
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.read("conflict.txt")).toBe("ours change\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("resolves with accept-theirs", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await $('[data-testid="conflict-row"][data-path="conflict.txt"]').click();
    await $('[data-testid="accept-theirs"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "detail action bar missing",
    });
    await $('[data-testid="accept-theirs"]').click();
    // Same TOCTOU guard as the accept-ours test above (#35).
    const markResolvedBtn = $('[data-testid="mark-resolved"]');
    try {
      if (await markResolvedBtn.isExisting()) await markResolvedBtn.click();
    } catch {
      // button unmounted mid-flight — file already resolved
    }
    await browser.waitUntil(
      async () => $('[data-testid="conflict-finalize"]').isEnabled(),
      { timeout: 10_000, timeoutMsg: "Finalize never enabled" },
    );
    await $('[data-testid="conflict-finalize"]').click();
    await $("div*=No conflicts").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "conflict screen did not clear",
    });
    expect(repo.read("conflict.txt")).toBe("theirs change\n");
  });

  it("aborts a conflicted merge and restores the tree", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await $('[data-testid="conflict-abort"]').click(); // confirm already stubbed true
    await $("div*=No conflicts").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "abort did not clear conflict screen",
    });
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.read("conflict.txt")).toBe("ours change\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
