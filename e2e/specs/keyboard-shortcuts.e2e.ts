// Keyboard-shortcut coverage that completes the keymap suite (#25).
//
// keymap.e2e.ts (PR #11) already drives every rider-preset nav/repo/commit
// chord, the palette + cheat-sheet overlays, the input-text policy, list
// arrows/Home/End/Enter/Space, speed-search, F7/⇧F7 hunk nav, and the
// classic-preset switch. This spec adds the bindings that suite leaves
// uncovered — both real and preset-bound (verified against actions.ts /
// presets.ts), no dead/unbound chords (issue #47):
//
//   • list.extendUp / list.extendDown (Shift+↑ / Shift+↓) — multi-commit
//     range selection in History, wired ONLY there. Exercises the #25
//     "select multiple commits → combined diff / squash / cherry-pick"
//     feature end-to-end from the keyboard (no other e2e touches it).
//   • pane.focusUp / pane.focusDown (Alt+↑ / Alt+↓) — the vertical axis of
//     spatial pane traversal. keymap.e2e.ts only covers the horizontal
//     (Alt+←/→) axis and Tab cycling.
//
// Chords go through jsChord (window-level keydown — the embedded driver can't
// synthesize modifier chords); everything downstream of AppShell's listener is
// real app code.

import { browser, $, expect } from "@wdio/globals";
import { basicRepo, type TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, jsChord, focusedPaneId } from "../support/app";

const historyList = '[data-pg-pane="history.list"]';
// PGCommitRow marks each selected row with data-selected — the selection axis
// the Shift+Arrow range extension drives.
const selectedRows = `${historyList} [data-pg-row][data-selected]`;

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

async function waitFocusedPanePrefix(prefix: string, why: string): Promise<void> {
  await browser.waitUntil(
    async () => (await focusedPaneId())?.startsWith(prefix) ?? false,
    {
      timeout: 10_000,
      timeoutMsg: `no pane under "${prefix}.*" took keymap focus — ${why} (focused: ${await focusedPaneId()})`,
    },
  );
}

/** Read-only count of currently-selected commit rows. */
function selectedCommitCount(): Promise<number> {
  return browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    selectedRows,
  );
}

async function waitSelectedCount(n: number, after: string): Promise<void> {
  await browser.waitUntil(async () => (await selectedCommitCount()) === n, {
    timeout: 10_000,
    timeoutMsg: `expected ${n} selected commit(s) after ${after} (got ${await selectedCommitCount()})`,
  });
}

/** Enter History, wait for the list to auto-focus, and pin the lead + anchor
 *  to the newest commit so Shift+Arrow ranges are deterministic. */
async function enterHistoryAtTop(): Promise<void> {
  await jsChord("Mod+9");
  await waitScreen(historyList, "History");
  await waitFocusedPane("history.list", "History must auto-focus its list for arrow keys");
  await jsChord("Home"); // list.top → single selection at the newest commit
  await waitSelectedCount(1, "Home");
}

describe("keyboard shortcuts — multi-select range + vertical pane focus", () => {
  let repo: TempRepo | null = null;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = null;
  });

  it("Shift+↓ extends a multi-commit selection and reveals the combined-diff actions", async () => {
    repo = basicRepo(); // 3 commits: fix update a.txt / feat add b.txt / feat add a.txt
    await openRepo(repo.path);
    await enterHistoryAtTop();

    await jsChord("Shift+ArrowDown"); // list.extendDown — range now spans two rows
    await waitSelectedCount(2, "Shift+ArrowDown");

    // The detail pane swaps to the multi-commit view — the #25 combined-diff /
    // squash / cherry-pick action set.
    await $("div*=2 commits selected").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "multi-commit detail (\"2 commits selected\") never rendered",
    });
    await $("button*=View combined diff").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "combined-diff button missing from the multi-commit detail",
    });
    await $('[data-testid="multi-cherry-pick"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "cherry-pick-set button missing from the multi-commit detail",
    });
    await $('[data-testid="multi-squash"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "squash-set button missing from the multi-commit detail",
    });
  });

  it("Enter on a multi-commit selection opens the combined diff", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await enterHistoryAtTop();

    await jsChord("Shift+ArrowDown"); // select the two newest commits
    await waitSelectedCount(2, "Shift+ArrowDown");

    await jsChord("Enter"); // list.activate → combined diff (commit-vs-commit)
    await waitScreen(
      '[data-pg-pane="commitDiff.files"]',
      "Combined diff (Enter on a multi-selection)",
    );
    // Combined range = parent(feat: add b.txt) → fix: update a.txt, so both the
    // added b.txt and the modified a.txt appear in the changed-files list.
    await $('[data-pg-pane="commitDiff.files"] [data-path="a.txt"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "combined diff missing a.txt (modified across the selection)",
    });
    await $('[data-pg-pane="commitDiff.files"] [data-path="b.txt"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "combined diff missing b.txt (added within the selection)",
    });
  });

  it("Shift+↑ contracts the selection back to a single commit", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await enterHistoryAtTop();

    await jsChord("Shift+ArrowDown"); // grow to two
    await waitSelectedCount(2, "Shift+ArrowDown");
    await $("div*=2 commits selected").waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "multi-commit detail never appeared before contracting",
    });

    await jsChord("Shift+ArrowUp"); // list.extendUp — range collapses to the anchor
    await waitSelectedCount(1, "Shift+ArrowUp");
    // Single selection restores the inline single-commit diff panel (its file
    // pane only mounts when exactly one commit is selected) — positive proof
    // the multi-commit detail is gone.
    await $('[data-pg-pane="history.diff.files"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "single-commit inline diff panel never returned after contracting",
    });
    await expect($("div*=commits selected")).not.toBeExisting();
  });

  it("Alt+↓ and Alt+↑ move pane focus along the vertical axis", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    await enterHistoryAtTop();

    // Default below-layout: the single-commit inline diff panel sits BELOW the
    // list, so its panes are the only ones beneath history.list. Wait for the
    // diff pane to register before traversing.
    await $('[data-pg-pane="history.diff.view"]').waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: "inline diff panel never rendered below the commit list",
    });

    await jsChord("Alt+ArrowDown"); // pane.focusDown → into the diff panel below
    await waitFocusedPanePrefix(
      "history.diff",
      "Alt+Down should drop from the list into the diff panel beneath it",
    );
    // Normalize onto the rightmost diff pane so Alt+Up is unambiguous regardless
    // of which sub-pane Alt+Down landed on (the activity bar far to the left is
    // cross-axis-penalized out of the vertical picks either way).
    await jsChord("Alt+ArrowRight");
    await waitFocusedPane(
      "history.diff.view",
      "Alt+Right should sit on the rightmost diff pane",
    );

    await jsChord("Alt+ArrowUp"); // pane.focusUp → back up to the commit list
    await waitFocusedPane(
      "history.list",
      "Alt+Up should return from the diff panel to the commit list above",
    );
  });
});
