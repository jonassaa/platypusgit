// Keyboard-navigation behavior of the Commit screen: one selection across the
// staged + unstaged sections, Space stages/unstages the selected file.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
    ...over,
  }) as unknown as KeyboardEvent;

/** Dispatch through the keymap store, flushing the resulting React updates. */
function press(k: string, over: Partial<KeyboardEvent> = {}): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k, over));
  });
  return handled;
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

  describe("commit chords", () => {
    const commitCalls: Array<[string, boolean, boolean]> = [];
    const pushCalls: Array<[string, string]> = [];

    beforeEach(() => {
      commitCalls.length = 0;
      pushCalls.length = 0;
      useRepoStore.setState({
        branches: [
          {
            name: "main", isHead: true, isRemote: false,
            upstream: "origin/main", ahead: 0, behind: 0, tip: "abc",
          },
        ],
        remotes: [{ name: "origin", url: "/tmp/bare" }],
        commit: async (m: string, amend?: boolean, signoff?: boolean) => {
          commitCalls.push([m, !!amend, !!signoff]);
          return "oid123";
        },
        push: async (remote: string, branch: string) => {
          pushCalls.push([remote, branch]);
        },
      } as never);
    });

    const typeSubject = (text: string) => {
      fireEvent.change(screen.getByTestId("commit-subject"), {
        target: { value: text },
      });
    };

    it("Mod+Enter commits the typed message", () => {
      render(<CommitPanelScreen />);
      typeSubject("feat: via chord");
      expect(press("Enter", { metaKey: true })).toBe(true);
      expect(commitCalls).toEqual([["feat: via chord", false, false]]);
      expect(pushCalls).toEqual([]);
    });

    it("Mod+Enter does not double-commit while the first commit is in flight", async () => {
      // Regression: key auto-repeat / double-tap re-dispatches the chord while
      // canCommit is still true (message not yet cleared). The in-flight guard
      // must swallow the second commit.
      let resolve: (() => void) | null = null;
      let calls = 0;
      useRepoStore.setState({
        commit: () => {
          calls++;
          return new Promise<string>((r) => {
            resolve = () => r("oid123");
          });
        },
      } as never);
      render(<CommitPanelScreen />);
      typeSubject("feat: once");

      press("Enter", { metaKey: true });
      press("Enter", { metaKey: true }); // second fire before the first resolves
      expect(calls).toBe(1);

      // Once the in-flight commit resolves, a fresh chord commits again.
      await act(async () => {
        resolve?.();
      });
      typeSubject("feat: again");
      press("Enter", { metaKey: true });
      expect(calls).toBe(2);
    });

    it("Mod+Enter declines with an empty message (button would be disabled)", () => {
      render(<CommitPanelScreen />);
      expect(press("Enter", { metaKey: true })).toBe(false);
      expect(commitCalls).toEqual([]);
    });

    it("Mod+Shift+Enter commits then pushes to the default remote", async () => {
      render(<CommitPanelScreen />);
      typeSubject("feat: ship it");
      expect(press("Enter", { metaKey: true, shiftKey: true })).toBe(true);
      // commit → push is async; flush microtasks.
      await act(async () => {});
      expect(commitCalls).toEqual([["feat: ship it", false, false]]);
      expect(pushCalls).toEqual([["origin", "main"]]);
    });

    it("Mod+Shift+M toggles amend (commit button relabels)", () => {
      render(<CommitPanelScreen />);
      expect(screen.getByTestId("commit-button").textContent).toContain("Commit");
      expect(press("m", { metaKey: true, shiftKey: true, code: "KeyM" })).toBe(true);
      expect(screen.getByTestId("commit-button").textContent).toContain("Amend");
      press("m", { metaKey: true, shiftKey: true, code: "KeyM" });
      expect(screen.getByTestId("commit-button").textContent).toContain("Commit");
    });
  });
});
