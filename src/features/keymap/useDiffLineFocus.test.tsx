// Per-line keyboard focus for a diff pane (#61 D7 step 5).
//
// The load-bearing assertion is the index mapping: the cursor counts CHANGED
// (+/-) lines only, so a hunk with context rows must still report the
// changedIndex the backend's line ops expect. A cursor over every rendered row
// would drift by one per context line.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useDiffLineFocus, diffLineTargets, type DiffLineTarget } from "./useDiffLineFocus";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

type Hunk = FileDiff["hunks"][number];

const ctx = (n: number) => ({
  kind: { kind: "Context" as const },
  oldLineno: n,
  newLineno: n,
  content: `ctx${n}\n`,
});
const add = (n: number) => ({
  kind: { kind: "Addition" as const },
  oldLineno: null,
  newLineno: n,
  content: `add${n}\n`,
});
const rem = (n: number) => ({
  kind: { kind: "Deletion" as const },
  oldLineno: n,
  newLineno: null,
  content: `rem${n}\n`,
});

/** Context, add, context, remove, add — changed indices 0,1,2 amid context. */
const hunkWithContext = (header: string, start = 1): Hunk => ({
  header,
  oldStart: start,
  oldLines: 3,
  newStart: start,
  newLines: 4,
  lines: [ctx(1), add(2), ctx(3), rem(4), add(5)],
});

const rowsFor = (hunks: Hunk[]) =>
  flattenDiffRows(hunks, { foldH: 22, rowH: 18 });

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

function Harness(props: {
  rows: ReturnType<typeof rowsFor>;
  onToggle?: (t: DiffLineTarget) => void;
  scrollToRow?: (i: number) => void;
  disabled?: boolean;
  seen: { focus: DiffLineTarget | null };
}) {
  const f = useDiffLineFocus({
    paneId: "d.diff",
    rows: props.rows,
    resetKey: props.rows,
    onToggle: props.onToggle,
    scrollToRow: props.scrollToRow,
    disabled: props.disabled,
  });
  props.seen.focus = f.focused;
  return null;
}

function reset() {
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

describe("diffLineTargets", () => {
  it("numbers changed lines only, skipping context", () => {
    const targets = diffLineTargets(rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")]));
    expect(targets.map((t) => t.changedIndex)).toEqual([0, 1, 2]);
    // The hunk's lines are ctx, add, ctx, rem, add, so the changed rows are 1, 3,
    // 4 — proving the cursor's own row index and the backend's changed index are
    // NOT the same number, which is exactly why both are carried. (There is no
    // header row any more, so nothing shifts these but the context lines.)
    expect(targets.map((t) => t.rowIndex)).toEqual([1, 3, 4]);
  });

  it("restarts changedIndex per hunk while rowIndex keeps rising", () => {
    const targets = diffLineTargets(
      rowsFor([hunkWithContext("@@ -1,3 +1,4 @@"), hunkWithContext("@@ -20,3 +20,4 @@")]),
    );
    expect(targets.map((t) => [t.hunkIndex, t.changedIndex])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    const rowIdx = targets.map((t) => t.rowIndex);
    expect([...rowIdx].sort((a, b) => a - b)).toEqual(rowIdx);
  });

  it("skips whole-file fill rows, which belong to no hunk", () => {
    const rows = flattenDiffRows([hunkWithContext("@@ -1,3 +1,4 @@")], {
      foldH: 22,
      rowH: 18,
      text: { newText: "ctx1\nadd2\nctx3\nadd5\nafter1\nafter2\n", oldText: null },
      gaps: "fill",
    });
    expect(rows.some((r) => r.kind === "fill")).toBe(true);
    expect(diffLineTargets(rows).map((t) => t.changedIndex)).toEqual([0, 1, 2]);
  });

  it("skips chunked mode's fold separators, which belong to no hunk either", () => {
    // A fold row carries no hunkIndex and no line — the cursor must not stop on
    // one, and Space must have nothing to stage there (#157).
    const rows = flattenDiffRows([hunkWithContext("@@ -4,3 +4,4 @@", 4)], {
      foldH: 22,
      rowH: 18,
      gaps: "fold",
    });
    expect(rows.some((r) => r.kind === "fold")).toBe(true);
    expect(diffLineTargets(rows).map((t) => t.changedIndex)).toEqual([0, 1, 2]);
  });
});

describe("useDiffLineFocus", () => {
  beforeEach(reset);

  it("has no cursor until an arrow key moves into the lines", () => {
    const seen = { focus: null as DiffLineTarget | null };
    render(<Harness rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")])} seen={seen} />);
    useFocusStore.setState({ focused: "d.diff" });
    expect(seen.focus).toBeNull();

    press("ArrowDown");
    expect(seen.focus).toMatchObject({ hunkIndex: 0, changedIndex: 0 });
    press("ArrowDown");
    expect(seen.focus).toMatchObject({ hunkIndex: 0, changedIndex: 1 });
    press("ArrowUp");
    expect(seen.focus).toMatchObject({ hunkIndex: 0, changedIndex: 0 });
  });

  it("moves across the hunk boundary and clamps at both ends", () => {
    const seen = { focus: null as DiffLineTarget | null };
    render(
      <Harness
        rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@"), hunkWithContext("@@ -20,3 +20,4 @@")])}
        seen={seen}
      />,
    );
    useFocusStore.setState({ focused: "d.diff" });
    for (let i = 0; i < 4; i++) press("ArrowDown");
    expect(seen.focus).toMatchObject({ hunkIndex: 1, changedIndex: 0 });
    for (let i = 0; i < 10; i++) press("ArrowDown");
    expect(seen.focus).toMatchObject({ hunkIndex: 1, changedIndex: 2 });
    for (let i = 0; i < 20; i++) press("ArrowUp");
    expect(seen.focus).toMatchObject({ hunkIndex: 0, changedIndex: 0 });
  });

  it("Space reports the focused target and is declined without a cursor", () => {
    const onToggle = vi.fn();
    const seen = { focus: null as DiffLineTarget | null };
    render(
      <Harness rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")])} onToggle={onToggle} seen={seen} />,
    );
    useFocusStore.setState({ focused: "d.diff" });

    // No cursor yet: the chord must fall through rather than be swallowed.
    expect(press(" ")).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();

    press("ArrowDown");
    press("ArrowDown");
    expect(press(" ")).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The SECOND changed line — index 1 among +/- rows, even though a context row
    // sits between it and the first.
    expect(onToggle.mock.calls[0][0]).toMatchObject({ hunkIndex: 0, changedIndex: 1 });
  });

  it("answers nothing while another pane holds focus", () => {
    const onToggle = vi.fn();
    const seen = { focus: null as DiffLineTarget | null };
    render(
      <Harness rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")])} onToggle={onToggle} seen={seen} />,
    );
    useFocusStore.setState({ focused: "somewhere.else" });
    expect(press("ArrowDown")).toBe(false);
    expect(press(" ")).toBe(false);
    expect(seen.focus).toBeNull();
  });

  it("offers no cursor at all while disabled (ignore-whitespace)", () => {
    const onToggle = vi.fn();
    const seen = { focus: null as DiffLineTarget | null };
    render(
      <Harness
        rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")])}
        onToggle={onToggle}
        disabled
        seen={seen}
      />,
    );
    useFocusStore.setState({ focused: "d.diff" });
    // count 0 → usePaneList declines, so the arrows still scroll the pane.
    expect(press("ArrowDown")).toBe(false);
    expect(seen.focus).toBeNull();
    expect(press(" ")).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("scrolls by ROW index, not by the changed index", () => {
    const scrollToRow = vi.fn();
    const seen = { focus: null as DiffLineTarget | null };
    render(
      <Harness
        rows={rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")])}
        scrollToRow={scrollToRow}
        seen={seen}
      />,
    );
    useFocusStore.setState({ focused: "d.diff" });
    scrollToRow.mockClear();
    press("ArrowDown");
    // Changed index 0 lives at flat row 1 — one context row is ahead of it, and
    // scrolling addresses the rendered row.
    expect(scrollToRow).toHaveBeenLastCalledWith(1);
  });

  it("drops a cursor that a shrinking diff left past the end", () => {
    const seen = { focus: null as DiffLineTarget | null };
    const two = rowsFor([hunkWithContext("@@ -1,3 +1,4 @@"), hunkWithContext("@@ -20,3 +20,4 @@")]);
    const { rerender } = render(<Harness rows={two} seen={seen} />);
    useFocusStore.setState({ focused: "d.diff" });
    for (let i = 0; i < 6; i++) press("ArrowDown");
    expect(seen.focus).toMatchObject({ hunkIndex: 1, changedIndex: 2 });

    const one = rowsFor([hunkWithContext("@@ -1,3 +1,4 @@")]);
    act(() => rerender(<Harness rows={one} seen={seen} />));
    expect(seen.focus).toBeNull();
  });
});
