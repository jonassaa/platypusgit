// Merge + conflict flow after #108: there is no Conflicts screen. The operation
// bar is what announces the conflicted merge and carries Finalize/Abort, and a
// conflicted row's own context menu is where a single file gets resolved.

import { browser, $, expect } from "@wdio/globals";
import { conflictRepo, cherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, stubNativeDialogs, switchScreen,
  jsContextMenu, jsClickMenuItem,
} from "../support/app";

/** Open picker, context-menu the branch row, click "Merge into current".
 *  Confirm dialogs must already be stubbed. */
async function mergeBranchViaPicker(name: string): Promise<void> {
  await $('[data-testid="branch-chip"]').click();
  const row = $(`[data-branch-row]*=${name}`);
  await row.waitForDisplayed({ timeout: 10_000, timeoutMsg: `branch row ${name} missing` });
  await jsContextMenu(`[data-branch-row]`, { text: name });
  await jsClickMenuItem("Merge into current");
}

/** conflictRepo + open + stub + merge clash → wait for the operation bar, which
 *  is the app's signal that a conflicted merge is open. */
async function startConflictedMerge(repo: TempRepo): Promise<void> {
  await openRepo(repo.path);
  await stubNativeDialogs({ confirm: true });
  await mergeBranchViaPicker("clash");
  await $('[data-testid="operation-bar"]').waitForDisplayed({
    timeout: 20_000, timeoutMsg: "operation bar never announced the conflicted merge",
  });
}

/** Resolve one file from its row in the Files screen, whose "changes" filter
 *  lists a conflicted file.
 *
 *  Switching there explicitly, and scoping the row to the tree pane, both
 *  matter: the app opens on History now, and History's diff panel ALSO renders
 *  `[data-pg-row][data-path=…]` rows. An unscoped selector matched one of those
 *  and then died on a context menu that has no "Accept ours" in it. */
async function resolveViaRowMenu(path: string, item: string): Promise<void> {
  await switchScreen("repo");
  const selector = `[data-pg-pane="repo.tree"] [data-pg-row][data-path="${path}"]`;
  const row = $(selector);
  await row.waitForDisplayed({
    timeout: 20_000, timeoutMsg: `conflicted row ${path} never appeared in Files`,
  });
  await jsContextMenu(selector);
  await jsClickMenuItem(item);
}

/** Nothing conflicted left → the bar offers the finish verb. Click it and wait
 *  for the bar itself to go: `repoState` back to Clean is the UI signal. */
async function finalizeOperation(): Promise<void> {
  const finish = $('[data-testid="operation-continue"]');
  await finish.waitForDisplayed({
    timeout: 20_000, timeoutMsg: "Finalize never appeared after resolving",
  });
  await finish.click();
  await $('[data-testid="operation-bar"]').waitForDisplayed({
    reverse: true, timeout: 20_000,
    timeoutMsg: "operation bar stayed up after finalize",
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

  it("announces the conflicted merge without any manual refresh", async () => {
    repo = conflictRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await mergeBranchViaPicker("clash");
    // error banner appears...
    await $('[role="alert"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "error banner never appeared",
    });
    // ...AND the operation bar says what is open and what is left, WITHOUT a
    // manual refresh (the refreshAll-on-error path in the store).
    const detail = $('[data-testid="operation-detail"]');
    await detail.waitForDisplayed({
      timeout: 20_000, timeoutMsg: "operation bar never appeared — refreshAll-on-error missing?",
    });
    await expect(detail).toHaveText("1 conflict to resolve", { containing: true });
    await expect($('[data-testid="operation-title"]')).toHaveText("Merge in progress", {
      containing: true,
    });
    // ...AND the status bar agrees. Scoped to the bar: "1 conflict" is also a
    // substring of the operation bar's own detail text.
    await $('[data-testid="status-bar"]').$("span*=1 conflict").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "status-bar conflict badge never appeared",
    });
    expect(repo.hasRef("MERGE_HEAD")).toBe(true);
  });

  it("resolves with accept-ours from the file row and finalizes", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await resolveViaRowMenu("conflict.txt", "Accept ours");
    await finalizeOperation();
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.read("conflict.txt")).toBe("ours change\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("resolves with accept-theirs from the file row", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await resolveViaRowMenu("conflict.txt", "Accept theirs");
    await finalizeOperation();
    expect(repo.read("conflict.txt")).toBe("theirs change\n");
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
  });

  it("aborts a conflicted merge and restores the tree", async () => {
    repo = conflictRepo();
    await startConflictedMerge(repo);
    await $('[data-testid="operation-abort"]').click(); // confirm already stubbed true
    await $('[data-testid="operation-bar"]').waitForDisplayed({
      reverse: true, timeout: 20_000,
      timeoutMsg: "operation bar stayed up after abort",
    });
    expect(repo.hasRef("MERGE_HEAD")).toBe(false);
    expect(repo.read("conflict.txt")).toBe("ours change\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
