// Mod+D over the History commit list (#158, #164). The chord carries TWO
// actions: the pane-scoped `diff.viewCombined` (this list's selection diff) and
// the global `nav.diff` (go to the Diff viewer). The dispatcher tries them in
// order and stops at the first that does not decline, so the DECLINE is the
// load-bearing half: a handler that claimed the chord unconditionally would
// strand the Diff viewer everywhere a History list happens to hold focus — which,
// History being the launch screen, is most of the time.
//
// #164 lowered the claim from 2+ commits to ANY non-empty selection, so the only
// remaining decline is an empty log. That makes the cases below: route one commit
// to its own diff and 2+ to the combined range diff, decline with nothing
// selected, and never answer from another pane whatever is selected.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

const mkCommit = (oid: string, summary: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

/** Newest-first linear log: a → b → c → d(root). */
const COMMITS = [
  mkCommit(A, "commit A", [B]),
  mkCommit(B, "commit B", [C]),
  mkCommit(C, "commit C", [D]),
  mkCommit(D, "commit D", []),
];

/** ⌘D / Ctrl+D. The base key comes from `code`, not `key` (see chord.ts). */
function pressModD(): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch({
      key: "d",
      code: "KeyD",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      target: document.body,
    } as unknown as KeyboardEvent);
  });
  return handled;
}

const rowFor = (text: string) => {
  const row = screen
    .getAllByText(text)
    .map((el) => el.closest("[data-pg-row]"))
    .find((el): el is Element => el != null);
  expect(row).toBeTruthy();
  return row! as HTMLElement;
};

function setupStore(commits: CommitInfo[]): void {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
}

describe("History Mod+D", () => {
  beforeEach(() => setupStore(COMMITS));
  afterEach(() => vi.restoreAllMocks());

  it("opens the combined diff of a multi-selection (parent-of-oldest → newest)", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true }); // A + B
    useFocusStore.setState({ focused: "history.list" });

    expect(pressModD()).toBe(true);
    // Oldest selected = B (parent C), newest = A — the same intent Enter and
    // "View combined diff" produce.
    expect(useNavStore.getState().intent).toEqual({
      kind: "commit-vs-commit",
      from: C,
      to: A,
    });
  });

  // #164: one commit is claimed too, and it routes to the SAME commit-self intent
  // Enter and the single commit's "View diff" produce — NOT commit-vs-HEAD, and
  // not the Diff viewer. This is the case the shipped floor of two declined.
  it("opens a single selected commit's own diff (commit-self, as Enter does)", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    useFocusStore.setState({ focused: "history.list" });

    expect(pressModD()).toBe(true);
    expect(useNavStore.getState().intent).toEqual({ kind: "commit-self", oid: A });
  });

  // The accepted cost of #164, pinned rather than left implicit: History seeds a
  // selection on the newest row, so the chord is claimed on the launch screen with
  // nothing clicked. Mod+D reaching the Diff viewer from History is what was
  // traded away — every other pane still has it (see the cases below).
  it("claims the seeded selection too, with no row ever clicked", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });

    expect(pressModD()).toBe(true);
    expect(useNavStore.getState().intent).toEqual({ kind: "commit-self", oid: A });
  });

  // THE regression this file exists for, and after #164 the only decline left.
  // An empty selection happens on an empty log ONLY — the pruning effect re-seeds
  // order[0] whenever the log has rows — so this is the whole of what keeps the
  // chord from being swallowed inside the History list.
  it("declines with nothing selected (empty log) — nav.diff still fires", () => {
    setupStore([]);
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });

    expect(pressModD()).toBe(true); // handled — by the GLOBAL fallback
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "diff",
    });
  });

  // Pane scope, not selection state: the selection is still two commits here, so
  // only the dispatcher's pane filter can be what keeps the chord global.
  it("never answers from another pane, even with a multi-selection live", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true }); // A + B
    useFocusStore.setState({ focused: "history.detail" });

    expect(pressModD()).toBe(true);
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "diff",
    });
  });

  it("and not with no pane focused at all", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true });
    useFocusStore.setState({ focused: null });

    expect(pressModD()).toBe(true);
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "diff",
    });
  });
});
