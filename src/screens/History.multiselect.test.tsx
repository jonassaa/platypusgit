// Multi-select behavior of the History screen: ctrl/shift click, Shift+Arrow
// range extend, and the multi-commit action row (combined diff, cherry-pick
// set, squash gating).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

// Newest-first linear log: a → b → c → d(root).
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

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function press(k: string, mods: Partial<KeyboardEvent> = {}): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k, mods));
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
const isSelected = (text: string) => rowFor(text).hasAttribute("data-selected");

describe("History multi-select", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      commits: [
        mkCommit(A, "commit A", [B]),
        mkCommit(B, "commit B", [C]),
        mkCommit(C, "commit C", [D]),
        mkCommit(D, "commit D", []),
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

  afterEach(() => vi.restoreAllMocks());

  it("ctrl-click toggles a second commit into the selection", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit C"), { ctrlKey: true });
    expect(isSelected("commit A")).toBe(true);
    expect(isSelected("commit C")).toBe(true);
    expect(isSelected("commit B")).toBe(false);
    expect(screen.getByText(/2 commits selected/)).toBeInTheDocument();
  });

  it("shift-click selects a contiguous range", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit C"), { shiftKey: true });
    expect(isSelected("commit A")).toBe(true);
    expect(isSelected("commit B")).toBe(true);
    expect(isSelected("commit C")).toBe(true);
    expect(isSelected("commit D")).toBe(false);
  });

  it("Shift+ArrowDown extends the selection from the anchor", () => {
    render(<HistoryScreen />);
    useFocusStore.setState({ focused: "history.list" });
    // Cursor starts on the first row (A). Extend down twice → A,B,C.
    expect(press("ArrowDown", { shiftKey: true })).toBe(true);
    expect(press("ArrowDown", { shiftKey: true })).toBe(true);
    expect(isSelected("commit A")).toBe(true);
    expect(isSelected("commit B")).toBe(true);
    expect(isSelected("commit C")).toBe(true);
    expect(isSelected("commit D")).toBe(false);
  });

  it("View combined diff fires a commit-vs-commit intent (parent-of-oldest → newest)", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true }); // select A,B
    fireEvent.click(screen.getByText("View combined diff"));
    // Oldest selected = B (parent C), newest = A.
    expect(useNavStore.getState().intent).toEqual({
      kind: "commit-vs-commit",
      from: C,
      to: A,
    });
  });

  it("Cherry-pick N confirms then calls cherryPickMany oldest→newest", () => {
    const picked: string[][] = [];
    useRepoStore.setState({
      cherryPickMany: async (oids: string[]) => {
        picked.push(oids);
      },
    } as never);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true }); // A,B
    fireEvent.click(screen.getByTestId("multi-cherry-pick"));
    expect(picked).toEqual([[B, A]]); // oldest first
  });

  it("Squash is disabled for a non-contiguous selection", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit C"), { ctrlKey: true }); // A + C, skipping B
    expect(screen.getByTestId("multi-squash")).toBeDisabled();
  });

  it("Squash is enabled for a contiguous, merge-free range", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit A"));
    fireEvent.click(rowFor("commit B"), { shiftKey: true }); // A,B (base = C)
    expect(screen.getByTestId("multi-squash")).not.toBeDisabled();
  });
});
