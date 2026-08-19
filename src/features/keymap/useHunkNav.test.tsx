// useHunkNav — F7/⇧F7 hunk cursor for diff panes: advances/retreats with
// clamping, scrolls the active hunk into view, resets when the viewed file
// changes, and answers only while one of its panes holds focus. Plus the issue
// 188 behaviours: opening a file AT its first change, and carrying F7 into the
// next file once the current one is exhausted.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useHunkNav } from "./useHunkNav";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";
import { PG_FLASH_MS } from "@/design/ui-helpers";

function Harness({
  count,
  resetKey,
  onCursor,
  paneIds = ["d.files", "d.view"],
  ready,
  scrollToHunk,
}: {
  count: number;
  resetKey: string;
  onCursor: (c: number) => void;
  paneIds?: string[];
  ready?: boolean;
  scrollToHunk?: (i: number) => void;
}) {
  const cursor = useHunkNav({ paneIds, count, resetKey, ready, scrollToHunk });
  onCursor(cursor);
  return null;
}

/**
 * A surface with a FILE LIST, so F7 can carry out of the current file.
 *
 * Stateful on purpose: the crossing is only real if selecting the next file
 * actually changes what the hook is looking at, which is what makes the landing
 * edge (first change forward, LAST change backward) observable.
 */
function FileHarness({
  hunksPerFile,
  ready = true,
  onCursor,
  onSelect,
  scrollToHunk,
  startIndex = 0,
}: {
  hunksPerFile: number[];
  ready?: boolean;
  onCursor: (c: number) => void;
  onSelect?: (i: number) => void;
  scrollToHunk?: (i: number) => void;
  startIndex?: number;
}) {
  const [index, setIndex] = React.useState(startIndex);
  const cursor = useHunkNav({
    paneIds: ["d.view"],
    count: hunksPerFile[index] ?? 0,
    resetKey: `file:${index}`,
    ready,
    // Defaulted, and never omitted: a caller with no `scrollToHunk` falls back to
    // a DOM query, which reports FALSE when the row is not mounted — and this
    // harness renders no rows, so the auto-open would never land. A surface that
    // scrolls and reports nothing is the shape being modelled here.
    scrollToHunk: scrollToHunk ?? (() => {}),
    files: {
      count: hunksPerFile.length,
      index,
      select: (i) => {
        onSelect?.(i);
        setIndex(i);
      },
    },
  });
  onCursor(cursor);
  return <div data-testid="file-index">{index}</div>;
}

/** The one toast element, if one is up. `null` means nothing was flashed. */
const flashText = (): string | null =>
  document.querySelector("[data-pg-flash]")?.textContent ?? null;
const flashCount = () => document.querySelectorAll("[data-pg-flash]").length;

const key = (k: string, shift = false) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: shift,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function press(k: string, shift = false): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k, shift));
  });
  return handled;
}

/** A pane element carrying one `[data-hunk-index]` wrapper per hunk, each with
 *  its own scrollIntoView spy so the "first matching pane" pick is observable. */
function mountPane(paneId: string, hunks: number[]): Map<number, () => void> {
  const pane = document.createElement("div");
  pane.setAttribute("data-pg-pane", paneId);
  const spies = new Map<number, () => void>();
  for (const i of hunks) {
    const hunk = document.createElement("div");
    hunk.setAttribute("data-hunk-index", String(i));
    const spy = vi.fn();
    hunk.scrollIntoView = spy;
    spies.set(i, spy);
    pane.appendChild(hunk);
  }
  document.body.appendChild(pane);
  return spies;
}

describe("useHunkNav", () => {
  let cursor = -1;
  const onCursor = (c: number) => {
    cursor = c;
  };

  beforeEach(() => {
    cursor = -1;
    Element.prototype.scrollIntoView = vi.fn();
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

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("F7 walks forward with clamping; ⇧F7 walks back", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
    press("F7");
    press("F7");
    expect(cursor).toBe(2);
    press("F7"); // clamp
    expect(cursor).toBe(2);
    press("F7", true); // Shift+F7
    expect(cursor).toBe(1);
    press("F7", true);
    press("F7", true); // clamp at the first hunk
    expect(cursor).toBe(0);
  });

  it("answers from the file-list pane too, declines with no hunks", () => {
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} />,
    );
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
    // Same chord, other pane of the same screen — one registration serves both.
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(1);

    rerender(<Harness count={0} resetKey="b" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(false);
  });

  it("declines while an unrelated pane holds focus, or with no pane focused", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "elsewhere" });
    expect(press("F7")).toBe(false);
    expect(press("F7", true)).toBe(false);
    expect(cursor).toBe(-1);
    useFocusStore.setState({ focused: null });
    expect(press("F7")).toBe(false);
    expect(cursor).toBe(-1);
  });

  it("scopes follow a changed pane list", () => {
    const { rerender } = render(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        paneIds={["d.files", "d.view"]}
      />,
    );
    rerender(
      <Harness count={3} resetKey="a" onCursor={onCursor} paneIds={["d.view"]} />,
    );
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(false);
    expect(cursor).toBe(-1);
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
  });

  it("scrolls the FIRST pane that renders the target hunk", () => {
    const files = mountPane("d.files", [0]); // a stand-in leading pane
    const view = mountPane("d.view", [0]);
    render(<Harness count={2} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(files.get(0)).toHaveBeenCalledOnce();
    expect(view.get(0)).not.toHaveBeenCalled();
  });

  it("falls through to a later pane when the earlier one lacks the hunk", () => {
    mountPane("d.files", []); // file list never renders hunk wrappers
    const view = mountPane("d.view", [0, 1]);
    render(<Harness count={2} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.files" });
    press("F7");
    expect(view.get(0)).toHaveBeenCalledOnce();
    press("F7");
    expect(view.get(1)).toHaveBeenCalledOnce();
    expect(view.get(0)).toHaveBeenCalledOnce();
  });

  it("resets the cursor when the viewed file changes", () => {
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    press("F7");
    expect(cursor).toBe(1);
    rerender(<Harness count={3} resetKey="b" onCursor={onCursor} />);
    expect(cursor).toBe(-1);
  });

  // ── Opening a diff AT its first change (issue 188, part 1) ──────────────

  it("opens at the first change and marks it, once the caller says it is ready", () => {
    const scrollToHunk = vi.fn();
    render(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready
        scrollToHunk={scrollToHunk}
      />,
    );
    expect(scrollToHunk).toHaveBeenCalledWith(0);
    // The cursor and the scroll position must agree: 0, not -1.
    expect(cursor).toBe(0);
    // ...so F7 now moves to the SECOND change, Rider-style.
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(cursor).toBe(1);
  });

  it("does NOT auto-open while the surface is not ready (an unmeasured viewport)", () => {
    const scrollToHunk = vi.fn();
    const { rerender } = render(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready={false}
        scrollToHunk={scrollToHunk}
      />,
    );
    expect(scrollToHunk).not.toHaveBeenCalled();
    expect(cursor).toBe(-1);
    // ...and the first F7 still lands on the first change, as it always did.
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(cursor).toBe(0);
    // Measurement arriving later must not re-open a file the reader has moved in.
    rerender(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready
        scrollToHunk={scrollToHunk}
      />,
    );
    expect(scrollToHunk).toHaveBeenCalledTimes(1); // the F7, not an auto-open
  });

  it("auto-opens once per file, not once per row-model change", () => {
    const first = vi.fn();
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} ready scrollToHunk={first} />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    // A fresh callback identity is what a settled row model looks like from here
    // (heights changed) — it must not yank the reader back to the first change.
    const second = vi.fn();
    rerender(
      <Harness count={3} resetKey="a" onCursor={onCursor} ready scrollToHunk={second} />,
    );
    expect(second).not.toHaveBeenCalled();
    expect(cursor).toBe(0);
    // A different FILE does auto-open again.
    const third = vi.fn();
    rerender(
      <Harness count={2} resetKey="b" onCursor={onCursor} ready scrollToHunk={third} />,
    );
    expect(third).toHaveBeenCalledWith(0);
  });

  it("does not spend the open on a reveal that could not land", () => {
    // A pane that cannot be addressed yet — no scroll container, a row that is not
    // mounted — must leave the budget alone, or the cursor claims a position the
    // pane never took. This is how the file opened at line 1 with `cur: 0` on the
    // e2e webview.
    let landed = false;
    const scrollToHunk = vi.fn(() => landed);
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} ready scrollToHunk={scrollToHunk} />,
    );
    expect(scrollToHunk).toHaveBeenCalledWith(0);
    expect(cursor).toBe(-1); // it did NOT land, so nothing is claimed

    landed = true;
    // Any later qualifying render tries again — here a fresh callback identity,
    // which is what a settled row model looks like from the hook's side.
    rerender(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready
        scrollToHunk={vi.fn(() => true)}
      />,
    );
    expect(cursor).toBe(0);
  });

  it("re-opens after the pane goes away and comes back", () => {
    // A diff surface unmounts its scroll container to refetch, and a container that
    // returns has lost its scroll position — so the first change is the right place
    // to be again, and re-opening there is not a yank.
    const scrollToHunk = vi.fn(() => true);
    const props = (ready: boolean) => (
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready={ready}
        scrollToHunk={scrollToHunk}
      />
    );
    const { rerender } = render(props(true));
    expect(scrollToHunk).toHaveBeenCalledTimes(1);
    rerender(props(false)); // pane unmounts (its measurement reads 0)
    rerender(props(true)); // ...and is back
    expect(scrollToHunk).toHaveBeenCalledTimes(2);
    expect(cursor).toBe(0);
  });

  it("but a reader who has moved the cursor keeps it across that round trip", () => {
    const scrollToHunk = vi.fn(() => true);
    const props = (ready: boolean) => (
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        ready={ready}
        scrollToHunk={scrollToHunk}
      />
    );
    const { rerender } = render(props(true));
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(cursor).toBe(1);
    scrollToHunk.mockClear();
    rerender(props(false));
    rerender(props(true));
    expect(scrollToHunk).not.toHaveBeenCalled();
    expect(cursor).toBe(1);
  });

  it("does not scroll a file with no hunks at all (binary, LFS, identical)", () => {
    const scrollToHunk = vi.fn();
    render(
      <Harness count={0} resetKey="a" onCursor={onCursor} ready scrollToHunk={scrollToHunk} />,
    );
    expect(scrollToHunk).not.toHaveBeenCalled();
    expect(cursor).toBe(-1);
  });

  // ── F7 carries into the next file (issue 188, part 2) ────────────────────

  it("flashes a chord-named hint on the last hunk WITHOUT moving files", () => {
    const select = vi.fn();
    render(
      <FileHarness hunksPerFile={[2, 2]} onCursor={onCursor} onSelect={select} />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7"); // auto-opened at 0 → 1, the last hunk
    expect(cursor).toBe(1);
    expect(flashText()).toBeNull();

    expect(press("F7")).toBe(true);
    // The bug this replaces returned `true` and did NOTHING — so the assertions
    // that matter are that a hint appeared and that the file did NOT change.
    expect(flashText()).toBe("No more changes — press F7 again for the next file");
    expect(select).not.toHaveBeenCalled();
    expect(cursor).toBe(1);
  });

  it("the next press opens the next file AT ITS FIRST change", () => {
    const select = vi.fn();
    const scrollToHunk = vi.fn();
    const { getByTestId } = render(
      <FileHarness
        hunksPerFile={[2, 3]}
        onCursor={onCursor}
        onSelect={select}
        scrollToHunk={scrollToHunk}
      />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7"); // → hunk 1 (last)
    press("F7"); // arms + flashes
    scrollToHunk.mockClear();
    press("F7"); // crosses
    expect(select).toHaveBeenCalledWith(1);
    expect(getByTestId("file-index").textContent).toBe("1");
    expect(cursor).toBe(0);
    expect(scrollToHunk).toHaveBeenCalledWith(0);
  });

  it("forgets the arming once the hint has expired", () => {
    vi.useFakeTimers();
    try {
      const select = vi.fn();
      render(
        <FileHarness hunksPerFile={[2, 2]} onCursor={onCursor} onSelect={select} />,
      );
      useFocusStore.setState({ focused: "d.view" });
      press("F7"); // → last hunk
      press("F7"); // arms
      act(() => {
        vi.advanceTimersByTime(PG_FLASH_MS + 1);
      });
      press("F7"); // too late — re-arms rather than teleporting out of the file
      expect(select).not.toHaveBeenCalled();
      expect(flashText()).toBe(
        "No more changes — press F7 again for the next file",
      );
      // ...and the press after THAT one crosses, since it is inside the window.
      press("F7");
      expect(select).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⇧F7 crosses backwards and lands on the previous file's LAST change", () => {
    const select = vi.fn();
    const scrollToHunk = vi.fn();
    render(
      <FileHarness
        hunksPerFile={[4, 2]}
        startIndex={1}
        onCursor={onCursor}
        onSelect={select}
        scrollToHunk={scrollToHunk}
      />,
    );
    useFocusStore.setState({ focused: "d.view" });
    expect(cursor).toBe(0); // auto-opened at the first change
    expect(press("F7", true)).toBe(true);
    // "Shift+F7", not a hardcoded "⇧F7" or "F7": the label is formatted from the
    // live binding, and this test environment is not a Mac.
    expect(flashText()).toBe(
      "No more changes — press Shift+F7 again for the previous file",
    );
    expect(select).not.toHaveBeenCalled();
    scrollToHunk.mockClear();
    press("F7", true);
    expect(select).toHaveBeenCalledWith(0);
    // The previous file has 4 hunks and we arrived from below, so we land on the
    // LAST one — not on hunk 0, which is where the auto-open would put us.
    expect(cursor).toBe(3);
    expect(scrollToHunk).toHaveBeenCalledWith(3);
  });

  it("stops at each end of the list instead of cycling", () => {
    const select = vi.fn();
    render(
      <FileHarness hunksPerFile={[2]} onCursor={onCursor} onSelect={select} />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7"); // → last hunk of the only file
    expect(press("F7")).toBe(true);
    // One press says the list has ended — the reader is not made to ask twice
    // just to learn there is nothing there.
    expect(flashText()).toBe("Last file — no more changes");
    press("F7");
    expect(select).not.toHaveBeenCalled();

    press("F7", true); // back to hunk 0
    press("F7", true);
    expect(flashText()).toBe("First file — no earlier changes");
    press("F7", true);
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps the old clamp, and says nothing, when the caller supplies no file list", () => {
    render(
      <Harness
        count={2}
        resetKey="a"
        onCursor={onCursor}
        ready
        scrollToHunk={() => {}}
      />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(cursor).toBe(1);
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(1);
    expect(flashText()).toBeNull();
  });

  it("reuses ONE toast element however many times it is flashed", () => {
    render(<FileHarness hunksPerFile={[1]} onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    press("F7");
    press("F7");
    expect(flashCount()).toBe(1);
  });

  it("registers one handler per action, not one per pane", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    const handlers = useKeymapStore.getState().handlers;
    expect(handlers.get("diff.nextChange")?.length).toBe(1);
    expect(handlers.get("diff.prevChange")?.length).toBe(1);
  });
});
