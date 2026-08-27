// The find bar's behaviour, driven through the shared hook.
//
// The claims worth pinning are the ones the windowing makes non-obvious:
//
//  - a match FAR outside the rendered window is found and counted;
//  - reaching it is a scrollTop write computed from the row heights, and NEVER a
//    `scrollIntoView` on a DOM node (which under windowing addresses whatever
//    happens to be mounted - the #68 G10 trap);
//  - the chord that opens it declines inside a text input, so the commit message
//    box and the file filter keep their own find key.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useDiffFind } from "./useDiffFind";
import { DiffFindBar } from "./DiffFindBar";
import { useFocusStore, useKeymapStore } from "@/features/keymap";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

const ROW_H = 19;
const VIEWPORT_H = 190; // ten rows

/** 300 context lines; `hit(i)` decides which of them carry the needle. */
function bigDiff(hit: (i: number) => string): FileDiff["hunks"] {
  const n = 300;
  return [
    {
      header: `@@ -1,${n} +1,${n} @@`,
      oldStart: 1,
      oldLines: n,
      newStart: 1,
      newLines: n,
      lines: Array.from({ length: n }, (_, i) => ({
        kind: { kind: "Context" as const },
        oldLineno: i + 1,
        newLineno: i + 1,
        content: `${hit(i)}\n`,
      })),
    },
  ];
}

const PANE = "test.diff";

let scrolls: number[] = [];
let intoView: ReturnType<typeof vi.fn>;
const realIntoView = Element.prototype.scrollIntoView;

function Harness({ hunks, enabled = true }: { hunks: FileDiff["hunks"]; enabled?: boolean }) {
  const rows = React.useMemo(
    () => flattenDiffRows(hunks, { foldH: 22, rowH: ROW_H }),
    [hunks],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // jsdom lays nothing out, so the scroll box has to be faked: a real viewport
  // height (or `scrollTopForRow` no-ops on `viewportH <= 0`) and a scrollTop that
  // actually stores what is written to it.
  const attach = React.useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el && !Object.getOwnPropertyDescriptor(el, "clientHeight")) {
      Object.defineProperty(el, "clientHeight", { value: VIEWPORT_H, configurable: true });
      Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
    }
  }, []);
  const find = useDiffFind({
    paneIds: PANE,
    rows,
    heights,
    scrollRef,
    scrollTo: (top) => {
      scrolls.push(top);
      if (scrollRef.current) scrollRef.current.scrollTop = top;
    },
    enabled,
  });
  return (
    <div>
      <div ref={attach} data-testid="scroller" />
      <DiffFindBar find={find} />
      <div data-testid="count">{find.matchCount}</div>
      <div data-testid="current">{find.current}</div>
      {/* A row's marks, by absolute index — proof the lookup reaches past the window. */}
      <div data-testid="marks-250">{JSON.stringify(find.marksFor(250) ?? null)}</div>
    </div>
  );
}

/** Dispatch a chord straight at the store, the way AppShell's listener does. */
function press(o: {
  key: string;
  code?: string;
  meta?: boolean;
  shift?: boolean;
  target?: EventTarget;
}): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch({
      key: o.key,
      code: o.code ?? "",
      metaKey: o.meta ?? false,
      ctrlKey: false,
      altKey: false,
      shiftKey: o.shift ?? false,
      preventDefault() {},
      target: o.target ?? document.body,
    } as unknown as KeyboardEvent);
  });
  return handled;
}

const findChord = (target?: EventTarget) =>
  press({ key: "f", code: "KeyF", meta: true, target });
const escape = () => press({ key: "Escape" });

const input = () => screen.getByTestId("diff-find-input") as HTMLInputElement;
const type = (q: string) => fireEvent.change(input(), { target: { value: q } });
const count = () => Number(screen.getByTestId("count").textContent);
const current = () => Number(screen.getByTestId("current").textContent);

beforeEach(() => {
  scrolls = [];
  intoView = vi.fn();
  // The DOM route this feature must never take: a spy here is what turns "we
  // scrolled by offset" from a claim into an assertion.
  Element.prototype.scrollIntoView = intoView as unknown as Element["scrollIntoView"];
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: PANE,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  } as never);
});

afterEach(() => {
  Element.prototype.scrollIntoView = realIntoView;
  useFocusStore.setState({ focused: null } as never);
});

describe("find in diff", () => {
  it("opens on the find chord while a diff pane holds focus", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} />);
    expect(screen.queryByTestId("diff-find-bar")).not.toBeInTheDocument();
    expect(findChord()).toBe(true);
    expect(screen.getByTestId("diff-find-bar")).toBeInTheDocument();
  });

  it("finds and counts a match far OUTSIDE the rendered window", () => {
    // Row 250 of 300. A window is a screenful — ten rows here — so this row is
    // nowhere in the document, which is exactly what the webview's own find
    // cannot see and this feature exists for.
    render(<Harness hunks={bigDiff((i) => (i === 250 ? "the needle" : `line ${i}`))} />);
    findChord();
    type("needle");
    expect(count()).toBe(1);
    expect(current()).toBe(0);
    // ...and the row is genuinely not mounted: nothing rendered its text.
    expect(screen.queryByText("the needle")).not.toBeInTheDocument();
    // ...while the model still hands that row its highlight.
    expect(screen.getByTestId("marks-250").textContent).toBe(
      JSON.stringify([{ start: 4, end: 10, active: true }]),
    );
  });

  it("reaches the match BY OFFSET, never by scrollIntoView", () => {
    render(<Harness hunks={bigDiff((i) => (i === 250 ? "the needle" : `line ${i}`))} />);
    findChord();
    type("needle");
    // `scrollTopForRow` reveal semantics: the row's BOTTOM edge flush with the
    // viewport's. 251 rows above it, minus the ten-row viewport.
    expect(scrolls.at(-1)).toBe(251 * ROW_H - VIEWPORT_H);
    expect(intoView).not.toHaveBeenCalled();
  });

  it("counts every match and steps next/previous with wrap-around", () => {
    render(<Harness hunks={bigDiff((i) => (i % 100 === 0 ? "needle" : `line ${i}`))} />);
    findChord();
    type("needle");
    expect(count()).toBe(3); // rows 0, 100, 200
    expect(current()).toBe(0);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(current()).toBe(1);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(current()).toBe(2);
    // Off the end, back to the first.
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(current()).toBe(0);
    // ...and off the start, back to the last.
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(current()).toBe(2);
  });

  it("matches case-insensitively until the toggle says otherwise", () => {
    render(
      <Harness hunks={bigDiff((i) => (i < 2 ? (i === 0 ? "Needle" : "needle") : `x${i}`))} />,
    );
    findChord();
    type("needle");
    expect(count()).toBe(2);
    fireEvent.click(screen.getByTestId("diff-find-case"));
    expect(count()).toBe(1);
    fireEvent.click(screen.getByTestId("diff-find-case"));
    expect(count()).toBe(2);
  });

  it("reports no results without pretending to have a cursor", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} />);
    findChord();
    type("nothing here");
    expect(count()).toBe(0);
    expect(current()).toBe(-1);
    expect(screen.getByTestId("diff-find-count").textContent).toBe("No results");
  });

  it("closes on Escape", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} />);
    findChord();
    expect(screen.getByTestId("diff-find-bar")).toBeInTheDocument();
    expect(escape()).toBe(true);
    expect(screen.queryByTestId("diff-find-bar")).not.toBeInTheDocument();
    // ...and once it is shut the chord falls through, so Escape still reaches
    // whatever overlay is behind it.
    expect(escape()).toBe(false);
  });

  it("does not open over a diff with nothing to search (binary, LFS)", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} enabled={false} />);
    expect(findChord()).toBe(false);
    expect(screen.queryByTestId("diff-find-bar")).not.toBeInTheDocument();
  });

  it("does not steal the find key from a text input", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} />);
    const box = document.createElement("input");
    document.body.appendChild(box);
    expect(findChord(box)).toBe(false);
    expect(screen.queryByTestId("diff-find-bar")).not.toBeInTheDocument();
    // ...including a TEXTAREA, which is what the commit message box is.
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    expect(findChord(area)).toBe(false);
    box.remove();
    area.remove();
  });

  it("is not offered while another pane holds focus", () => {
    render(<Harness hunks={bigDiff((i) => `line ${i}`)} />);
    act(() => {
      useFocusStore.setState({ focused: "somewhere.else" } as never);
    });
    expect(findChord()).toBe(false);
  });
});
