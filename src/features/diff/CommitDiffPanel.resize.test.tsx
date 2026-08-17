// The changed-files column is draggable, and each mount site remembers its own
// width (History's bottom panel is wide and short; the full-screen commit diff
// is not, so one shared width would fit neither).

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { stubContainerWidth } from "@/test/elementSize";
import { CommitDiffPanel } from "./CommitDiffPanel";

const props = {
  diffs: [],
  error: null,
  loading: false,
  header: "abc1234 → HEAD",
};

const filesPane = (container: HTMLElement, prefix: string) =>
  container.querySelector<HTMLElement>(`[data-pg-pane="${prefix}.files"]`)!;

/** Drag the files/diff splitter by `dx` px. */
const drag = (handle: HTMLElement, dx: number) => {
  fireEvent.mouseDown(handle, { clientX: 100 });
  fireEvent.mouseMove(document, { clientX: 100 + dx });
  fireEvent.mouseUp(document);
};

describe("CommitDiffPanel files column resize", () => {
  beforeEach(() => localStorage.clear());

  it("widens the changed-files column when the handle is dragged right", () => {
    const { container, getByTestId } = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );
    expect(filesPane(container, "history.diff").style.width).toBe("240px");

    drag(getByTestId("history.diff-files-resize"), 80);

    expect(filesPane(container, "history.diff").style.width).toBe("320px");
  });

  it("stops at the minimum width instead of collapsing the column", () => {
    const { container, getByTestId } = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );

    drag(getByTestId("history.diff-files-resize"), -400);

    expect(filesPane(container, "history.diff").style.width).toBe("140px");
  });

  it("caps the column relative to the measured panel, not at a fixed number", () => {
    // The column never shrinks (flexShrink: 0), so in the narrow side-by-side
    // History layout an unbounded drag would overflow the detail pane. The cap is
    // the panel's own width minus what the diff needs — no constant involved.
    const restore = stubContainerWidth(900);
    try {
      const { container, getByTestId } = render(
        <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
      );

      drag(getByTestId("history.diff-files-resize"), 1000);

      // 900 − 200 (the diff's floor) − 4 (the handle).
      expect(filesPane(container, "history.diff").style.width).toBe("696px");
    } finally {
      restore();
    }
  });

  it("leaves a stored width alone while the panel is unmeasured", () => {
    // The trap: with no measurement, `container - siblingMin` is negative, so a
    // clamp here would collapse the column AND persist the collapse.
    localStorage.setItem("pg-history-diff-files-w", "900");
    const { container } = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );

    expect(filesPane(container, "history.diff").style.width).toBe("900px");
    expect(localStorage.getItem("pg-history-diff-files-w")).toBe("900");
  });

  it("double-clicking the handle resets the column to its default", () => {
    const { container, getByTestId } = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );
    drag(getByTestId("history.diff-files-resize"), 120);
    expect(filesPane(container, "history.diff").style.width).toBe("360px");

    fireEvent.doubleClick(getByTestId("history.diff-files-resize"));

    expect(filesPane(container, "history.diff").style.width).toBe("240px");
  });

  it("restores the dragged width on remount, per mount site", () => {
    const first = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );
    drag(first.getByTestId("history.diff-files-resize"), 60);
    first.unmount();

    const again = render(
      <CommitDiffPanel {...props} paneIdPrefix="history.diff" />,
    );
    expect(filesPane(again.container, "history.diff").style.width).toBe("300px");
    again.unmount();

    const other = render(<CommitDiffPanel {...props} paneIdPrefix="commitDiff" />);
    expect(filesPane(other.container, "commitDiff").style.width).toBe("240px");
  });
});
