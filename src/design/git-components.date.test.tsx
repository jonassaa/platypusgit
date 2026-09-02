// The Date column, after #354.
//
// Two things have to hold at once, and they are the two that break silently:
//
//   * the hover text is on the DATE CELL, not the row — a title on the row
//     would fire anywhere along it, including over the message, and would
//     shadow the truncated-path titles the other columns use;
//   * the row's grid and History's column header agree on the column's width.
//     They share `commitRowGrid`, but only because BOTH read the width from
//     the same hook — that is what this file pins for the row half.
import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

import { PGCommitDetail, PGCommitRow } from "./git-components";
import { DATE_COL_W, commitRowGrid, graphWidth } from "./graph-geometry";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

const TITLE = "2026-08-14 13:42:07 +02:00 (3w ago)";

function renderRow(props?: { date?: string; dateTitle?: string }) {
  const { container } = render(
    <PGCommitRow
      graphW={graphWidth(0)}
      sha="abc1234"
      message="feat: something"
      author="Tester"
      date="3w ago"
      dateTitle={TITLE}
      {...props}
    />,
  );
  const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
  const cell = container.querySelector<HTMLElement>('[data-testid="commit-date"]')!;
  return { row, cell };
}

beforeEach(() => {
  useSettingsStore.getState().set("dateFormat", "relative");
});

describe("PGCommitRow date cell", () => {
  it("hangs the full timestamp off the date cell", () => {
    const { cell } = renderRow();
    expect(cell.textContent).toBe("3w ago");
    expect(cell.title).toBe(TITLE);
  });

  // The tooltip is the whole point of the default mode, so a caller that
  // forgets it must not leave a stale one behind — and must not render the
  // literal "undefined" that a `title={undefined}` cast would.
  it("carries no title when the caller passes none", () => {
    const { cell } = renderRow({ dateTitle: undefined });
    expect(cell.title).toBe("");
  });

  it("keeps the relative column width by default", () => {
    const { row } = renderRow();
    expect(row.style.gridTemplateColumns).toBe(
      commitRowGrid(graphWidth(0), DATE_COL_W.relative),
    );
    // The pre-#354 template, byte for byte: the default log is unchanged.
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(graphWidth(0)));
  });

  it("widens the column with the chosen format, live", () => {
    const { row } = renderRow();
    act(() => {
      useSettingsStore.getState().set("dateFormat", "both");
    });
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(graphWidth(0), DATE_COL_W.both));
  });

  // Reflog renders no lanes and drops the graph column entirely; the date
  // column still has to follow the format there.
  it("widens the column with no graph column at all", () => {
    useSettingsStore.getState().set("dateFormat", "absolute");
    const { container } = render(
      <PGCommitRow graphW={0} sha="abc1234" message="checkout" author="" date="2026-08-14 13:42" />,
    );
    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(0, DATE_COL_W.absolute));
  });
});

describe("PGCommitDetail date", () => {
  it("shows the date it is given and hangs the full timestamp off it", () => {
    const { container } = render(
      <PGCommitDetail
        sha="abc1234"
        subject="feat: something"
        author="Tester"
        date="2026-08-14 13:42:07 · 3w ago"
        dateTitle={TITLE}
      />,
    );
    const cell = container.querySelector<HTMLElement>('[data-testid="commit-detail-date"]')!;
    // Seconds inline — the panel has room and this is #354's "date on the
    // commit details" half.
    expect(cell.textContent).toContain("2026-08-14 13:42:07");
    expect(cell.textContent).toContain("3w ago");
    // The hover adds what the line leaves out: the zone.
    expect(cell.title).toBe(TITLE);
    expect(cell.title).toContain("+02:00");
    expect(cell.textContent).not.toContain("+02:00");
  });
});
