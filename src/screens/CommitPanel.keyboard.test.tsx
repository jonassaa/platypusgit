// Keyboard-navigation behavior of the Commit screen: one selection across the
// staged + unstaged sections, Space stages/unstages the selected file.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

const staged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
});
const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
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
function press(k: string): void {
  act(() => {
    useKeymapStore.getState().dispatch(key(k));
  });
}

/** File paths also render in the diff header — resolve to the change-list row. */
const rowFor = (path: string) => {
  const row = screen
    .getAllByText(path)
    .map((el) => el.closest("[data-pg-row]"))
    .find((el): el is Element => el != null);
  expect(row).toBeTruthy();
  return row!;
};

describe("CommitPanel keyboard navigation", () => {
  const stagedCalls: string[][] = [];
  const unstagedCalls: string[][] = [];

  beforeEach(() => {
    stagedCalls.length = 0;
    unstagedCalls.length = 0;
    mockInvoke("get_diff", () => ({
      path: "x",
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
    }));
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      status: [staged("a.ts"), unstaged("b.ts"), unstaged("c.ts")],
      branches: [],
      remotes: [],
      commits: [],
      loading: false,
      stage: async (paths: string[]) => {
        stagedCalls.push(paths);
      },
      unstage: async (paths: string[]) => {
        unstagedCalls.push(paths);
      },
    } as never);
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

  it("arrows walk across the staged and unstaged sections in render order", () => {
    render(<CommitPanelScreen />);
    useFocusStore.setState({ focused: "commit.files" });

    // Default selection is the first unstaged file.
    expect(rowFor("b.ts").hasAttribute("data-selected")).toBe(true);

    // Up from the first unstaged file lands on the staged file above it.
    press("ArrowUp");
    expect(rowFor("a.ts").hasAttribute("data-selected")).toBe(true);

    press("ArrowDown");
    press("ArrowDown");
    expect(rowFor("c.ts").hasAttribute("data-selected")).toBe(true);
  });

  it("Space unstages a staged file and stages an unstaged one", () => {
    render(<CommitPanelScreen />);
    useFocusStore.setState({ focused: "commit.files" });

    // Selection starts on b.ts (unstaged) → Space stages it.
    press(" ");
    expect(stagedCalls).toEqual([["b.ts"]]);

    // Move up to a.ts (staged) → Space unstages it.
    press("ArrowUp");
    press(" ");
    expect(unstagedCalls).toEqual([["a.ts"]]);
  });
});
