// Find in diff on the ONE surface with its own row markup (#241).
//
// The other three go through `PGDiffRow`, whose highlighting is pinned by
// `src/design/diffFindHighlight.test.tsx`. This panel renders its own spans, so
// the same two claims have to be made again here: the marks reach the DOM, and
// adding elements INSIDE the code cell did not break the selection split that
// `CommitDiffPanel.selection.test.tsx` guards.
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetInvokeMock } from "@/test/invokeMock";
import { selectionText } from "@/test/selectionText";
import { useFocusStore, useKeymapStore } from "@/features/keymap";
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
          { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx needle one" },
          { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "removed line" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "added needle two" },
        ],
      },
    ],
  },
];

const PREFIX = "find-panel";

const findChord = () => {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch({
      key: "f",
      code: "KeyF",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {},
      target: document.body,
    } as unknown as KeyboardEvent);
  });
  return handled;
};

beforeEach(async () => {
  resetInvokeMock();
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  } as never);
  render(
    <CommitDiffPanel
      diffs={diffs}
      loading={false}
      error={null}
      header="x to y"
      paneIdPrefix={PREFIX}
    />,
  );
  await waitFor(() =>
    expect(document.querySelectorAll("[data-hunk-index]").length).toBe(1),
  );
  act(() => {
    useFocusStore.setState({ focused: `${PREFIX}.view` } as never);
  });
  expect(findChord()).toBe(true);
  fireEvent.change(screen.getByTestId("diff-find-input"), {
    target: { value: "needle" },
  });
});

describe("CommitDiffPanel find", () => {
  it("marks every match and makes the current one distinct", () => {
    const hits = document.querySelectorAll('[data-testid="diff-find-match"]');
    expect([...hits].map((el) => el.textContent)).toEqual(["needle", "needle"]);
    expect(document.querySelectorAll("[data-find-active]")).toHaveLength(1);
    expect(screen.getByTestId("diff-find-count").textContent).toBe("1 of 2");
  });

  it("keeps the selection split — highlights live inside the code cell", () => {
    const container = document.body;
    expect(
      [...container.querySelectorAll(".pg-selectable")].map((el) => el.textContent),
    ).toEqual(["ctx needle one", "removed line", "added needle two"]);
    const copied = selectionText(container);
    expect(copied).toContain("ctx needle one");
    expect(copied).not.toContain("+added");
    expect(copied).not.toContain("-removed");
  });
});
