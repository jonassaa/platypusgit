// History wiring the commit menu's "Go to parent / child commit" to its own
// selection.
//
// The menu builder lives in `src/design/` and cannot reach this screen's
// selection — it is local component state — so the connection is a callback,
// and this file is what proves the callback is actually connected. The menu's
// own half (which oid it asks for, and when it refuses) lives in
// `src/design/context-menu.goto.test.tsx`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { resetDialogs } from "@/test/dialog";
import { mockInvoke } from "@/test/invokeMock";
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

const rowFor = (text: string) => {
  const row = screen
    .getAllByText(text)
    .map((el) => el.closest("[data-pg-row]"))
    .find((el): el is Element => el != null);
  expect(row, `no row for ${text}`).toBeTruthy();
  return row! as HTMLElement;
};
const isSelected = (text: string) => rowFor(text).hasAttribute("data-selected");

/** Open the row's context menu and click an item by its exact label. */
function menuItem(label: RegExp): HTMLElement {
  const menu = document.querySelector("[data-pg-menu]");
  expect(menu, "no context menu open").toBeTruthy();
  const found = Array.from(menu!.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && label.test(el.textContent ?? ""),
  );
  expect(found, `no menu item matching ${label}`).toBeTruthy();
  return found as HTMLElement;
}

beforeEach(() => {
  resetDialogs();
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
    headInfo: { branch: "main", headOid: A },
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
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 1, mergeBase: D }));
});

afterEach(() => vi.restoreAllMocks());

describe("History: go to parent / child commit", () => {
  it("moves the selection to the parent", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit B"));
    expect(isSelected("commit B")).toBe(true);

    fireEvent.contextMenu(rowFor("commit B"));
    fireEvent.click(menuItem(/^Go to parent commit$/));

    // B's parent is C.
    expect(isSelected("commit C")).toBe(true);
    expect(isSelected("commit B")).toBe(false);
  });

  it("moves the selection to the child", () => {
    render(<HistoryScreen />);
    fireEvent.click(rowFor("commit B"));

    fireEvent.contextMenu(rowFor("commit B"));
    fireEvent.click(menuItem(/^Go to child commit$/));

    // A is the only loaded commit listing B as a parent.
    expect(isSelected("commit A")).toBe(true);
    expect(isSelected("commit B")).toBe(false);
  });

  it("offers the entries at all — the callback is wired, not just declared", () => {
    // The regression this guards is a real one in shape: commitMenuItems omits
    // both entries entirely when no onGoTo is passed, so forgetting to wire it
    // would leave the feature invisible with nothing else failing.
    render(<HistoryScreen />);
    fireEvent.contextMenu(rowFor("commit B"));
    expect(menuItem(/^Go to parent commit$/)).toBeTruthy();
    expect(menuItem(/^Go to child commit$/)).toBeTruthy();
  });

  it("says so rather than moving nowhere when the target is off the visible log", () => {
    // Only the tip is loaded; its parent's oid is real but not in the list.
    useRepoStore.setState({ commits: [mkCommit(A, "commit A", [B])] } as never);
    render(<HistoryScreen />);
    fireEvent.contextMenu(rowFor("commit A"));
    fireEvent.click(menuItem(/^Go to parent commit$/));

    // The one loaded row keeps the selection, and the flash explains why.
    expect(isSelected("commit A")).toBe(true);
    expect(screen.getByText(/not in the visible log/)).toBeInTheDocument();
  });
});
