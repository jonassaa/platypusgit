import { browser, $, $$, expect } from "@wdio/globals";
import { branchyRepo, dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

describe("history & diff", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("renders one row per commit with graph markup on a branchy repo", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await switchScreen("history");

    // column header text is inside a <span>, not an anchor — scope the tag.
    await $("span*=SUBJECT").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "history column headers never appeared",
    });
    const expected = Number(repo.git("rev-list", "--count", "HEAD").trim()); // 5
    await browser.waitUntil(
      async () => (await $$('[data-testid="commit-row"]').length) === expected,
      { timeout: 20_000, timeoutMsg: `expected ${expected} commit rows` },
    );
    // graph geometry: each row's commit node renders as an svg <circle>
    await expect($('[data-testid="commit-row"] svg circle')).toBeExisting();
    // merge commit present — message text lives in a <span>, tag-scope it.
    await expect($("span*=merge feature")).toBeDisplayed();
  });

  it("shows a hunk for a modified file and stages it", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    // Files screen renders inline diff on row click
    await switchScreen("repo");
    const row = $('[data-path="a.txt"]');
    await row.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "a.txt tree row never appeared",
    });
    await row.click();

    const stageBtn = $('[data-testid="hunk-stage"]');
    await stageBtn.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "hunk stage button never appeared for a.txt diff",
    });
    await stageBtn.click();

    // No UI signal distinguishes "staged" from "staging in flight" faster
    // than the button's own label flip, and that label is derived from the
    // same staged state we ultimately care about — so poll repo truth
    // directly (brief authorizes this for the write-acceptance step).
    await browser.waitUntil(
      async () => repo.git("diff", "--cached", "--name-only").includes("a.txt"),
      { timeout: 20_000, timeoutMsg: "hunk stage did not reach the index" },
    );
  });
});
