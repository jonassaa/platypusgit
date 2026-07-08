// Keyboard-navigation behavior of the History screen: arrows drive the commit
// selection through the keymap dispatcher, Enter opens the commit's diff.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo } from "@/lib/types";

const mkCommit = (oid: string, summary: string): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: [],
  refs: [],
});

const key = (k: string) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

/** Dispatch through the keymap store, flushing the resulting React updates. */
function press(k: string): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k));
  });
  return handled;
}

/** The summary text also renders in the detail pane — resolve to the list row. */
const rowFor = (text: string) => {
  const row = screen
    .getAllByText(text)
    .map((el) => el.closest("[data-pg-row]"))
    .find((el): el is Element => el != null);
  expect(row).toBeTruthy();
  return row!;
};

describe("History keyboard navigation", () => {
  beforeEach(() => {
    // The inline diff panel fetches the selected commit's diff on selection.
    mockInvoke("diff_commit", () => []);
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      commits: [
        mkCommit("a".repeat(40), "first commit"),
        mkCommit("b".repeat(40), "second commit"),
        mkCommit("c".repeat(40), "third commit"),
      ],
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
  });

  it("ArrowDown moves the selected row while the list pane is focused", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });

    expect(rowFor("first commit").hasAttribute("data-selected")).toBe(true);

    press("ArrowDown");
    expect(rowFor("second commit").hasAttribute("data-selected")).toBe(true);
    expect(rowFor("first commit").hasAttribute("data-selected")).toBe(false);
  });

  it("arrows do nothing when another pane is focused", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.detail" });
    expect(press("ArrowDown")).toBe(false);
  });

  it("Enter opens the selected commit's own diff via a nav intent", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });
    press("ArrowDown");
    press("Enter");
    expect(useNavStore.getState().intent).toEqual({
      kind: "commit-self",
      oid: "b".repeat(40),
    });
  });

  it("Home/End jump to the first/last commit", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });
    press("End");
    expect(rowFor("third commit").hasAttribute("data-selected")).toBe(true);
    press("Home");
    expect(rowFor("first commit").hasAttribute("data-selected")).toBe(true);
  });

  it("resets the selection when a client-side filter shrinks the list", () => {
    // Regression: toggling Hide-merges shrinks `visible` without changing
    // baseCommits.length/filterKey. The reset effect must still fire, else the
    // stale index leaves the detail pane + action row acting on visible[0].
    useRepoStore.setState({
      commits: [
        mkCommit("a".repeat(40), "first commit"),
        mkCommit("b".repeat(40), "second commit"),
        // Merge commit (two parents) — dropped by Hide-merges.
        { ...mkCommit("c".repeat(40), "third commit"), parents: ["a".repeat(40), "b".repeat(40)] },
      ],
    } as never);
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });

    // Select the merge commit (last row).
    press("End");
    expect(rowFor("third commit").hasAttribute("data-selected")).toBe(true);

    // Hide merges → the selected merge row disappears from `visible`.
    act(() => {
      fireEvent.click(screen.getByTitle("Filter"));
    });
    act(() => {
      fireEvent.click(screen.getByText("Hide merge commits"));
    });

    // Selection reset to the top rather than pointing past the shrunk list.
    expect(rowFor("first commit").hasAttribute("data-selected")).toBe(true);
    expect(screen.queryByText("third commit")).toBeNull();
  });
});
