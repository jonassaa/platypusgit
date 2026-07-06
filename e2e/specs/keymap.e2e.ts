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
  openRepo, resetApp, jsChord, jsDoubleShift, jsKey, jsSelectValue,
  focusedPaneId, paletteDialog, paletteInput, changeRow, stagedRow,
} from "../support/app";

const CHEAT_SHEET = "h2*=Keyboard shortcuts";
const commitSubject = '[data-testid="commit-subject"]';
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

  it("nav chords switch screens (⌘K, ⌘9, ⌘D, ⌘1/4-7, ⌘⇧9, ⌘,)", async () => {
    // dirtyRepo: the Commit screen only mounts its panes when changes exist
    // (clean tree renders the "Working tree clean" empty state instead).
    repo = dirtyRepo();
    await openRepo(repo.path);
    const walk: Array<{ chord: string; marker: string; label: string }> = [
      { chord: "Mod+K", marker: '[data-pg-pane="commit.files"]', label: "Commit (⌘K)" },
      { chord: "Mod+9", marker: '[data-pg-pane="history.list"]', label: "History (⌘9)" },
      { chord: "Mod+4", marker: '[data-pg-pane="branches.list"]', label: "Branches (⌘4)" },
      { chord: "Mod+5", marker: "div*=No conflicts", label: "Conflicts (⌘5)" },
      { chord: "Mod+6", marker: '[data-testid="rebase-start"]', label: "Rebase (⌘6)" },
      { chord: "Mod+7", marker: '[data-pg-pane="remote.list"]', label: "Remotes (⌘7)" },
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
    await waitScreen(commitSubject, "Commit");
    // Bare "?" aimed at a text input must be swallowed by the input policy.
    // The cheat sheet is a TOGGLE: if this dispatch wrongly went through, the
    // window-level "?" below would toggle it back CLOSED and the wait fails —
    // the negative case is observable without a blind sleep.
    await jsChord("?", { target: commitSubject });
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
    await waitScreen(commitSubject, "Commit");
    await jsChord("Mod+9", { target: commitSubject });
    await waitScreen('[data-pg-pane="history.list"]', "History (⌘9 from input)");
  });

  it("double-Shift opens the palette even while typing", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen(commitSubject, "Commit");
    await jsDoubleShift({ target: commitSubject });
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
    await $('[data-testid="commit-row"]*=feat: remote-only commit').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "pulled commit never showed up in history after Mod+T",
    });
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
    await waitScreen(commitSubject, "Commit");
    await $(commitSubject).setValue("feat: committed via chord");
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
    await waitScreen(commitSubject, "Commit");
    await $(commitSubject).setValue("feat: commit and push chord");
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

  it("⌘⇧M toggles amend", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await jsChord("Mod+K");
    await waitScreen('[data-testid="commit-button"]', "Commit");
    await jsChord("Mod+Shift+M");
    await $('[data-testid="commit-button"]*=Amend').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "commit button never relabeled to Amend",
    });
    await jsChord("Mod+Shift+M");
    await $('[data-testid="commit-button"]*=Commit').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "commit button never relabeled back to Commit",
    });
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
    await jsChord("Mod+D");
    await waitScreen('[data-pg-pane="diff.files"]', "Diff");
    await $('[data-hunk-index="1"]').waitForDisplayed({
      timeout: 20_000, timeoutMsg: "second hunk never rendered — fixture geometry off?",
    });
    await jsChord("F7");
    await $('[data-hunk-index="0"][data-hunk-active]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "first F7 did not activate hunk 0",
    });
    await jsChord("F7");
    await $('[data-hunk-index="1"][data-hunk-active]').waitForDisplayed({
      timeout: 10_000, timeoutMsg: "second F7 did not advance to hunk 1",
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
    await jsSelectValue('[data-testid="keymap-preset-select"]', "platypusgit");
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
