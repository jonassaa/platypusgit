// Drag to stage / unstage (#91). The gesture must reach the SAME stage/unstage
// paths the checkbox does — multi-selection bucketing, directory expansion and
// the embedded-repo exclusion included — and it must behave identically in the
// tree and flat view modes.
//
// jsdom has no PointerEvent; a MouseEvent typed as one keeps clientX/clientY.

import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useDragStore } from "@/features/dnd";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { FileStatus } from "@/lib/types";

const modified = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const stagedFile = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Modified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const embedded = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: true,
});

/** One changed line, so the diff pane renders a focusable row. */
const ONE_HUNK = [
  {
    header: "@@ -1,1 +1,1 @@",
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [
      {
        kind: { kind: "Addition" },
        oldLineno: null,
        newLineno: 1,
        content: "added line\n",
      },
    ],
  },
];

function setup(
  status: FileStatus[],
  viewMode: "tree" | "flat" = "flat",
  opts: { withHunk?: boolean } = {},
) {
  localStorage.setItem("pg-commit-view-mode", viewMode);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status,
    branches: [],
    remotes: [],
    commits: [],
    logRef: null,
    loading: false,
  } as never);
  mockInvoke("get_status", () => status);
  mockInvoke("get_diff", () => ({
    path: status[0]?.path ?? "a.ts",
    oldPath: null,
    binary: false,
    additions: opts.withHunk ? 1 : 0,
    deletions: 0,
    hunks: opts.withHunk ? ONE_HUNK : [],
  }));
  mockInvoke("stage_paths", () => null);
  mockInvoke("stage_lines", () => null);
  mockInvoke("unstage_paths", () => null);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  render(<CommitPanelScreen />);
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

/** A full drag: grab `from`, clear the slop over `to`, release on `to`. */
function drag(from: Element, to: Element) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    to.dispatchEvent(pointer("pointermove", 60, 90));
    to.dispatchEvent(pointer("pointermove", 61, 91));
    to.dispatchEvent(pointer("pointerup", 61, 91));
  });
}

const stagedZone = () => screen.getByTestId("staged-list");
/** The CHANGES drop zone is the section wrapper inside the scroller. */
const changesZone = () =>
  screen.getByTestId("changes-list").querySelector("[data-pg-drop-id]")!;
const row = (path: string) => document.querySelector(`[data-path="${path}"]`)!;

const stageCalls = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "stage_paths")
    .map((c) => (c.args as { paths: string[] }).paths);
const unstageCalls = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "unstage_paths")
    .map((c) => (c.args as { paths: string[] }).paths);
/** #122's line-level stage — a different command from the row path entirely. */
const lineStageCalls = () => getInvokeCalls().filter((c) => c.cmd === "stage_lines");

/** Dispatch a bare chord through the real keymap dispatcher. */
function press(key: string): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch({
      key,
      code: key === " " ? "Space" : "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      target: document.body,
    } as unknown as KeyboardEvent);
  });
  return handled;
}

describe("CommitPanel drag staging — flat mode", () => {
  beforeEach(() => {
    resetInvokeMock();
    useDragStore.setState({ payload: null, overId: null });
  });

  it("stages a file dragged from CHANGES onto STAGED", async () => {
    setup([modified("src/a.ts"), stagedFile("src/b.ts")]);
    await waitFor(() => expect(row("src/a.ts")).toBeTruthy());

    drag(row("src/a.ts"), stagedZone());

    await waitFor(() => expect(stageCalls()).toEqual([["src/a.ts"]]));
    expect(unstageCalls()).toEqual([]);
  });

  it("unstages a file dragged from STAGED onto CHANGES", async () => {
    setup([modified("src/a.ts"), stagedFile("src/b.ts")]);
    await waitFor(() => expect(row("src/b.ts")).toBeTruthy());

    drag(row("src/b.ts"), changesZone());

    await waitFor(() => expect(unstageCalls()).toEqual([["src/b.ts"]]));
    expect(stageCalls()).toEqual([]);
  });

  // Dropping a section onto itself is the accident every list-to-list drag has;
  // it must be a no-op, not a round trip through the backend.
  it("does nothing when a row is dropped back on its own section", async () => {
    setup([modified("src/a.ts")]);
    await waitFor(() => expect(row("src/a.ts")).toBeTruthy());

    drag(row("src/a.ts"), changesZone());

    expect(stageCalls()).toEqual([]);
    expect(unstageCalls()).toEqual([]);
  });

  // Same rule as the checkbox (`togglePaths`): a row inside the multi-selection
  // carries every selected row on its side.
  it("carries the whole multi-selection when the grabbed row is inside it", async () => {
    setup([modified("src/a.ts"), modified("src/b.ts"), modified("src/c.ts")]);
    await waitFor(() => expect(row("src/c.ts")).toBeTruthy());

    fireEvent.click(row("src/a.ts"));
    fireEvent.click(row("src/c.ts"), { shiftKey: true });
    drag(row("src/b.ts"), stagedZone());

    await waitFor(() => expect(stageCalls().length).toBe(1));
    expect(stageCalls()[0].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("stays single-file when the grabbed row is outside the selection", async () => {
    setup([modified("src/a.ts"), modified("src/b.ts"), modified("src/c.ts")]);
    await waitFor(() => expect(row("src/c.ts")).toBeTruthy());

    fireEvent.click(row("src/a.ts"));
    fireEvent.click(row("src/b.ts"), { shiftKey: true });
    drag(row("src/c.ts"), stagedZone());

    await waitFor(() => expect(stageCalls()).toEqual([["src/c.ts"]]));
  });

  // An embedded repo would be written to the index as a bare gitlink. It is
  // excluded by splitFileSelection, so the payload is empty and no drag starts.
  it("never carries an embedded repository", async () => {
    setup([embedded("vendor/lib/")]);
    await waitFor(() => expect(document.querySelector("[data-path]")).toBeTruthy());

    drag(document.querySelector("[data-path]")!, stagedZone());

    expect(stageCalls()).toEqual([]);
  });

  it("shows what the hovered zone will do", async () => {
    setup([modified("src/a.ts")]);
    await waitFor(() => expect(row("src/a.ts")).toBeTruthy());

    act(() => {
      row("src/a.ts").dispatchEvent(pointer("pointerdown", 10, 10));
      stagedZone().dispatchEvent(pointer("pointermove", 60, 90));
      stagedZone().dispatchEvent(pointer("pointermove", 61, 91));
    });
    expect(screen.getByTestId("drop-hint").textContent).toBe("Drop to stage");
    expect(stagedZone().hasAttribute("data-pg-drop-over")).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("drop-hint")).toBeNull();
    expect(stageCalls()).toEqual([]);
  });
});

// #122 added a per-line keyboard cursor and the pane-scoped `diff.toggleLine`
// (Space) to this screen's `commit.diff` pane, while the drag work lives in the
// `commit.files` pane. Both are bound to " " and both are pane-scoped, so the
// question is whether they can reach each other. These assert the boundary
// against the merged code rather than against reasoning about it.
describe("CommitPanel drag vs the diff pane's line cursor (#91 × #122)", () => {
  beforeEach(() => {
    resetInvokeMock();
    useDragStore.setState({ payload: null, overId: null });
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

  // The drag sources are attached inside <PGPane id="commit.files">; the diff
  // rows render inside <PGPane id="commit.diff">. Different subtrees, so a
  // pointerdown on a diff line never reaches the source's delegated handler and
  // a line cursor can never be dragged out from under itself.
  it("does not start a drag from a diff line", async () => {
    setup([modified("src/a.ts")], "flat", { withHunk: true });
    const line = await screen.findByTestId("diff-line-changed");

    act(() => {
      line.dispatchEvent(pointer("pointerdown", 10, 10));
      line.dispatchEvent(pointer("pointermove", 200, 200));
      line.dispatchEvent(pointer("pointerup", 200, 200));
    });

    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    expect(useDragStore.getState().payload).toBeNull();
    expect(stageCalls()).toEqual([]);
  });

  // Space in the diff pane must still reach #122's LINE action with the drag work
  // present. `list.toggle` shares the chord, so a stray non-declining handler
  // would shadow it and Space would stage the whole FILE instead of the line.
  it("leaves Space in the diff pane staging a line, not the row", async () => {
    setup([modified("src/a.ts")], "flat", { withHunk: true });
    await screen.findByTestId("diff-line-changed");
    useFocusStore.setState({ focused: "commit.diff" });

    // Space means nothing until the line cursor is on a line, so move it first
    // (#122's own precondition — ArrowDown is list.down for this pane).
    expect(press("ArrowDown")).toBe(true);
    expect(press(" ")).toBe(true);

    await waitFor(() => expect(lineStageCalls().length).toBe(1));
    // The row path never fired: Space staged a LINE, not the file.
    expect(stageCalls()).toEqual([]);
  });
});

describe("CommitPanel drag staging — tree mode", () => {
  beforeEach(() => {
    resetInvokeMock();
    useDragStore.setState({ payload: null, overId: null });
  });

  // Tree rows carry the tree key in data-path while flat rows carry the file
  // path; both resolve to the same slot, which is the property lib/tree.ts
  // guarantees and this screen depends on.
  it("stages a file row exactly as flat mode does", async () => {
    setup([modified("src/a.ts"), modified("src/b.ts")], "tree");
    await waitFor(() => expect(row("src/a.ts")).toBeTruthy());

    drag(row("src/a.ts"), stagedZone());

    await waitFor(() => expect(stageCalls()).toEqual([["src/a.ts"]]));
  });

  // A folder row has no slot behind it — it must act on everything beneath it,
  // the same as its tri-state checkbox and its context menu.
  it("stages every file beneath a dragged directory row", async () => {
    setup([modified("src/a.ts"), modified("src/b.ts"), modified("docs/c.md")], "tree");
    await waitFor(() => expect(row("src")).toBeTruthy());

    drag(row("src"), stagedZone());

    await waitFor(() => expect(stageCalls().length).toBe(1));
    expect(stageCalls()[0].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("unstages every file beneath a dragged directory row", async () => {
    setup([stagedFile("src/a.ts"), stagedFile("src/b.ts")], "tree");
    await waitFor(() => expect(row("src")).toBeTruthy());

    drag(row("src"), changesZone());

    await waitFor(() => expect(unstageCalls().length).toBe(1));
    expect(unstageCalls()[0].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
