import { browser, $, expect } from "@wdio/globals";
import { cherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsHoverMenuItem, jsClickMenuItem, jsSelectValue,
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
