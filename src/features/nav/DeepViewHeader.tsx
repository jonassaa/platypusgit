import React from "react";
import { PGIconButton } from "@/design";
import { useNavStore } from "./useNavStore";

// Friendly labels for the origin crumb. Deep views themselves never appear
// here (they're not persisted / not valid origins).
const SCREEN_LABELS: Record<string, string> = {
  repo: "Files",
  commit: "Commit",
  history: "History",
  branches: "Branches",
  conflict: "Conflicts",
  rebase: "Rebase",
  remote: "Remotes",
  diff: "Diff viewer",
  reflog: "Reflog",
  settings: "Settings",
};

/**
 * Back + breadcrumb bar for the dead-end deep views (CommitDiff, FileHistory,
 * Blame): they have no activity-bar entry, so without this there's no way back
 * to where you came from. "Back" returns to `deepOrigin` (set by AppShell when
 * it routed here), falling back to History.
 */
export function DeepViewHeader({ crumbs }: { crumbs: React.ReactNode[] }) {
  const setIntent = useNavStore((s) => s.setIntent);
  const origin = useNavStore((s) => s.deepOrigin) ?? "history";
  const originLabel = SCREEN_LABELS[origin] ?? "Back";
  const back = () => setIntent({ kind: "switch-screen", screen: origin });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border-0)",
        background: "var(--bg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        flexShrink: 0,
      }}
    >
      <PGIconButton
        icon="chevronLeft"
        size="sm"
        title={`Back to ${originLabel}`}
        onClick={back}
      />
      <button
        onClick={back}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg-2)",
          cursor: "pointer",
          font: "inherit",
          padding: "0 2px",
        }}
      >
        {originLabel}
      </button>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          <span style={{ color: "var(--fg-3)" }}>›</span>
          <span
            style={{
              color: i === crumbs.length - 1 ? "var(--fg-0)" : "var(--fg-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
