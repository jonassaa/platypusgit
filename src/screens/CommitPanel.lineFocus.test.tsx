// Space stages the focused diff line (#61 D7 step 5).
//
// D7 shipped click + shift-click line selection but no keyboard affordance,
// because the diff pane had no per-line cursor. These tests pin the wiring end to
// end: arrows move a visible cursor inside the diff pane, Space applies the
// side-appropriate line op, and the index that reaches the backend is the index
// among the hunk's CHANGED (+/-) lines — a leading context row must not shift it.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { settleDiff } from "@/test/settle";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const unstagedFile = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 3,
  deletions: 0,
  embedded: false,
});
const stagedFile = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 3,
  deletions: 0,
  embedded: false,
});

/**
 * One hunk: a leading context row, then three additions.
 *
 * The context row is what makes this fixture worth having — it is row 1 of the
 * hunk but carries no changedIndex, so a cursor that counted rendered rows would
 * report 0 where the backend expects 1.
 */
const diffWithContextThenThreeAdditions = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,1 +1,4 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "base\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "add1\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 3, content: "add2\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 4, content: "add3\n" },
      ],
    },
  ],
});

const lastCall = (cmd: string) =>
  [...getInvokeCalls()].reverse().find((c) => c.cmd === cmd);

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

function press(k: string): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k));
  });
  return handled;
}

const changedRows = () => screen.getAllByTestId("diff-line-changed");
const focusedRowIndex = () =>
  changedRows().findIndex((r) => r.hasAttribute("data-focused"));

/** `status` seeds the store AND answers get_status, so the two cannot disagree. */
async function setup(status: FileStatus[]) {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status,
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", (args) =>
    diffWithContextThenThreeAdditions(args.path as string),
  );
  mockInvoke("get_status", () => status);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("stage_lines", () => undefined);
  mockInvoke("unstage_lines", () => undefined);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
  await screen.findAllByTestId("diff-line-changed");
  await settleDiff();
  // The pane must hold focus for its pane-scoped handlers to be delivered —
  // clicking a line does this in the app (PGPane's onClickCapture).
  act(() => {
    useFocusStore.setState({ focused: "commit.diff" });
  });
}

describe("CommitPanel diff-line focus (#61 D7 step 5)", () => {
  describe("on the unstaged side", () => {
    beforeEach(() => setup([unstagedFile("a.ts")]));

    it("has no cursor until an arrow key moves into the lines", () => {
      expect(focusedRowIndex()).toBe(-1);
      press("ArrowDown");
      expect(focusedRowIndex()).toBe(0);
    });

    it("moves the cursor down and up, skipping the context row", () => {
      // Three selectable rows for four hunk lines: the context row is not one of
      // them, so the cursor cannot land on it.
      expect(changedRows()).toHaveLength(3);
      press("ArrowDown");
      press("ArrowDown");
      expect(focusedRowIndex()).toBe(1);
      press("ArrowDown");
      expect(focusedRowIndex()).toBe(2);
      // Clamps at the end rather than wrapping.
      press("ArrowDown");
      expect(focusedRowIndex()).toBe(2);
      press("ArrowUp");
      expect(focusedRowIndex()).toBe(1);
    });

    it("Space stages the focused line, numbered among changed lines", async () => {
      press("ArrowDown");
      press("ArrowDown");
      expect(press(" ")).toBe(true);

      await waitFor(() =>
        expect(lastCall("stage_lines")?.args).toMatchObject({
          path: "a.ts",
          hunkIndex: 0,
          // The SECOND addition. A cursor counting rendered rows would send 2
          // here, because the context row sits at hunk-line 0.
          selected: [1],
        }),
      );
    });

    it("Space with no cursor stages nothing and lets the chord fall through", () => {
      expect(press(" ")).toBe(false);
      expect(lastCall("stage_lines")).toBeUndefined();
    });

    it("Space acts on the whole line selection when the cursor is inside it", async () => {
      const rows = changedRows();
      fireEvent.click(rows[0]);
      await waitFor(() =>
        expect(screen.getByTestId("hunk-stage").textContent).toMatch(/1 line/i),
      );
      fireEvent.click(screen.getAllByTestId("diff-line-changed")[2], {
        shiftKey: true,
      });
      await waitFor(() =>
        expect(screen.getByTestId("hunk-stage").textContent).toMatch(/3 lines/i),
      );

      // Cursor onto the middle line, which the range selection covers.
      press("ArrowDown");
      press("ArrowDown");
      press(" ");

      // Same rule as Space on the file list, which acts on the whole
      // multi-selection when the row is part of it.
      await waitFor(() =>
        expect(lastCall("stage_lines")?.args).toMatchObject({ selected: [0, 1, 2] }),
      );
    });

    it("Space acts on the focused line alone when it is outside the selection", async () => {
      fireEvent.click(changedRows()[0]);
      await waitFor(() =>
        expect(screen.getByTestId("hunk-stage").textContent).toMatch(/1 line/i),
      );

      press("ArrowDown");
      press("ArrowDown");
      press("ArrowDown");
      press(" ");

      await waitFor(() =>
        expect(lastCall("stage_lines")?.args).toMatchObject({ selected: [2] }),
      );
    });

    it("offers no cursor while whitespace is ignored", async () => {
      fireEvent.click(screen.getByTitle("Ignore whitespace-only changes"));
      await waitFor(() =>
        expect(screen.queryAllByTestId("diff-line-changed")).toHaveLength(0),
      );
      // Same gate as the click path: these indices would not address what git
      // applies (#61 D2).
      expect(press(" ")).toBe(false);
      expect(lastCall("stage_lines")).toBeUndefined();
    });
  });

  describe("on the staged side", () => {
    beforeEach(() => setup([stagedFile("a.ts")]));

    it("Space unstages the focused line", async () => {
      press("ArrowDown");
      press("ArrowDown");
      expect(press(" ")).toBe(true);

      await waitFor(() =>
        expect(lastCall("unstage_lines")?.args).toMatchObject({
          path: "a.ts",
          hunkIndex: 0,
          selected: [1],
        }),
      );
      // Direction comes from the row's side, exactly as the hunk header's button
      // decides it — never from staging twice.
      expect(lastCall("stage_lines")).toBeUndefined();
    });
  });
});
