import { browser, $, expect } from "@wdio/globals";
import {
  remoteRepo, makeAhead, makeBehind, makeDiverged, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsClickMenuItem,
} from "../support/app";

describe("remote operations", () => {
  let pair: RemotePair | null = null;

  afterEach(async () => {
    await resetApp();
    pair?.dispose();
    pair = null;
  });

  it("lists origin with url; ahead count shows on the ahead fixture", async () => {
    pair = remoteRepo();
    makeAhead(pair);
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    const row = $('[data-remote="origin"]');
    await row.waitForDisplayed({ timeout: 10_000, timeoutMsg: "origin row missing" });
    expect(await row.getText()).toContain(pair.barePath);
    // Sync-status card: Upstream tile tracks origin/main, Ahead tile is 1.
    await $("div*=origin/main").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "upstream tile never showed origin/main",
    });
    await $("span*=↑1").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "ahead indicator never appeared",
    });
  });

  it("push advances the bare remote and clears the ahead badge", async () => {
    pair = remoteRepo();
    makeAhead(pair);
    await openRepo(pair.repo.path);
    const localHead = pair.repo.git("rev-parse", "HEAD").trim();
    await $("button*=Push").click(); // titlebar (default screen — unambiguous)
    // repo-truth wait: bare repo receiving the commit IS the outcome.
    await browser.waitUntil(
      async () => pair!.bareGit("rev-parse", "main").trim() === localHead,
      { timeout: 20_000, timeoutMsg: "bare remote never received the push" },
    );
    await browser.waitUntil(async () => !(await $("span*=↑1").isExisting()), {
      timeout: 20_000, timeoutMsg: "ahead badge did not clear after push",
    });
  });

  it("pull brings the remote-only commit into the worktree", async () => {
    pair = remoteRepo();
    makeBehind(pair);
    await openRepo(pair.repo.path);
    await $("button*=Pull").click(); // titlebar
    // The UI, not the pulled file on disk. A fast-forward writes the worktree
    // and the index FIRST and moves the ref LAST (git's `checkout_fast_forward`
    // then `update_ref`), so remote.txt is readable while HEAD is still on the
    // old commit — and BOTH assertions below read the ref: `git status`
    // compares the index against HEAD (it would report remote.txt as a staged
    // addition) and `log -1` IS the ref. `makeBehind` rewinds the
    // remote-tracking ref too, so this commit is in no local ref before the
    // pull and its row can only render after refreshAll.
    await $('[data-testid="commit-row"]*=feat: remote-only commit')
      .waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: "the pulled commit never appeared in the log",
      });
    expect(pair.repo.read("remote.txt")).toBe("remote\n");
    expect(pair.repo.git("status", "--porcelain").trim()).toBe("");
    expect(pair.repo.git("log", "-1", "--pretty=%s").trim())
      .toBe("feat: remote-only commit");
  });

  it("fetch surfaces behind count without touching the worktree", async () => {
    pair = remoteRepo();
    makeBehind(pair);
    await openRepo(pair.repo.path);
    const headBefore = pair.repo.git("rev-parse", "HEAD").trim();
    await $("button*=Fetch").click(); // titlebar → fetchAll
    await $("span*=↓1").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "behind badge never appeared after fetch",
    });
    expect(pair!.repo.git("rev-parse", "HEAD").trim()).toBe(headBefore);
    expect(() => pair!.repo.read("remote.txt")).toThrow(); // fetch ≠ merge
  });

  it("adds a remote via the two-prompt flow", async () => {
    pair = remoteRepo();
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    await stubNativeDialogs({ promptQueue: ["backup", pair.barePath] });
    await $("button*=Add remote").click();
    await $('[data-remote="backup"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "backup remote row never appeared",
    });
    expect(pair.repo.git("remote", "get-url", "backup").trim()).toBe(pair.barePath);
  });

  it("removes a remote via the context menu", async () => {
    pair = remoteRepo();
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    await $('[data-remote="origin"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "origin row missing",
    });
    await stubNativeDialogs({ confirm: true });
    await jsContextMenu('[data-remote="origin"]');
    await jsClickMenuItem("Remove remote");
    await browser.waitUntil(
      async () => !(await $('[data-remote="origin"]').isExisting()),
      { timeout: 20_000, timeoutMsg: "origin row did not disappear" },
    );
    expect(pair.repo.git("remote").trim()).toBe("");
  });

  it("renames a remote via the context menu", async () => {
    pair = remoteRepo();
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    await $('[data-remote="origin"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "origin row missing",
    });
    await stubNativeDialogs({ promptQueue: ["upstream"] });
    await jsContextMenu('[data-remote="origin"]');
    await jsClickMenuItem("Rename…");
    await $('[data-remote="upstream"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "renamed remote row never appeared",
    });
    expect(pair.repo.git("remote").trim()).toBe("upstream");
  });

  it("edits a remote URL via the context menu", async () => {
    pair = remoteRepo();
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    await $('[data-remote="origin"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "origin row missing",
    });
    const newUrl = `${pair.barePath}-moved`;
    await stubNativeDialogs({ promptQueue: [newUrl] });
    await jsContextMenu('[data-remote="origin"]');
    await jsClickMenuItem("Edit URL…");
    // repo-truth wait: no dedicated UI signal beyond the row re-rendering
    // with the new URL — wait for that, then assert git config truth.
    await browser.waitUntil(
      async () => (await $('[data-remote="origin"]').getText()).includes(newUrl),
      { timeout: 20_000, timeoutMsg: "row never showed the new URL" },
    );
    expect(pair.repo.git("remote", "get-url", "origin").trim()).toBe(newUrl);
  });

  it("prunes stale remote-tracking refs via the context menu", async () => {
    pair = remoteRepo();
    // Create a remote branch (push updates the local remote-tracking ref),
    // then delete it on the bare side so the local ref is stale.
    pair.repo.git("push", "origin", "main:refs/heads/stale");
    pair.bareGit("branch", "-D", "stale");
    expect(pair.repo.hasRef("refs/remotes/origin/stale")).toBe(true);
    await openRepo(pair.repo.path);
    await switchScreen("remote");
    await $('[data-remote="origin"]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "origin row missing",
    });
    await jsContextMenu('[data-remote="origin"]');
    await jsClickMenuItem("Prune stale refs");
    // repo-truth wait: pruning has no UI signal at all — the stale
    // remote-tracking ref disappearing IS the outcome.
    await browser.waitUntil(
      async () => !pair!.repo.hasRef("refs/remotes/origin/stale"),
      { timeout: 20_000, timeoutMsg: "stale ref survived prune" },
    );
  });

  // The banner is the ONLY thing a rejected push produces, so what it says is
  // the whole feature. This used to assert `toContain("Network")` — pinning the
  // enum's own spelling, which the banner led with, which is the defect #212 is
  // about. The required gate was holding the bug in place. What is worth
  // pinning instead is what a user can act on: git's reason, and the hint
  // paragraph that names the fix, still shaped as lines.
  it("rejected non-fast-forward push shows git's reason and its advice", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    const bareBefore = pair.bareGit("rev-parse", "main").trim();
    await $("button*=Push").click(); // titlebar, force=None
    await $('[data-testid="error-banner"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "error banner never appeared for rejected push",
    });
    // Scoped to the text, so the dismiss button's label is not in the string
    // (`getText()` on the strip returns "…details.dismiss").
    const banner = await $('[data-testid="banner-text"]').getText();

    // 1. git's own reason survives the trip through `map_git_failure` and the
    //    progress reader's tail.
    expect(banner).toContain("non-fast-forward");

    // 2. ...and so does the advice, AS SEPARATE LINES. This is the whole of the
    //    `white-space: pre-wrap` fix (#212): without it git's hint paragraph
    //    arrives as one run-on red line with "use 'git pull' before pushing
    //    again" buried mid-sentence. Nothing else guards it end to end — a
    //    component test can assert the style property, but only a real webview
    //    lays the text out, and `progress::DEFAULT_TAIL_LINES` deciding to keep
    //    fewer lines would break this and nothing else.
    //    `>= 3` rather than the exact 4 this git prints: the wording of the
    //    paragraph is git's, and it has gained and lost a line across releases.
    const hints = banner.split("\n").filter((l) => l.startsWith("hint:"));
    expect(hints.length).toBeGreaterThanOrEqual(3);
    expect(hints.join(" ")).toContain("git pull");

    // 3. and the strip leads with written prose or with nothing — never the
    //    discriminant. `Network` has no entry in `ERROR_BANNER_LABELS`, so the
    //    label element must not exist at all; the string check documents the
    //    exact regression, and is safe here because this fixture's remote is a
    //    local bare repo, so no git output can mention a network.
    expect(await $('[data-testid="banner-label"]').isExisting()).toBe(false);
    expect(banner).not.toContain("Network");

    expect(pair.bareGit("rev-parse", "main").trim()).toBe(bareBefore);
  });
});
