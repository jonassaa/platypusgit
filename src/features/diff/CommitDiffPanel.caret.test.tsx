// The line caret in the commit-diff panel (#297).
//
// This panel is the one diff surface with its own row markup — the other three
// render through `PGDiffRow`, which has drawn the focus ring since #61 D7. So
// the ring here is a second implementation of the same two CSS lines, and the
// source-level guard in `test/diffCaretSurfaces.test.ts` can only prove the
// attribute is written somewhere in the file. This proves it reaches the DOM,
// lands on the right row, and does not change the row's height — which the
// window's variable-height arithmetic depends on (`outline`, never `border`).
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { resetInvokeMock } from "@/test/invokeMock";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

const diffs: FileDiff[] = [
  {
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -1,3 +1,3 @@",
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx line" },
          { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "removed line" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "added line" },
        ],
      },
    ],
  },
];

const pressF7 = (shift = false) =>
  act(() => {
    useKeymapStore.getState().dispatch({
      key: "F7",
      code: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: shift,
      preventDefault() {},
      target: document.body,
    } as unknown as KeyboardEvent);
  });

beforeEach(() => {
  resetInvokeMock();
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

async function renderPanel(paneIdPrefix: string) {
  const r = render(
    <CommitDiffPanel
      diffs={diffs}
      loading={false}
      error={null}
      header="x → y"
      paneIdPrefix={paneIdPrefix}
    />,
  );
  await waitFor(() =>
    expect(r.container.querySelectorAll("[data-hunk-index]").length).toBe(1),
  );
  useFocusStore.setState({ focused: `${paneIdPrefix}.view` });
  return r;
}

describe("CommitDiffPanel caret", () => {
  it("paints no ring before the reader has asked for one", async () => {
    const { container } = await renderPanel("caret1");
    expect(container.querySelector("[data-focused]")).toBeNull();
  });

  it("F7 puts the caret on the hunk's first CHANGED row", async () => {
    const { container } = await renderPanel("caret2");
    pressF7();
    const focused = container.querySelector("[data-focused]");
    // Not the context line above it: the caret's index space is changed lines
    // only, and the anchor F7 addresses this hunk by is its first changed row.
    expect(focused?.textContent).toContain("removed line");
    expect(focused?.textContent).not.toContain("ctx line");
  });

  it("rings exactly one row", async () => {
    const { container } = await renderPanel("caret3");
    pressF7();
    expect(container.querySelectorAll("[data-focused]").length).toBe(1);
  });

  it("rings with an inset outline, so the row's height is unchanged", async () => {
    const { container } = await renderPanel("caret4");
    pressF7();
    const focused = container.querySelector<HTMLElement>("[data-focused]");
    // A border or extra padding here would grow the row past the window's pitch
    // and put the variable-height arithmetic out of step with what is rendered —
    // the same reason `PGDiffRow` draws its ring this way.
    expect(focused!.style.outline).toContain("var(--accent)");
    expect(focused!.style.outlineOffset).toBe("-1px");
    expect(focused!.style.borderLeftWidth || "").not.toBe("1px");
  });
});
