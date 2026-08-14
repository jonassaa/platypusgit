import { browser, $, expect } from "@wdio/globals";
import {
  basicRepo,
  worktreeParent,
  type TempRepo,
  type WorktreeParent,
} from "../support/tempRepo";
import {
  openRepo,
  resetApp,
  stubNativeDialogs,
  switchScreen,
} from "../support/app";

/**
 * Linked worktrees (#93), end to end: real `git worktree` admin files, driven
 * through the app's own screen.
 *
 * Every worktree here is created under a throwaway tempdir. Nothing in this spec
 * may point at the repository the suite is running in — this project is developed
 * through `.claude/worktrees/`, and a remove aimed at the wrong path would delete
 * a live checkout.
 */
describe("linked worktrees", () => {
  let repo: TempRepo | null = null;
  let parent: WorktreeParent | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = null;
    parent?.dispose();
    parent = null;
  });

  it("adds a worktree on a new branch, then removes it", async () => {
    repo = basicRepo();
    parent = worktreeParent();
    await openRepo(repo.path);
    await switchScreen("worktrees");

    // A fresh repo has no LINKED worktrees — the main one is the repo itself.
    await $("div*=No linked worktrees").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "worktrees screen never showed its empty state",
    });

    await $('[data-testid="worktrees-add"]').click();
    await $('[data-testid="worktree-parent"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "add-worktree dialog never opened",
    });
    // The parent path is typed rather than picked: the Browse button opens the
    // native folder chooser, which WebDriver cannot drive.
    await $('[data-testid="worktree-parent"]').setValue(parent.path);
    await $('[data-testid="worktree-name"]').setValue("wt-alpha");
    await $('[data-testid="worktree-new-branch"]').setValue("feature/alpha");
    await $('[data-testid="worktree-submit"]').click();

    const row = $('[data-testid="worktree-row"][data-name="wt-alpha"]');
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the new worktree never appeared in the list",
    });

    // Repo truth is the acceptance. The branch is the one that was TYPED, not the
    // worktree name — libgit2's reference-less default would have created a branch
    // called "wt-alpha".
    const listed = repo.git("worktree", "list", "--porcelain");
    expect(listed).toContain("feature/alpha");
    expect(listed).toContain("wt-alpha");
    expect(repo.hasRef("refs/heads/feature/alpha")).toBe(true);

    // Removing deletes a checkout, so it is confirmed. The worktree is clean, so
    // one gate is all there is.
    await stubNativeDialogs();
    await row.$('[data-testid="worktree-remove"]').click();
    await browser.waitUntil(
      async () => !(await row.isExisting()),
      {
        timeout: 20_000,
        timeoutMsg: "the worktree row never disappeared after remove",
      },
    );
    expect(repo.git("worktree", "list", "--porcelain")).not.toContain("wt-alpha");
    // The branch survives the worktree — removing a checkout is not deleting work.
    expect(repo.hasRef("refs/heads/feature/alpha")).toBe(true);
  });

  it("locks a worktree, and says why on the row", async () => {
    repo = basicRepo();
    parent = worktreeParent();
    await openRepo(repo.path);
    await switchScreen("worktrees");
    await $('[data-testid="worktrees-add"]').click();
    await $('[data-testid="worktree-parent"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "add-worktree dialog never opened",
    });
    await $('[data-testid="worktree-parent"]').setValue(parent.path);
    await $('[data-testid="worktree-name"]').setValue("wt-beta");
    await $('[data-testid="worktree-new-branch"]').setValue("feature/beta");
    await $('[data-testid="worktree-submit"]').click();

    const row = $('[data-testid="worktree-row"][data-name="wt-beta"]');
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the new worktree never appeared in the list",
    });

    // The lock prompt is answered by the dialog observer; "e2e" is its default.
    await stubNativeDialogs({ promptText: "removable drive" });
    await row.$('[data-testid="worktree-lock"]').click();
    await browser.waitUntil(
      async () => repo!.git("worktree", "list", "--porcelain").includes("locked"),
      {
        timeout: 20_000,
        timeoutMsg: "git never recorded the worktree as locked",
      },
    );
    await $("span*=removable drive").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "the lock reason never showed on the row",
    });
  });
});
