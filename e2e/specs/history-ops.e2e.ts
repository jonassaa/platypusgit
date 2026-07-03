import { browser, $, expect } from "@wdio/globals";
import { cherryRepo, TempRepo } from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsHoverMenuItem, jsClickMenuItem,
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

  // BLOCKED — pending #27 (ref-scoped log).
  //
  // All three documented fallback paths (History "All" filter → context
  // menu → in-page ⌘P palette) draw the commit list from the exact same
  // frontend state, `useRepoStore.commits`, which the backend populates
  // via a revwalk that only ever calls `push_head()` — see `log()` and
  // `log_filtered()` in src-tauri/src/git/libgit2.rs. There is no code
  // path anywhere in the backend that unions in other refs, so a commit
  // that only exists on an unmerged branch (cherry.txt on `feature`) can
  // never appear while `main` is checked out, no matter which client-side
  // filter/search/picker is used on top of that list.
  //
  // Verified empirically against the live e2e build (cherryRepo, HEAD on
  // main):
  //   1. History screen, "All" filterKind button clicked: the rendered
  //      `[data-testid="commit-row"]` set is exactly the 3 main-branch
  //      commits (fix: update a.txt / feat: add b.txt / feat: add a.txt).
  //      "feat: cherry commit" never renders — nothing to right-click for
  //      the context-menu fallback either, since it reads the same rows.
  //   2. In-page palette (`window.dispatchEvent(new KeyboardEvent("keydown",
  //      {key:"p", metaKey:true, bubbles:true}))` opens
  //      `[role="dialog"][aria-label="Command palette"]` fine) → "Cherry-pick
  //      commit…" step lists the identical 3 commits
  //      (`commitItems()` in features/palette/commands.ts sources
  //      `repoState().commits`, the same array).
  //
  // Per the task brief: do not fake this by shelling `git cherry-pick`.
  // Fixing it for real needs a backend change (e.g. a "log another ref"
  // command) that's out of scope for this E2E task.
  it.skip("cherry-picks the feature commit onto main — BLOCKED, no UI path surfaces an unmerged branch's commits (see comment above)", async () => {
    await $("button*=All").click();
    const row = $('[data-testid="commit-row"]*=feat: cherry commit');
    await row.waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "feature commit not visible under All filter — see fallback note",
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
