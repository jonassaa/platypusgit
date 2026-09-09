import { browser, $, expect } from "@wdio/globals";
import { cherryRepo, multiCherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsHoverMenuItem, jsClickMenuItem, jsPickOption, jsChord,
  scrollCommitListTo, waitHeadMarkerOn,
} from "../support/app";

describe("history danger ops", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = cherryRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true, promptText: "e2e" });
    await switchScreen("history");
    await $("span*=SUBJECT").waitForDisplayed({
      timeout: 15_000, timeoutMsg: "history screen not ready",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("reset soft moves HEAD and keeps changes staged", async () => {
    const parent = repo.git("rev-parse", "HEAD~1").trim();
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add b.txt" });
    await jsHoverMenuItem("Reset current branch to here");
    await jsClickMenuItem("Soft (keep changes staged)");
    await browser.waitUntil(
      async () => repo.git("rev-parse", "HEAD").trim() === parent,
      { timeout: 20_000, timeoutMsg: "soft reset did not move HEAD" },
    );
    expect(repo.git("diff", "--cached", "--name-only")).toContain("a.txt");
  });

  it("reset hard moves HEAD and cleans the tree", async () => {
    const parent = repo.git("rev-parse", "HEAD~1").trim();
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add b.txt" });
    await jsHoverMenuItem("Reset current branch to here");
    await jsClickMenuItem("Hard (discard changes)");
    // The UI, not `rev-parse HEAD` — unlike the soft case above, this reset has
    // work left to do after the ref moves. libgit2 writes in the order
    // checkout → HEAD → index (`reset.c`), so the branch ref is readable while
    // the INDEX still holds the old tree, and `git status` compares against
    // HEAD: it would report a.txt as staged and lose the race with the
    // clean-tree assertion below. The HEAD marker moving to the parent's row
    // can only paint after `refreshAll` re-read the branch tip, which is
    // strictly after the whole reset call returned.
    await waitHeadMarkerOn("feat: add b.txt");
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(parent);
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  // #27 (ref-scoped log): the History toolbar ref selector scopes the
  // backend log walk to any local branch, so an unmerged branch's commits
  // (cherry.txt on `feature`) become browsable — and cherry-pickable via
  // the detail action row — while `main` is checked out.
  it("cherry-picks the feature commit onto main via the ref selector", async () => {
    // Scope the log to the unmerged `feature` branch. jsPickOption drives the
    // in-page listbox that replaced the native <select> (issue 146); the old
    // WebDriver selectByAttribute route accepted the option click without firing a
    // React-visible change event (see helper doc), so the log never rescopes.
    await $('[data-testid="history-ref-select"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "history ref selector missing",
    });
    await jsPickOption('[data-testid="history-ref-select"]', "feature");
    await scrollCommitListTo("feat: cherry commit");
    const row = $('[data-testid="commit-row"]*=feat: cherry commit');
    await row.waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "feature commit not visible after scoping log to feature",
    });
    await row.click();
    await $('[data-testid="commit-cherry-pick"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "detail action row missing",
    });
    await $('[data-testid="commit-cherry-pick"]').click(); // confirm stubbed
    await browser.waitUntil(
      async () => repo.git("log", "-1", "--pretty=%s").includes("feat: cherry commit"),
      { timeout: 20_000, timeoutMsg: "cherry-pick commit never landed" },
    );
    expect(repo.read("cherry.txt")).toBe("cherry\n");
    expect(repo.git("branch", "--show-current").trim()).toBe("main");
  });

  // #54: multi-select two commits → the detail pane offers a combined diff of
  // the whole selection (parent-of-oldest → newest), routed through the
  // existing commit-vs-commit → CommitDiff path.
  it("shows a combined diff of a multi-commit selection", async () => {
    // Click HEAD row (focuses the list pane + selects it), then Shift+ArrowDown
    // extends the range by one. jsChord: the driver can't synthesize modifiers.
    await scrollCommitListTo("fix: update a.txt");
    await $('[data-testid="commit-row"]*=fix: update a.txt').click();
    await jsChord("Shift+ArrowDown"); // extend to "feat: add b.txt"
    await $("div*=2 commits selected").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "multi-select detail never appeared",
    });
    // Oldest selected = "feat: add b.txt" (parent "feat: add a.txt"); newest =
    // "fix: update a.txt". The combined diff therefore runs
    // parent-of-oldest → newest and introduces b.txt. Both shas come from repo
    // truth, sliced to 7 the way `targetHeader` renders them.
    const from = repo.git("rev-parse", "HEAD~2").trim().slice(0, 7);
    const to = repo.git("rev-parse", "HEAD").trim().slice(0, 7);
    await $("button*=View combined diff").click();

    // TWO waits, in this order, and neither is redundant.
    //
    // First the DESTINATION screen's own header — a signal that exists only
    // after the transition, and one that names the pair that was routed, so a
    // mis-routed selection fails HERE saying so, instead of as a mute timeout
    // on a file row further down.
    await $(`div*=Diff ${from} → ${to}`).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: `the commit-diff header never showed ${from} → ${to}`,
    });
    // Then the file row, as a PURE CSS selector scoped to the commit-diff file
    // pane. This used to be `[data-pg-row]*=b.txt`, which ALSO matches
    // History's commit row for "feat: add b.txt" — and that is what made this
    // the suite's most frequent CI failure. Resolved a moment too early (more
    // likely the busier the machine), the handle binds to a row the screen
    // switch is about to unmount, and `waitForDisplayed` cannot recover from
    // that: `isDisplayed` is a `browser.execute(checkVisibility, elem)` with the
    // element passed as an argument, and a DETACHED node answers honestly
    // (`false`, and `getComputedStyle` returns empty rather than throwing), so no
    // stale-element error is ever raised and WebdriverIO's refetch never fires.
    // Measured: 4 failures in 10 under CPU contention with the old selector,
    // 0 in 10 with this pair of waits, and 1/1 when the binding is forced
    // deliberately — in every failure the real b.txt row was on screen for the
    // whole 25s. Raising the deadline (15s → 25s, which was tried) could never
    // have helped.
    await $(
      '[data-pg-pane="commitDiff.files"] [data-pg-row][data-path="b.txt"]',
    ).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the combined diff never listed b.txt",
    });
  });

  it("reverts HEAD", async () => {
    await scrollCommitListTo("fix: update a.txt");
    const row = $('[data-testid="commit-row"]*=fix: update a.txt');
    await row.waitForDisplayed({ timeout: 15_000, timeoutMsg: "HEAD row missing" });
    await row.click();
    await $('[data-testid="commit-revert"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "detail action row missing",
    });
    await $('[data-testid="commit-revert"]').click(); // confirm stubbed
    await browser.waitUntil(
      async () => repo.git("log", "-1", "--pretty=%s").startsWith("Revert"),
      { timeout: 20_000, timeoutMsg: "revert commit never landed" },
    );
    expect(repo.read("a.txt")).toBe("alpha v1\n");
  });
});

// #54: cherry-pick a *set* of commits onto the current branch, oldest→newest,
// via the multi-selection action row (cherryPickMany loops the single op).
describe("history multi cherry-pick", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = multiCherryRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    await $("span*=SUBJECT").waitForDisplayed({
      timeout: 15_000, timeoutMsg: "history screen not ready",
    });
    // Scope the log to `feature` so its two unmerged commits are browsable
    // while `main` stays checked out (jsPickOption — see history-ref-select).
    await $('[data-testid="history-ref-select"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "history ref selector missing",
    });
    await jsPickOption('[data-testid="history-ref-select"]', "feature");
    await scrollCommitListTo("feat: add d.txt");
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("cherry-picks two selected commits onto main oldest→newest", async () => {
    // Select the top two feature commits (d.txt then, extending up, c.txt).
    await scrollCommitListTo("feat: add d.txt");
    await $('[data-testid="commit-row"]*=feat: add d.txt').click();
    await jsChord("Shift+ArrowDown"); // extend to "feat: add c.txt"
    await $("div*=2 commits selected").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "multi-select detail never appeared",
    });
    await $('[data-testid="multi-cherry-pick"]').click(); // confirm stubbed
    // Both picks land on main, oldest (c) before newest (d).
    await browser.waitUntil(
      async () => {
        const log = repo.git("log", "main", "--pretty=%s");
        return log.includes("feat: add c.txt") && log.includes("feat: add d.txt");
      },
      { timeout: 25_000, timeoutMsg: "both cherry-picks never landed on main" },
    );
    expect(repo.read("c.txt")).toBe("charlie\n");
    expect(repo.read("d.txt")).toBe("delta\n");
    expect(repo.git("branch", "--show-current").trim()).toBe("main");
  });
});

describe("rewording a commit", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  // THE case a one-step rebase plan cannot serve: the rebase engine refuses any
  // worktree or index modification, so routing HEAD through a plan would fail
  // for anyone with uncommitted work — which is most reword attempts. This
  // asserts the message changed AND that the dirt is still exactly where it was.
  it("rewords HEAD with a dirty worktree, consuming none of it", async () => {
    repo = cherryRepo(); // main: 3 commits, HEAD = "fix: update a.txt"
    // Dirty BEFORE openRepo — the store reads status once, on open.
    repo.write("a.txt", "dirty unstaged\n");
    repo.write("untracked.txt", "not staged\n");
    repo.write("staged.txt", "staged before the reword\n");
    repo.git("add", "staged.txt");
    const treeBefore = repo.git("rev-parse", "HEAD^{tree}").trim();

    await openRepo(repo.path);
    await stubNativeDialogs({ promptText: "reworded by e2e", confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("fix: update a.txt");
    await $('[data-testid="commit-row"]*=fix: update a.txt').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "HEAD row missing",
    });

    await jsContextMenu('[data-testid="commit-row"]', { text: "fix: update a.txt" });
    await jsClickMenuItem("Edit commit message…");

    // History repaints only once the backend call has returned, so this cannot
    // match an intermediate state the way a `log -1` poll could.
    await $('[data-testid="commit-row"]*=reworded by e2e').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "History never showed the reworded commit",
    });

    // Message rewritten, tree untouched, history the same length: an amend, not
    // a replay.
    expect(repo.git("log", "-1", "--pretty=%B")).toContain("reworded by e2e");
    expect(repo.git("rev-parse", "HEAD^{tree}").trim()).toBe(treeBefore);
    expect(repo.git("rev-list", "--count", "HEAD").trim()).toBe("3");

    // And every kind of dirt survived, unconsumed. The staged file in
    // particular must NOT be in the reworded commit — that is what separates
    // this op from commit(amend: true).
    expect(repo.read("a.txt")).toBe("dirty unstaged\n");
    expect(repo.read("untracked.txt")).toBe("not staged\n");
    expect(repo.git("diff", "--cached", "--name-only")).toContain("staged.txt");
    expect(repo.git("ls-tree", "--name-only", "HEAD")).not.toContain("staged.txt");
  });

  // Reading the tree AS IT WAS, which changes nothing — the other half of what
  // the commit menu gained. The assertion is that the browser lists a file that
  // exists at that revision and NOT one added later: that is what proves the
  // at-rev backend call drove the tree, rather than the working copy.
  it("browses the repository at a commit's revision", async () => {
    repo = cherryRepo(); // a.txt at the root commit, b.txt added later
    await openRepo(repo.path);
    await switchScreen("history");
    await scrollCommitListTo("feat: add a.txt");
    await $('[data-testid="commit-row"]*=feat: add a.txt').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "root-ish row missing",
    });

    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add a.txt" });
    await jsClickMenuItem("Show repository at this revision");

    // The browser says which revision it is on — a reader must be able to tell
    // this is not the working tree. Waits on the TESTID, not the copy.
    await $('[data-testid="browsing-rev"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the repo browser never entered at-rev mode",
    });
    // a.txt existed at that commit; b.txt did not.
    await $('[data-pg-row][data-path="a.txt"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "a.txt was not listed at that revision",
    });
    await expect($('[data-pg-row][data-path="b.txt"]')).not.toBeExisting();
    // Nothing was written.
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  // The other path: an older commit goes through the rebase engine's Reword
  // action, which replays every commit after it.
  it("rewords an older commit and replays the commits after it", async () => {
    repo = cherryRepo();
    const headBefore = repo.git("rev-parse", "HEAD").trim();

    await openRepo(repo.path);
    await stubNativeDialogs({ promptText: "reworded parent", confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("feat: add b.txt");
    await $('[data-testid="commit-row"]*=feat: add b.txt').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "target row missing",
    });

    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add b.txt" });
    await jsClickMenuItem("Edit commit message…");

    await $('[data-testid="commit-row"]*=reworded parent').waitForDisplayed({
      timeout: 25_000, timeoutMsg: "History never showed the reworded commit",
    });

    // The reworded message is in history, the descendant survived, and HEAD is a
    // NEW commit because it was replayed onto the reworded parent.
    const log = repo.git("log", "--pretty=%s");
    expect(log).toContain("reworded parent");
    expect(log).toContain("fix: update a.txt");
    expect(log).not.toContain("feat: add b.txt");
    expect(repo.git("rev-parse", "HEAD").trim()).not.toBe(headBefore);
    expect(repo.git("rev-list", "--count", "HEAD").trim()).toBe("3");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
