// One row of the pull/merge request list (#92).
//
// Row geometry uses `calc(48px + var(--row-step))` so the Settings density
// toggle reaches it — a new list surface that hardcodes a height is exactly how
// density rotted the first time (issue #70).

import { PGBadge, PGIcon } from "@/design";
import type { ChecksSummary, ForgeKind, PullRequest } from "@/lib/types";
import { checksIcon, checksTone, prNumberLabel } from "./forgeLabels";

export interface PullRequestRowProps {
  pr: PullRequest;
  kind: ForgeKind;
  selected: boolean;
  checks?: ChecksSummary;
  onSelect: () => void;
  onActivate: () => void;
}

export function PullRequestRow({
  pr,
  kind,
  selected,
  checks,
  onSelect,
  onActivate,
}: PullRequestRowProps) {
  return (
    <div
      data-testid="pull-row"
      data-pr-number={pr.number}
      // usePaneList scrolls the selected row into view by finding
      // `[data-pg-row][data-selected]` — both attributes are required.
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      onClick={onSelect}
      onDoubleClick={onActivate}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        // Density: --row-step is 0 in compact, so the default layout is unchanged.
        height: "calc(48px + var(--row-step))",
        cursor: "pointer",
        borderBottom: "1px solid var(--border-0)",
        background: selected ? "var(--bg-selection)" : "transparent",
      }}
    >
      <PGIcon
        name="pullRequest"
        size={14}
        style={{ color: "var(--accent)", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--fs-13)",
            color: "var(--fg-0)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--fg-2)",
              flexShrink: 0,
            }}
          >
            {prNumberLabel(kind, pr.number)}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pr.title}
          </span>
          {pr.draft && <PGBadge tone="warn">draft</PGBadge>}
          {/* A fork request's branch will NOT be checked out under its own
              name — say so on the row, not only in the detail pane. */}
          {pr.crossRepo && <PGBadge tone="default">fork</PGBadge>}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pr.author} · {pr.sourceBranch} → {pr.targetBranch}
        </div>
      </div>
      {checks && (
        <span
          data-testid="pull-row-checks"
          title={`checks: ${checks.label}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)",
            color: checksTone(checks.state),
          }}
        >
          <PGIcon name={checksIcon(checks.state)} size={12} />
          {checks.label}
        </span>
      )}
    </div>
  );
}
