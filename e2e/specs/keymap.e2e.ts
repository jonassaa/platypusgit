// Keyboard navigation v2 (docs/superpowers/specs/2026-07-02-keyboard-navigation-v2)
// end-to-end: every rider-preset chord, pane focus traversal, list navigation,
// the text-input policy, and the classic-preset switch. Chords are synthesized
// with jsChord (window-level keydown — the embedded driver can't produce
// modifier chords); everything downstream of AppShell's window listener is
// real app code.

import { browser, $, expect } from "@wdio/globals";
import {
  basicRepo, branchyRepo, dirtyRepo, remoteRepo, makeAhead, makeBehind,
  type TempRepo, type RemotePair,
} from "../support/tempRepo";
import {
  openRepo, resetApp, jsChord, jsDoubleShift, jsKey, jsPickOption,
  focusedPaneId, paletteDialog, paletteInput, changeRow, stagedRow,
  scrollCommitListTo, switchScreen,
} from "../support/app";

const CHEAT_SHEET = "h2*=Keyboard shortcuts";
const commitMessage = '[data-testid="commit-message"]';
const historySelectedRow =
  '[data-pg-pane="history.list"] [data-pg-row][data-selected]';

async function waitScreen(marker: string, label: string): Promise<void> {
  await $(marker).waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: `${label} screen marker never appeared: ${marker}`,
  });
}

async function waitFocusedPane(paneId: string, why: string): Promise<void> {
  await browser.waitUntil(async () => (await focusedPaneId()) === paneId, {
    timeout: 10_000,
    timeoutMsg: `pane "${paneId}" never took keymap focus — ${why} (focused: ${await focusedPaneId()})`,
  });
}

/** Wait until the history pane's selected row mentions a commit subject. */
async function waitHistorySelection(subject: string, after: string): Promise<void> {
  await browser.waitUntil(
    async () => (await $(historySelectedRow).getText()).includes(subject),
    {
      timeout: 10_000,
      timeoutMsg: `history selection never reached "${subject}" after ${after}`,
    },
  );
}

describe("keymap — rider preset (default)", () => {
  let repo: TempRepo | null = null;
  let pair: RemotePair | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose(); repo = null;
    pair?.dispose(); pair = null;
  });

  // ⌘5 is deliberately absent: since #108 it is `conflict.openResolver`, which
  // opens the resolver WINDOW rather than switching screens (covered by
  // merge-window.e2e.ts and by the ops unit test), so it has no place in a
  // screen-switching walk.
  it("nav chords switch screens (⌘K, ⌘9, ⌘D, ⌘1/4/6/7, ⌘⇧9, ⌘,)", async () => {
    // dirtyRepo: the Commit screen only mounts its panes when changes exist
    // (clean tree renders the "Working tree clean" empty state instead).
    repo = dirtyRepo();
    await openRepo(repo.path);
    const walk: Array<{ chord: string; marker: string; label: string }> = [
      { chord: "Mod+K", marker: '[data-pg-pane="commit.files"]', label: "Commit (⌘K)" },
      { chord: "Mod+9", marker: '[data-pg-pane="history.list"]', label: "History (⌘9)" },
      { chord: "Mod+4", marker: '[data-pg-pane="branches.list"]', label: "Branches (⌘4)" },
      { chord: "Mod+6", marker: '[data-testid="rebase-start"]', label: "Rebase (⌘6)" },
      { chord: "Mod+7", marker: '[data-pg-pane="remote.list"]', label: "Remotes (⌘7)" },
      // ⌘D reaches the Diff viewer here because the step BEFORE it leaves focus
      // on the Remotes screen. From the History list the pane-scoped
      // diff.viewCombined claims the chord instead (#164), so do not reorder
      // this step to follow ⌘9.
      { chord: "Mod+D", marker: '[data-pg-pane="diff.files"]', label: "Diff (⌘D)" },
      { chord: "Mod+Shift+9", marker: '[data-pg-pane="reflog.list"]', label: "Reflog (⌘⇧9)" },
      { chord: "Mod+,", marker: "div*=Choose a keymap preset", label: "Settings (⌘,)" },
      { chord: "Mod+1", marker: '[data-pg-pane="repo.tree"]', label: "Files (⌘1)" },
    ];
    for (const step of walk) {
      await jsChord(step.chord);
      await waitScreen(step.marker, step.label);
    }
  });

  it("palette opens on ⌘⇧A and on double-Shift", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await jsChord("Mod+Shift+A");
    await $(paletteDialog).waitForDisplayed({
      timeout: 10_000, timeoutMsg: "palette did not open on Mod+Shift+A",
    });
    await jsKey(paletteInput, "Escape");
    await browser.waitUntil(async () => !(await $(paletteDialog).isExisting()), {
      timeout: 10_000, timeoutMsg: "palette did not close on Escape",
    });
    await jsDoubleShift();
    await $(paletteDialog).waitForDisplayed({
      timeout: 10_000, timeoutMsg: "palette did not open on double-Shift",
    });
  });

  it("cheat sheet: ? opens, Escape closes, bare ? is suppressed while typing", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitMessage, "Commit");
    // Bare "?" aimed at a text input must be swallowed by the input policy.
    // The cheat sheet is a TOGGLE: if this dispatch wrongly went through, the
    // window-level "?" below would toggle it back CLOSED and the wait fails —
    // the negative case is observable without a blind sleep.
    await jsChord("?", { target: commitMessage });
    await jsChord("?");
    await $(CHEAT_SHEET).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "cheat sheet not open after input-suppressed ? + window ?",
    });
    await jsChord("Escape");
    await browser.waitUntil(async () => !(await $(CHEAT_SHEET).isExisting()), {
      timeout: 10_000, timeoutMsg: "cheat sheet did not close on Escape",
    });
  });

  it("modifier chords still dispatch while typing in an input", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitMessage, "Commit");
    await jsChord("Mod+9", { target: commitMessage });
    await waitScreen('[data-pg-pane="history.list"]', "History (⌘9 from input)");
  });

  it("double-Shift opens the palette even while typing", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitMessage, "Commit");
    await jsDoubleShift({ target: commitMessage });
    await $(paletteDialog).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "palette did not open on double-Shift from inside an input",
    });
  });

  it("panes: Tab cycles, Alt+Arrows move spatially, activity bar reachable", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-pg-pane="commit.files"]', "Commit");
    // Entering a screen focuses its top-left content pane.
    await waitFocusedPane("commit.files", "screen enter should auto-focus first content pane");

    await jsChord("Tab");
    await browser.waitUntil(
      async () => {
        const id = await focusedPaneId();
        return id !== null && id !== "commit.files";
      },
      { timeout: 10_000, timeoutMsg: "Tab did not cycle focus off commit.files" },
    );
    await jsChord("Shift+Tab");
    await waitFocusedPane("commit.files", "Shift+Tab should cycle back");

    await jsChord("Alt+ArrowRight");
    await waitFocusedPane("commit.diff", "Alt+ArrowRight should reach the diff pane");
    await jsChord("Alt+ArrowLeft");
    await waitFocusedPane("commit.files", "Alt+ArrowLeft should return to the file list");
    await jsChord("Alt+ArrowLeft");
    await waitFocusedPane("activitybar", "Alt+ArrowLeft from the leftmost content pane should reach the activity bar");
  });

  // Alt+Right off the activity bar means "go into this screen", so it lands on
  // the screen's primary pane. Geometry alone answered differently: the bar is
  // full-height, so History's bottom detail panel is often its nearest pane to
  // the right.
  it("panes: Alt+ArrowRight off the activity bar enters the screen's main pane", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "opening a repo should focus the commit list");

    // Exactly one pane may carry the ring — several at once reads as "the whole
    // UI is highlighted" and tells the user nothing about where the keyboard is.
    const ringed = await browser.execute(
      () => document.querySelectorAll("[data-pg-focused]").length,
    );
    expect(ringed).toBe(1);

    await jsChord("Alt+ArrowLeft");
    await waitFocusedPane("activitybar", "Alt+ArrowLeft should reach the activity bar");
    await jsChord("Alt+ArrowRight");
    await waitFocusedPane(
      "history.list",
      "Alt+ArrowRight off the bar should enter the commit list, not the detail panel",
    );
  });

  it("Alt+Arrow does not hijack caret movement while typing", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-pg-pane="commit.message"]', "Commit");
    // Focus the commit body textarea (also focuses the commit.message pane).
    await $('[data-pg-pane="commit.message"] textarea').click();
    await waitFocusedPane("commit.message", "clicking the textarea should focus its pane");
    // Alt+Left aimed at the textarea = macOS word-jump; the keymap must NOT
    // move pane focus. Observable without a sleep: the window-level Alt+Left
    // after it should land exactly ONE hop left (commit.diff) — a leak would
    // make it two hops (commit.files).
    await jsChord("Alt+ArrowLeft", {
      target: '[data-pg-pane="commit.message"] textarea',
    });
    await jsChord("Alt+ArrowLeft");
    await waitFocusedPane(
      "commit.diff",
      "exactly one Alt+Left hop expected — input-targeted Alt+Left must not move pane focus",
    );
  });

  it("history list: arrows + Home/End move the selection, Enter opens the commit diff", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await jsChord("Mod+9");
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "history list should hold focus for arrow keys");

    await jsChord("Home");
    await waitHistorySelection("fix: update a.txt", "Home");
    await jsChord("ArrowDown");
    await waitHistorySelection("feat: add b.txt", "ArrowDown");
    await jsChord("End");
    await waitHistorySelection("feat: add a.txt", "End");
    await jsChord("ArrowUp");
    await waitHistorySelection("feat: add b.txt", "ArrowUp");

    await jsChord("Enter");
    await waitScreen('[data-pg-pane="commitDiff.files"]', "Commit diff (Enter on history row)");
  });

  it("commit panel: Space stages the selected file", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-pg-pane="commit.files"]', "Commit");
    // Click selects the row AND focuses the pane (PGPane onMouseDown), so the
    // pane-scoped Space handler is live.
    await changeRow("a.txt").click();
    await jsChord(" ");
    await stagedRow("a.txt").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "a.txt never moved to the staged list after Space",
    });
    expect(repo.git("status", "--porcelain")).toContain("M  a.txt");
  });

  it("branches: Enter checks out the selected branch", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+4");
    await waitScreen('[data-pg-pane="branches.list"]', "Branches");
    // Select the feature row by name. Unique: rows render name + short sha +
    // upstream/status only (no commit subjects), and hex shas can't contain
    // "feature". Chained $(): wdio's attr+text shorthand can't carry a
    // descendant combinator.
    await $('[data-pg-pane="branches.list"]')
      .$("[data-pg-row]*=feature")
      .click();
    await jsChord("Enter");
    // Repo truth is the acceptance; the chip is the UI wait signal.
    await $('[data-testid="branch-chip"]*=feature').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "branch chip never switched to feature after Enter",
    });
    expect(repo.git("symbolic-ref", "--short", "HEAD").trim()).toBe("feature");
  });

  it("repo ops: ⌘⇧T fetches all remotes", async () => {
    pair = remoteRepo();
    makeBehind(pair);
    await openRepo(pair.repo.path);
    await jsChord("Mod+Shift+T");
    await $("span*=↓1").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "behind badge never appeared after Mod+Shift+T fetch",
    });
  });

  it("repo ops: ⌘T pulls the remote commit", async () => {
    pair = remoteRepo();
    makeBehind(pair);
    const remoteTip = pair.bareGit("rev-parse", "main").trim();
    await openRepo(pair.repo.path);
    await jsChord("Mod+9");
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await jsChord("Mod+T");
    // The History list is windowed, so the pulled commit may be off-screen
    // rather than absent (#68 G10).
    await scrollCommitListTo("feat: remote-only commit", 20_000);
    expect(pair.repo.git("rev-parse", "HEAD").trim()).toBe(remoteTip);
  });

  it("repo ops: ⌘⇧K pushes the local commit", async () => {
    pair = remoteRepo();
    makeAhead(pair);
    await openRepo(pair.repo.path);
    await $("span*=↑1").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "ahead badge missing before push",
    });
    await jsChord("Mod+Shift+K");
    await browser.waitUntil(async () => !(await $("span*=↑1").isExisting()), {
      timeout: 20_000, timeoutMsg: "ahead badge never cleared after Mod+Shift+K push",
    });
    expect(pair.bareGit("rev-parse", "main").trim()).toBe(
      pair.repo.git("rev-parse", "HEAD").trim(),
    );
  });

  it("repo ops: ⌘⌥Y refreshes status from disk", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen("div*=Working tree clean", "Commit (clean)");
    repo.write("fresh.txt", "fresh\n");
    await jsChord("Mod+Alt+Y");
    await changeRow("fresh.txt").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "fresh.txt never appeared after Mod+Alt+Y refresh",
    });
  });

  it("speed-search: typing in the branches list jumps to the match, Enter checks out", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+4");
    await waitScreen('[data-pg-pane="branches.list"]', "Branches");
    await waitFocusedPane("branches.list", "branches list should hold focus for typing");
    for (const ch of ["F", "E", "A"]) await jsChord(ch); // query "fea" → only "feature"
    await browser.waitUntil(
      async () =>
        (
          await $('[data-pg-pane="branches.list"] [data-pg-row][data-selected]').getText()
        ).includes("feature"),
      { timeout: 10_000, timeoutMsg: "speed-search never selected the feature row" },
    );
    await $("[data-pg-speed-query]*=fea").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "speed-search query chip never appeared",
    });
    await jsChord("Enter");
    await $('[data-testid="branch-chip"]*=feature').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "speed-search + Enter never checked out feature",
    });
    expect(repo.git("symbolic-ref", "--short", "HEAD").trim()).toBe("feature");
  });

  it("speed-search: history jump + Escape clears the query", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await jsChord("Mod+9");
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "history list should hold focus for typing");
    for (const ch of ["A", "D", "D"]) await jsChord(ch); // "add" → newest match
    await waitHistorySelection("feat: add b.txt", "speed-search 'add'");
    await jsChord("Escape");
    await browser.waitUntil(
      async () => !(await $("[data-pg-speed-query]").isExisting()),
      { timeout: 10_000, timeoutMsg: "Escape did not clear the speed-search chip" },
    );
  });

  it("stage all (⌘⇧S) and unstage all (⌘⇧U)", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-pg-pane="commit.files"]', "Commit");
    await jsChord("Mod+Shift+S");
    await stagedRow("a.txt").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "a.txt not staged after Mod+Shift+S",
    });
    const staged = repo.git("status", "--porcelain");
    expect(staged).toContain("M  a.txt");
    expect(staged).toContain("A  new.txt");
    await jsChord("Mod+Shift+U");
    await changeRow("staged.txt").waitForDisplayed({
      timeout: 20_000, timeoutMsg: "staged.txt not back in changes after Mod+Shift+U",
    });
    // Everything back on the worktree side: no index-only entries remain.
    expect(repo.git("status", "--porcelain")).not.toMatch(/^[MA] {2}/m);
  });

  it("⌘↵ commits the typed message", async () => {
    repo = dirtyRepo(); // staged.txt is already staged
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitMessage, "Commit");
    await $(commitMessage).setValue("feat: committed via chord");
    await jsChord("Mod+Enter");
    // UI signal: the committed file leaves the staged list.
    await browser.waitUntil(
      async () => !(await stagedRow("staged.txt").isExisting()),
      { timeout: 20_000, timeoutMsg: "staged.txt still staged after Mod+Enter" },
    );
    expect(repo.git("log", "-1", "--format=%s").trim()).toBe(
      "feat: committed via chord",
    );
  });

  it("⌘⇧↵ commits and pushes", async () => {
    pair = remoteRepo();
    pair.repo.write("chord.txt", "chord\n");
    pair.repo.git("add", "chord.txt");
    await openRepo(pair.repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitMessage, "Commit");
    await $(commitMessage).setValue("feat: commit and push chord");
    await jsChord("Mod+Shift+Enter");
    // No single UI element spans commit→push completion — the bare remote's
    // log is the only end-to-end signal, so wait on repo truth.
    await browser.waitUntil(
      async () =>
        pair!.bareGit("log", "-1", "--format=%s").trim() ===
        "feat: commit and push chord",
      { timeout: 20_000, timeoutMsg: "commit never arrived on the remote after Mod+Shift+Enter" },
    );
    expect(pair.bareGit("rev-parse", "main").trim()).toBe(
      pair.repo.git("rev-parse", "HEAD").trim(),
    );
  });

  it("⌘⇧M toggles amend, swapping the draft for HEAD's message", async () => {
    repo = dirtyRepo(); // HEAD is "fix: update a.txt"
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-testid="commit-button"]', "Commit");
    await $(commitMessage).setValue("wip: draft");
    await jsChord("Mod+Shift+M");
    await $('[data-testid="commit-button"]*=Amend').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "commit button never relabeled to Amend",
    });
    await browser.waitUntil(
      async () => (await $(commitMessage).getValue()) === "fix: update a.txt",
      { timeout: 10_000, timeoutMsg: "amend never prefilled HEAD's message" },
    );
    await jsChord("Mod+Shift+M");
    await $('[data-testid="commit-button"]*=Commit').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "commit button never relabeled back to Commit",
    });
    // The draft amend displaced comes back rather than being lost.
    await browser.waitUntil(
      async () => (await $(commitMessage).getValue()) === "wip: draft",
      { timeout: 10_000, timeoutMsg: "draft never came back after unchecking amend" },
    );
  });

  it("⌘N opens the create-branch step and creates the branch", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await jsChord("Mod+N");
    await $(paletteDialog).$("div*=Create branch").waitForDisplayed({
      timeout: 10_000, timeoutMsg: "create-branch input step did not open on Mod+N",
    });
    await $(paletteInput).setValue("kbd-branch");
    await jsKey(paletteInput, "Enter");
    await $('[data-testid="branch-chip"]*=kbd-branch').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "branch chip never switched to kbd-branch",
    });
    expect(repo.hasRef("refs/heads/kbd-branch")).toBe(true);
  });

  // Literal-Ctrl chord — only resolvable on macOS (Ctrl collapses into Mod on
  // other platforms, so Ctrl+V arrives as the unbound Mod+V there).
  (process.platform === "darwin" ? it : it.skip)(
    "⌃V opens the palette (Rider VCS-popup nod)",
    async () => {
      repo = basicRepo();
      await openRepo(repo.path);
      await jsChord("Ctrl+V");
      await $(paletteDialog).waitForDisplayed({
        timeout: 10_000, timeoutMsg: "palette did not open on Ctrl+V",
      });
    },
  );

  it("F7 / ⇧F7 walk the diff hunks", async () => {
    // Two far-apart edits in a 60-line file → exactly two hunks.
    repo = basicRepo();
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    repo.commitFile("big.txt", lines.join("\n") + "\n", "feat: big file");
    lines[1] = "line 2 CHANGED";
    lines[57] = "line 58 CHANGED";
    repo.write("big.txt", lines.join("\n") + "\n");
    await openRepo(repo.path);
    // The activity bar, NOT ⌘D: since #164 that chord opens the selected
    // commit's own diff from History, and this test is about F7, so how it
    // reaches the Diff screen is incidental. Both routes call AppShell's
    // enterScreen, so focus still lands on the primary pane (diff.files), which
    // is one of useHunkNav's paneIds — F7 is pane-scoped.
    await switchScreen("diff");
    await waitScreen('[data-pg-pane="diff.files"]', "Diff");
    // Only hunk 0 is asserted up front. The diff is windowed and whole-file by
    // default, so hunk 1 — ~50 lines further down — is not mounted until F7
    // scrolls it into view; requiring it here would fail for a reason that has
    // nothing to do with the keymap. The F7 sequence below proves both hunks
    // exist, and now also that F7's scroll-into-view works.
    //
    // Hunk 0 arrives ALREADY ACTIVE since issue 188: the screen opens at its
    // first change, so the cursor starts there rather than at -1 and the first
    // F7 moves to the SECOND change (Rider's behaviour). That the diff opens
    // there at all is diff-nav.e2e.ts's subject; this test's subject is that
    // F7/⇧F7 still walk from wherever the cursor is.
    await $('[data-hunk-index="0"][data-hunk-active]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "first hunk never rendered — fixture geometry off?",
    });
    await jsChord("F7");
    await $('[data-hunk-index="1"][data-hunk-active]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "F7 did not advance to hunk 1",
    });
    await jsChord("Shift+F7");
    await $('[data-hunk-index="0"][data-hunk-active]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "Shift+F7 did not walk back to hunk 0",
    });
  });

  it("preset switch: classic bindings replace rider", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+,");
    await waitScreen("div*=Choose a keymap preset", "Settings");
    await jsPickOption('[data-testid="keymap-preset-select"]', "platypusgit");
    const persisted = await browser.execute(() =>
      localStorage.getItem("pg-keymap-preset"),
    );
    expect(persisted).toBe("platypusgit");
    // Classic-only chords: ⌘3 history and ⌘2 commit exist only in the classic
    // number scheme (rider binds ⌘9/⌘K instead) — navigation proves the
    // classic table is live.
    await jsChord("Mod+3");
    await waitScreen('[data-pg-pane="history.list"]', "History (classic ⌘3)");
    await jsChord("Mod+2");
    await waitScreen('[data-pg-pane="commit.files"]', "Commit (classic ⌘2)");
  });
});

// ⌘D over the History commit list (#158). Appended as its own block so it merges
// cleanly alongside concurrent work in this file.
//
// The chord carries TWO actions: the pane-scoped `diff.viewCombined` (this
// list's selection diff) and the global `nav.diff` (go to the Diff viewer). The
// dispatcher tries them in order and stops at the first that does not decline,
// so both halves need proving in the real app: the claim, and — more
// importantly — the fall-through, which is now what the LAST case proves, from
// another pane. #164 lowered the claim from 2+ commits to any non-empty
// selection, so the list itself no longer declines on a live repository; one
// commit routes to its own diff, exactly as Enter does.
describe("keymap — ⌘D over the History commit list (#158)", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose(); repo = null;
  });

  it("⌘D on a multi-selection opens the combined diff of the range", async () => {
    repo = basicRepo();
    // Rows are newest-first: "fix: update a.txt" (HEAD), "feat: add b.txt",
    // "feat: add a.txt" (root). Selecting the first two makes the range
    // parent-of-oldest → newest = root → HEAD.
    const from = repo.git("rev-parse", "--short=7", "HEAD~2").trim();
    const to = repo.git("rev-parse", "--short=7", "HEAD").trim();
    await openRepo(repo.path);
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "opening a repo should focus the commit list");

    // Keyboard-only, so nothing about this depends on a click also moving focus.
    await jsChord("Home");
    await waitHistorySelection("fix: update a.txt", "Home");
    await jsChord("Shift+ArrowDown");
    // NOT waitHistorySelection: two rows now carry [data-selected], and that
    // helper reads the FIRST one — which is still the row Home landed on. The
    // multi-selection detail pane is the signal that the range exists.
    await waitScreen("div*=2 commits selected", "multi-selection detail");

    await jsChord("Mod+D");
    await $(`div*=Diff ${from} → ${to}`).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: `⌘D never routed the selection's combined diff (${from} → ${to})`,
    });
    // b.txt is added inside that range, so it can only appear if the range —
    // not one commit — was diffed.
    await $(
      '[data-pg-pane="commitDiff.files"] [data-pg-row][data-path="b.txt"]',
    ).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the combined diff never listed b.txt",
    });
  });

  // The single-commit case, claimed since #164: ⌘D on one selected commit opens
  // THAT commit's own diff (parent..commit) — the same commit-self view Enter and
  // the commit menu's "View diff" give, not the Diff viewer and not
  // commit-vs-HEAD.
  it("⌘D with a single commit selected opens that commit's own diff", async () => {
    repo = basicRepo();
    // basicRepo, newest-first: "fix: update a.txt" (HEAD), "feat: add b.txt",
    // "feat: add a.txt" (root). The MIDDLE commit is the one to select: it added
    // b.txt and nothing since touched that file, so b.txt on screen can only come
    // from parent..commit — commit-vs-HEAD would show a.txt and no b.txt at all,
    // and the Diff viewer would show the (clean) working tree.
    const sha = repo.git("rev-parse", "--short=7", "HEAD~1").trim();
    await openRepo(repo.path);
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "opening a repo should focus the commit list");

    // Keyboard-only, like the case above, so nothing here depends on a click.
    await jsChord("Home");
    await waitHistorySelection("fix: update a.txt", "Home");
    await jsChord("ArrowDown"); // exactly one row selected: the middle commit
    await waitHistorySelection("feat: add b.txt", "ArrowDown");

    await jsChord("Mod+D");
    // The destination's own header first — it names the commit that was routed,
    // so a mis-route fails here rather than as a mute timeout on a file row.
    await $(`div*=Diff ${sha} (this commit)`).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: `⌘D never routed the single commit's own diff (${sha})`,
    });
    // Pane-scoped CSS, not `*=`-text: a bare match on b.txt would also hit
    // History's own commit row for "feat: add b.txt", which is being unmounted.
    await $(
      '[data-pg-pane="commitDiff.files"] [data-pg-row][data-path="b.txt"]',
    ).waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: "the commit's own diff never listed b.txt",
    });
  });

  // ...and the pane scope itself: the selection is still two commits here, so
  // only the dispatcher's pane filter can be what keeps the chord global.
  it("⌘D from outside the list reaches the Diff viewer even with a multi-selection", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await waitScreen('[data-pg-pane="history.list"]', "History");
    await waitFocusedPane("history.list", "opening a repo should focus the commit list");
    await jsChord("Home");
    await jsChord("Shift+ArrowDown");
    // Same reason as above: with two rows selected the selected-row helper
    // reads the first of them, so the detail pane is the honest signal.
    await waitScreen("div*=2 commits selected", "multi-selection detail");

    // Off the list without changing the selection: the activity bar is the
    // nearest focusable thing to its left.
    await jsChord("Alt+ArrowLeft");
    await waitFocusedPane("activitybar", "Alt+ArrowLeft should reach the activity bar");

    await jsChord("Mod+D");
    await waitScreen('[data-pg-pane="diff.files"]', "Diff (⌘D, off the commit list)");
  });
});
