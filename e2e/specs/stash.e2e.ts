import { $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  changeRow,
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  stubNativeDialogs,
  switchScreen,
  WORKING_TREE_CLEAN,
} from "../support/app";

describe("stash", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
    await changeRow("a.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the changes list",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("stash save cleans the tree; pop restores it", async () => {
    // Stub window.prompt AFTER the last page load (openRepo already
    // happened in beforeEach) and BEFORE clicking Stash, which reads it.
    await stubNativeDialogs({ promptText: "e2e stash" });
    await $("button*=Stash").click();

    await $(WORKING_TREE_CLEAN).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state after stash",
    });
    expect(repo.git("stash", "list")).toContain("e2e stash");

    // Pop from the Branches screen stash section.
    await switchScreen("branches");
    const stashRow = $("span*=stash@{0}");
    await stashRow.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "stash row never appeared in branches screen",
    });
    await stashRow.click();

    const popButton = $("button*=Pop");
    await popButton.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Pop button never appeared after selecting stash row",
    });
    await popButton.click();

    await switchScreen("commit");
    await changeRow("a.txt").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "changes list did not show a.txt after stash pop",
    });
    expect(repo.git("stash", "list").trim()).toBe("");
  });

  // #133. A rename is a store followed by a drop, and `git stash store` is a
  // SILENT no-op when refs/stash already points at the commit — which is
  // stash@{0}, the entry a user is most likely to rename. So the acceptance
  // here is not just "the message changed": it is that the entry still exists
  // and still applies. A naive implementation leaves zero stashes and reports
  // success.
  it("renames the top stash without losing it", async () => {
    // ONE stub call with a queue, not two calls: each call installs another
    // MutationObserver without disconnecting the previous one, so a second
    // call would race the first for the rename prompt.
    await stubNativeDialogs({
      promptQueue: ["before rename", "renamed by e2e"],
    });
    await $("button*=Stash").click();
    await $(WORKING_TREE_CLEAN).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "commit panel did not return to clean state after stash",
    });

    await switchScreen("branches");
    const stashRow = $("span*=stash@{0}");
    await stashRow.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "stash row never appeared in branches screen",
    });
    await stashRow.click();

    const renameButton = $("button*=Rename");
    await renameButton.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "Rename button never appeared after selecting the stash row",
    });
    // The prompt is prefilled with the current message; the queued stub
    // replaces it with the second entry.
    await renameButton.click();

    // The UI, not `git stash list` — same trap as the partial-stash test below.
    // A rename is a store followed by a drop, so the new message is on the
    // reflog while the ORIGINAL entry is still there; gating on the list would
    // race the drop and see two entries. The row repainting can only happen
    // after the whole backend call returned.
    await $("div*=renamed by e2e").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the stash row never showed the new name",
    });

    const list = repo.git("stash", "list").trim().split("\n").filter(Boolean);
    expect(list.length).toBe(1);
    expect(list[0]).toContain("renamed by e2e");
    expect(list[0]).not.toContain("before rename");

    // Still a working stash, not just a reflog line.
    repo.git("stash", "apply", "stash@{0}");
    expect(repo.read("a.txt")).toContain("dirty");
  });

  // #133. `dirtyRepo` leaves a.txt modified, staged.txt staged and new.txt
  // untracked, so stashing ONE path is a real selection rather than the whole
  // worktree by another name.
  //
  // NOTE the wait condition. It must be the UI, never `git stash list`:
  // `git stash push` updates `refs/stash` and only THEN restores the working
  // tree, so the entry is observable while a.txt is still dirty. Gating on the
  // list therefore races the very revert being asserted (it did, and CI caught
  // it). a.txt leaving the CHANGES list is a signal that can only appear after
  // the whole backend call returned.
  it("stashes a single file and leaves the rest of the worktree dirty", async () => {
    await stubNativeDialogs({ promptText: "just a.txt" });
    await jsContextMenu('[data-testid="changes-list"] [data-path="a.txt"]');
    await jsClickMenuItem("Stash this file…");

    await changeRow("a.txt").waitForExist({
      reverse: true,
      timeout: 20_000,
      timeoutMsg: "a.txt never left the changes list after the partial stash",
    });

    // a.txt is back to its committed content; nothing else moved.
    expect(repo.git("stash", "list")).toContain("just a.txt");
    expect(repo.read("a.txt")).not.toContain("dirty");
    expect(repo.git("status", "--short")).toContain("new.txt");
    expect(repo.git("status", "--short")).toContain("staged.txt");
  });
});
