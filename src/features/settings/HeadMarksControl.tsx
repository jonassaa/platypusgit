// The Settings control for the HEAD row treatment: a checkbox per mark, one
// weight knob, and a LIVE PREVIEW built from the real PGCommitRow.
//
// The preview is the point. The old single select ("Edge bar", "Bar +
// highlight", …) asked the user to imagine the result from a label; with six
// independent marks and three weights that would be hopeless. Rendering the
// actual row component means the preview cannot drift from History either.
import React from "react";

import {
  PGCheckbox,
  PGButtonGroup,
  PGCommitRow,
  graphWidth,
  type CommitRef,
  type GraphLane,
  type GraphNode,
} from "@/design";

import { useSettingsStore } from "./useSettingsStore";
import {
  HEAD_MARKS,
  HEAD_MARK_HINTS,
  HEAD_MARK_LABELS,
  HEAD_WEIGHTS,
  HEAD_WEIGHT_HINTS,
  HEAD_WEIGHT_LABELS,
  normalizeHeadMarks,
  resolveHeadDecor,
  type HeadMark,
  type HeadWeight,
} from "./headMarks";

const PREVIEW_GRAPH_W = graphWidth(1);

const LANE = (col: number, color: string): GraphLane => ({
  col,
  color,
  kind: "line",
});

const NODE = (col: number, color: string, head: boolean): GraphNode => ({
  col,
  color,
  solid: true,
  ...(head && { head: true }),
});

const MAIN: CommitRef[] = [{ name: "main", tone: "accent", icon: "branch" }];

/**
 * Two rows, because a mark is only legible against the rows it is NOT on. The
 * second row also carries a lane through the gutter so the graph ring's weight
 * has something to be compared against.
 */
function Preview({ marks, weight }: { marks: HeadMark[]; weight: HeadWeight }) {
  const decor = React.useMemo(() => resolveHeadDecor(marks, weight), [marks, weight]);
  const c = "var(--graph-1)";
  return (
    <div
      data-testid="head-marks-preview"
      style={{
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-2)",
        overflow: "hidden",
        background: "var(--bg-0)",
      }}
    >
      <PGCommitRow
        lanes={[LANE(0, c)]}
        node={NODE(0, c, true)}
        graphW={PREVIEW_GRAPH_W}
        sha="a1b2c3d"
        message="feat(history): the commit you are on"
        author="you"
        date="now"
        refs={MAIN}
        isHead
        headDecor={decor}
      />
      <PGCommitRow
        lanes={[LANE(0, c)]}
        node={NODE(0, c, false)}
        graphW={PREVIEW_GRAPH_W}
        sha="9f8e7d6"
        message="fix(diff): an ordinary earlier commit"
        author="someone"
        date="2h"
      />
    </div>
  );
}

/**
 * Marks are stored through `normalizeHeadMarks`, so the persisted array stays in
 * catalog order however the user clicks the boxes — a set, not a click log.
 */
export function HeadMarksControl() {
  const marks = useSettingsStore((s) => s.headMarks);
  const weight = useSettingsStore((s) => s.headWeight);
  const set = useSettingsStore((s) => s.set);

  const toggle = (m: HeadMark) => {
    const next = marks.includes(m) ? marks.filter((x) => x !== m) : [...marks, m];
    set("headMarks", normalizeHeadMarks(next) ?? marks);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 320 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: 12,
          rowGap: 6,
        }}
      >
        {HEAD_MARKS.map((m) => (
          <div key={m} title={HEAD_MARK_HINTS[m]}>
            <PGCheckbox
              checked={marks.includes(m)}
              onChange={() => toggle(m)}
              label={HEAD_MARK_LABELS[m]}
              testId={`head-mark-${m}`}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>Weight</span>
        <PGButtonGroup
          size="sm"
          value={weight}
          onChange={(v) => set("headWeight", v as HeadWeight)}
          options={HEAD_WEIGHTS.map((w) => ({
            value: w,
            label: HEAD_WEIGHT_LABELS[w],
          }))}
        />
      </div>
      <div
        data-testid="head-weight-hint"
        style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
      >
        {HEAD_WEIGHT_HINTS[weight]}
      </div>

      <Preview marks={marks} weight={weight} />
    </div>
  );
}
