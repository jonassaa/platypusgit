import { browser, $, expect } from "@wdio/globals";
import { cherryRepo, multiCherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsHoverMenuItem, jsClickMenuItem, jsSelectValue, jsChord,
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
    await browser.waitUntil(
      async () => repo.git("rev-parse", "HEAD").trim() === parent,
      { timeout: 20_000, timeoutMsg: "hard reset did not move HEAD" },
    );
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  // #27 (ref-scoped log): the History toolbar ref selector scopes the
  // backend log walk to any local branch, so an unmerged branch's commits
  // (cherry.txt on `feature`) become browsable — and cherry-pickable via
  // the detail action row — while `main` is checked out.
  it("cherry-picks the feature commit onto main via the ref selector", async () => {
    // Scope the log to the unmerged `feature` branch. jsSelectValue, not
    // selectByAttribute: WebKitGTK accepts the option click without firing a
    // React-visible change event (see helper doc), so the log never rescopes.
    await $('[data-testid="history-ref-select"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "history ref selector missing",
    });
    await jsSelectValue('[data-testid="history-ref-select"]', "feature");
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
    await $('[data-testid="commit-row"]*=fix: update a.txt').click();
    await jsChord("Shift+ArrowDown"); // extend to "feat: add b.txt"
    await $("div*=2 commits selected").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "multi-select detail never appeared",
    });
    await $("button*=View combined diff").click();
    // Oldest selected = "feat: add b.txt" (parent "feat: add a.txt"); newest =
    // "fix: update a.txt". The combined diff therefore introduces b.txt.
    await $('[data-pg-row]*=b.txt').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "combined diff did not list b.txt",
    });
  });

  it("reverts HEAD", async () => {
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
    // while `main` stays checked out (jsSelectValue — see history-ref-select).
    await $('[data-testid="history-ref-select"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "history ref selector missing",
    });
    await jsSelectValue('[data-testid="history-ref-select"]', "feature");
    await $('[data-testid="commit-row"]*=feat: add d.txt').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "feature commits not visible after scoping",
    });
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("cherry-picks two selected commits onto main oldest→newest", async () => {
    // Select the top two feature commits (d.txt then, extending up, c.txt).
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
