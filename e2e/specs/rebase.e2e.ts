import { browser, $, expect } from "@wdio/globals";
import {
  cherryRepo,
  mergeRangeRepo,
  rebaseConflictRepo,
  TempRepo,
} from "../support/tempRepo";
import {
  openRepo, resetApp, switchScreen, stubNativeDialogs,
  jsContextMenu, jsClickMenuItem, executeOnce, scrollCommitListTo,
} from "../support/app";

describe("interactive rebase", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("squashes HEAD into its parent from the history menu", async () => {
    repo = cherryRepo(); // main: 3 commits, HEAD = "fix: update a.txt"
    await openRepo(repo.path);
    await stubNativeDialogs({ promptText: "squashed by e2e" });
    await switchScreen("history");
    await scrollCommitListTo("fix: update a.txt");
    const headRow = $('[data-testid="commit-row"]*=fix: update a.txt');
    await headRow.waitForDisplayed({ timeout: 15_000, timeoutMsg: "HEAD row missing" });
    await jsContextMenu('[data-testid="commit-row"]', { text: "fix: update a.txt" });
    await jsClickMenuItem("Squash this commit into its parent");
    // The squash runs where it was invoked — no hand-off to the Rebase screen,
    // no Start button. The completion signal is History repainting with the new
    // message: the log only reloads once the rebase has finished, so this
    // cannot match the intermediate state a `rev-list --count` poll could.
    await $('[data-testid="commit-row"]*=squashed by e2e').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "History never showed the squashed commit",
    });
    // Still on History, and no plan was ever built.
    await expect($('[data-testid="rebase-row"]')).not.toBeExisting();
    expect(repo.git("rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(repo.git("log", "-1", "--pretty=%B")).toContain("squashed by e2e");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("aborting a conflicted rebase restores HEAD", async () => {
    repo = rebaseConflictRepo();
    const before = repo.git("rev-parse", "HEAD").trim();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    // "Interactive rebase from here" resolves its base as the target
    // commit's parent — invoking it on the repo's ROOT commit ("feat: base
    // line" has none) silently no-ops (menu handler bails when it can't
    // find a base oid). Target "feat: first edit" instead: its parent is
    // "feat: base line", a valid base, and the resulting 3-row plan covers
    // first edit / middle edit / second edit.
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: first edit" });
    await jsClickMenuItem("Interactive rebase from here");
    await $('[data-testid="rebase-row"]').waitForDisplayed({
      timeout: 15_000, timeoutMsg: "rebase plan never appeared",
    });
    // Drop the MIDDLE commit so the last one conflicts on replay. Dropping
    // the plan's first (oldest) row wouldn't work here: rebase_start resets
    // HEAD to the parent of the first surviving (non-Drop) step, so a
    // leading drop just shifts the reset point and never conflicts — the
    // dropped commit has to sit between two surviving picks.
    const dropRowText = "feat: middle edit";
    // selectByVisibleText doesn't stick on the embedded driver (confirmed
    // empirically: the row's action <select> stayed "pick" afterward), and
    // passing a WebdriverIO element handle into browser.execute isn't
    // supported here either (the tauri driver doesn't resolve it to a live
    // DOM node) — so find the row and its <select> purely in-page by text,
    // same technique as jsContextMenu/jsClickMenuItem, and dispatch the
    // change event ourselves.
    await $(`[data-testid="rebase-row"]*=${dropRowText}`).waitForDisplayed({
      timeout: 10_000, timeoutMsg: "plan row missing",
    });
    // executeOnce: re-dispatching change with the same value is near-benign,
    // but keep every side-effectful script under the no-double-run guard.
    await executeOnce((rowText: string) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="rebase-row"]'));
      const row = rows.find((r) => r.textContent?.includes(rowText));
      const select = row?.querySelector("select") as HTMLSelectElement | null;
      if (!select) throw new Error(`rebase row select not found: ${rowText}`);
      // Exact RebaseAction value — the row used to lowercase its options.
      select.value = "Drop";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, dropRowText);
    await $('[data-testid="rebase-start"]').click();
    await $('[data-testid="rebase-abort"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "conflict banner (with Abort) never appeared",
    });
    await $('[data-testid="rebase-abort"]').click();
    // The UI, not `rev-parse HEAD`. `rebase_abort` re-attaches HEAD to the
    // branch FIRST (`set_head`) and only then throws the replay away with a
    // hard reset, so HEAD reads as `before` while the conflicted worktree is
    // still there — reproduced deliberately (a 20 000-file fixture widens the
    // reset's checkout): at the first sample where HEAD had moved,
    // `git status --porcelain` said `UU conflict.txt`, 2 runs out of 2, and
    // never with the small fixture. The Abort button leaving the DOM can only
    // happen after `rebaseAbort` awaited the backend call, so it is strictly
    // after both halves.
    await $('[data-testid="rebase-abort"]').waitForDisplayed({
      reverse: true,
      timeout: 20_000,
      timeoutMsg: "the rebase banner never went away after Abort",
    });
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(before);
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("flattens a merge commit out of the range", async () => {
    repo = mergeRangeRepo();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("feat: a on main");
    // "Interactive rebase from here" on A puts everything after A in the plan:
    // F, C, and the merge M. (Never invoke it on the ROOT commit — that
    // silently no-ops.)
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: a on main" });
    await jsClickMenuItem("Interactive rebase from here");

    const warning = $('[data-testid="rebase-merge-warning"]');
    await warning.waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "merge warning never appeared for a range containing a merge",
    });
    expect(await warning.getText()).toContain("1 merge commit");

    await $('[data-testid="rebase-start"]').click();
    // rebase-last-summary renders only once the rebase is done and the plan is
    // cleared, so it cannot match mid-replay.
    await $('[data-testid="rebase-last-summary"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "flattening rebase never reported completion",
    });

    // The merge is gone, the side branch's commit and file survived, and the
    // history is linear.
    expect(repo.git("log", "--oneline", "--merges").trim()).toBe("");
    expect(repo.git("log", "--format=%s").trim().split("\n")).toEqual([
      "feat: c on main",
      "feat: f on feature",
      "feat: a on main",
      "feat: root",
    ]);
    expect(repo.read("f.txt")).toBe("f\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });

  it("preserves a merge commit when preserve mode is on", async () => {
    repo = mergeRangeRepo();
    const originalMerge = repo.git("rev-parse", "HEAD").trim();
    await openRepo(repo.path);
    await stubNativeDialogs({ confirm: true });
    await switchScreen("history");
    await scrollCommitListTo("feat: a on main");
    await jsContextMenu('[data-testid="commit-row"]', { text: "feat: a on main" });
    await jsClickMenuItem("Interactive rebase from here");
    await $('[data-testid="rebase-row"]').waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: "rebase plan never appeared",
    });

    await $('[data-testid="rebase-merge-mode-preserve"]').click();
    const warning = $('[data-testid="rebase-merge-warning"]');
    await warning.waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "merge warning never appeared in preserve mode",
    });
    await browser.waitUntil(
      async () => (await warning.getText()).includes("not preserved"),
      {
        timeout: 10_000,
        timeoutMsg: "warning never switched to the preserve-mode copy",
      },
    );

    // Reordering is disabled in preserve mode, and the rows say so — the drag
    // gate and the chevrons are one decision now (#91). Before that the pointer
    // drag was still wired here while the buttons were already gone.
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="rebase-row"]').getAttribute(
          "data-pg-reorderable",
        )) === "false",
      {
        timeout: 10_000,
        timeoutMsg: "rebase rows still advertised reordering in preserve mode",
      },
    );
    await expect($('[data-testid="rebase-move-up"]')).not.toBeExisting();
    await expect($('[data-testid="rebase-move-down"]')).not.toBeExisting();

    await $('[data-testid="rebase-start"]').click();
    await $('[data-testid="rebase-last-summary"]').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "preserving rebase never reported completion",
    });

    // The merge survives as a merge, with its topology intact: first parent the
    // mainline commit, second the side branch.
    expect(repo.git("log", "--merges", "--format=%s").trim()).toBe(
      "Merge branch 'feature'",
    );
    expect(repo.git("log", "-1", "--format=%s", "HEAD^1").trim()).toBe(
      "feat: c on main",
    );
    expect(repo.git("log", "-1", "--format=%s", "HEAD^2").trim()).toBe(
      "feat: f on feature",
    );
    // A rebase really ran: rebase_start records the pre-rebase tip in ORIG_HEAD.
    // Note HEAD's oid is EXPECTED to equal the original merge's — replaying
    // unchanged commits onto the same base reproduces them byte for byte (same
    // trees, messages, authors, and same-second committers), which is what a
    // faithful recreate looks like. Asserting the oid changed would assert the
    // engine corrupts something.
    expect(repo.git("rev-parse", "ORIG_HEAD").trim()).toBe(originalMerge);
    expect(repo.read("f.txt")).toBe("f\n");
    expect(repo.read("c.txt")).toBe("c\n");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
