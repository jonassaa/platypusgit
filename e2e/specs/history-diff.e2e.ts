import { browser, $, $$, expect } from "@wdio/globals";
import { basicRepo, branchyRepo, dirtyRepo, TempRepo } from "../support/tempRepo";
import {
  commitListTotal,
  jsClickMenuItem,
  jsContextMenu,
  openRepo,
  resetApp,
  scrollCommitListTo,
  switchScreen,
} from "../support/app";

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
    // The list is windowed, so the number of MOUNTED rows is an implementation
    // detail. data-total is the model count (#68 G10).
    await browser.waitUntil(
      async () => (await commitListTotal()) === expected,
      { timeout: 20_000, timeoutMsg: `expected ${expected} commit rows` },
    );
    // graph geometry: each row's commit node renders as an svg <circle>
    await expect($('[data-testid="commit-row"] svg circle')).toBeExisting();
    // merge commit present — message text lives in a <span>, tag-scope it.
    await expect($("span*=merge feature")).toBeDisplayed();
  });

  it("reveals the selected commit's own diff inline (no screen switch)", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await switchScreen("history");

    await browser.waitUntil(
      async () => (await commitListTotal()) >= 5,
      { timeout: 20_000, timeoutMsg: "commit rows never appeared" },
    );

    // Default selection is the top row (the "merge feature" commit). Its
    // inline diff is against its first parent → the file the merge brought in.
    const detail = $('[data-testid="history-detail"]');
    await detail.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "inline diff detail region never appeared",
    });
    await $('[data-testid="history-detail"] [data-path="feature.txt"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "merge commit's inline changed file (feature.txt) never appeared",
    });

    // Selecting a different commit swaps the inline diff to that commit's own
    // change — the "fix: update a.txt" commit touched a.txt.
    await scrollCommitListTo("update a.txt");
    await $('[data-testid="commit-row"]*=update a.txt').click();
    await $('[data-testid="history-detail"] [data-path="a.txt"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "selected commit's inline changed file (a.txt) never appeared",
    });

    // Still on History (column headers present) — no jump to the diff screen.
    await expect($("span*=SUBJECT")).toBeDisplayed();
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

  // Issue #68 G2. basicRepo's messages are, oldest first: "feat: add a.txt",
  // "feat: add b.txt", "fix: update a.txt" — so searching "a.txt" matches the
  // oldest and newest with one commit elided between them, on one branch.
  //
  // The acceptance here is rendered geometry, not repo truth: the bug was that
  // the graph drew the wrong pixels for a correct history, so there is no
  // `repo.git(...)` analogue to assert against.
  it("keeps two same-branch search hits in one lane with no phantom lane", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await switchScreen("history");

    await browser.waitUntil(
      async () => (await commitListTotal()) === 3,
      { timeout: 20_000, timeoutMsg: "expected basicRepo's 3 commit rows" },
    );

    const search = $('[data-testid="history-search"]');
    await search.waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "history search input never appeared",
    });
    await search.setValue("a.txt");

    await browser.waitUntil(
      async () => (await commitListTotal()) === 2,
      {
        timeout: 20_000,
        timeoutMsg: "expected only the two commits whose message mentions a.txt",
      },
    );

    // Spread into a plain array: the awaited $$ result keeps async `map`/
    // `length`, which don't compose with Promise.all / arithmetic.
    const rows = [...(await $$('[data-testid="commit-row"]'))];
    expect(rows).toHaveLength(2);

    // Both hits sit in the SAME lane: their node dots share an x. Before the
    // fix each hit opened its own lane.
    const cxNewest = await rows[0]!.$("svg circle").getAttribute("cx");
    const cxOldest = await rows[1]!.$("svg circle").getAttribute("cx");
    expect(cxNewest).toEqual(cxOldest);

    // The elided span between them is drawn dashed.
    await expect($('[data-testid="commit-row"] [stroke-dasharray]')).toBeExisting();

    // THE PHANTOM LANE: the oldest match is basicRepo's root, so nothing may
    // continue below it. Before the fix a lane ran off the bottom of the list
    // toward the filtered-out parent.
    const trailing = [
      ...(await rows[1]!.$$('svg [data-lane-kind="half-bot"], svg [data-lane-kind="line"]')),
    ];
    expect(trailing).toHaveLength(0);
  });
});

// #158 — the diff entries on History's commit context menus. Appended as its own
// block so it merges cleanly alongside concurrent work in this file.
//
// Before #158 the single-commit menu's only diff-shaped entry was "Compare with
// HEAD" (that commit against the working tree), so right-clicking ONE commit and
// right-clicking SEVERAL offered two different comparisons. "View diff" is the
// commit's own diff — parent..commit, what Enter on the row and the inline panel
// already show — and it pairs with the selection's "View combined diff".
describe("history — the commit menu's diff entries (#158)", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it('"View diff" opens the commit\'s own diff (parent..commit)', async () => {
    repo = basicRepo();
    // basicRepo, oldest first: "feat: add a.txt", "feat: add b.txt",
    // "fix: update a.txt". The MIDDLE commit is the one to pick: it added b.txt
    // and nothing since touched that file, so b.txt on screen can only come
    // from parent..commit — "Compare with HEAD" would show a.txt (changed by
    // the newer commit) and no b.txt at all.
    const sha = repo.git("rev-parse", "--short=7", "HEAD~1").trim();
    await openRepo(repo.path);
    await switchScreen("history");
    await $("span*=SUBJECT").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "history column headers never appeared",
    });
    await scrollCommitListTo("feat: add b.txt");

    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add b.txt" });
    // Exact span text, so this can never match "View combined diff".
    await jsClickMenuItem("View diff");

    // The destination's own header first — it names the commit that was routed,
    // so a mis-routed intent fails here rather than as a mute timeout on a file
    // row (the lesson history-ops.e2e.ts records at length).
    await $(`div*=Diff ${sha} (this commit)`).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: `the commit-diff header never showed ${sha} (this commit)`,
    });
    // Then the file row, scoped to the commit-diff file pane: a bare
    // `[data-pg-row]*=b.txt` would also match History's own row for
    // "feat: add b.txt", which the screen switch is about to unmount.
    await $(
      '[data-pg-pane="commitDiff.files"] [data-pg-row][data-path="b.txt"]',
    ).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the commit's own diff never listed b.txt",
    });
  });

  it('"Compare with HEAD" is still there beside it, and still compares with the working tree', async () => {
    repo = basicRepo();
    const sha = repo.git("rev-parse", "--short=7", "HEAD~1").trim();
    await openRepo(repo.path);
    await switchScreen("history");
    await $("span*=SUBJECT").waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "history column headers never appeared",
    });
    await scrollCommitListTo("feat: add b.txt");

    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: add b.txt" });
    await jsClickMenuItem("Compare with HEAD");

    // Its own header spelling — proof the two entries route differently rather
    // than one having quietly replaced the other.
    await $(`div*=Diff ${sha} → HEAD`).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: `the commit-diff header never showed ${sha} → HEAD`,
    });
  });
});
