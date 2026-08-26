import { browser, $, expect } from "@wdio/globals";
import {
  remoteRepo, makeAhead, makeBehind, makeDiverged, stalledGitRemote,
  type RemotePair, type StalledRemote,
} from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsClickMenuItem,
} from "../support/app";

describe("remote operations", () => {
  let pair: RemotePair | null = null;
  let stalled: StalledRemote | undefined;

  afterEach(async () => {
    await resetApp();
    pair?.dispose();
    pair = null;
    // A listener left open keeps a git child alive past its own test.
    stalled?.dispose();
    stalled = undefined;
  });

  it("Stop cancels a stalled fetch, with no error banner", async () => {
    // The titlebar's Stop button (#234), through the real IPC path: mint an id,
    // fetch, kill the child's process group, and report `Cancelled` — which no
    // surface may render as a failure.
    pair = remoteRepo();
    stalled = await stalledGitRemote();
    // Point origin at something that connects and then never answers, so the
    // fetch cannot finish on its own.
    pair.repo.git("remote", "set-url", "origin", stalled.url);
    await openRepo(pair.repo.path);

    await $("button*=Fetch").click(); // titlebar (default screen — unambiguous)

    const stop = $('[data-testid="net-cancel"]');
    await stop.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Stop never appeared while the fetch was in flight",
    });
    await stop.click();

    // It disappears when the op clears, which is the UI's own signal that the
    // fetch is over — and it can only clear once the backend call returned.
    await stop.waitForExist({
      reverse: true,
      timeout: 30_000,
      timeoutMsg: "the fetch never stopped after Stop was clicked",
    });
    // A cancel is not a failure: the user pressed the button, and a banner
    // saying so looks exactly like the failures that do need attention.
    expect(await $('div[role="alert"]').isExisting()).toBe(false);
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

  it("rejected non-fast-forward push surfaces the error banner", async () => {
    pair = remoteRepo();
    makeDiverged(pair);
    await openRepo(pair.repo.path);
    const bareBefore = pair.bareGit("rev-parse", "main").trim();
    await $("button*=Push").click(); // titlebar, force=None
    await $('[role="alert"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "error banner never appeared for rejected push",
    });
    expect(await $('[role="alert"]').getText()).toContain("Network");
    expect(pair.bareGit("rev-parse", "main").trim()).toBe(bareBefore);
  });
});
