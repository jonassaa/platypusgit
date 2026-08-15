// What a diff surface shows INSTEAD of an LFS pointer's text (#93).
//
// One component for all four diff surfaces. The alternative — each pane deciding
// for itself — is how the same file comes to read differently depending on which
// pane you opened it in.

import { PGBadge, PGIcon } from "@/design";
import type { FileDiff } from "@/lib/types";
import { formatBytes } from "./useLfsStore";

/** "1.4 MB → 2.1 MB", or the one side that exists for an add/delete. */
export function lfsSizeSummary(diff: FileDiff): string {
  const old = diff.lfs?.old ?? null;
  const next = diff.lfs?.new ?? null;
  if (old && next) return `${formatBytes(old.size)} → ${formatBytes(next.size)}`;
  if (next) return `added · ${formatBytes(next.size)}`;
  if (old) return `removed · ${formatBytes(old.size)}`;
  return "—";
}

export function LfsDiffNotice({ diff }: { diff: FileDiff }) {
  if (!diff.lfs) return null;
  const old = diff.lfs.old;
  const next = diff.lfs.new;

  return (
    <div
      data-testid="lfs-diff-notice"
      style={{
        margin: 12,
        padding: 12,
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PGIcon name="lfs" size={14} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>
          Large file (git-LFS)
        </span>
        <PGBadge tone="accent">{lfsSizeSummary(diff)}</PGBadge>
      </div>
      <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
        {/* The point of the whole feature: what git tracks here is a three-line
            pointer, so showing its diff would claim two lines changed for a file
            of this size. */}
        Only the LFS pointer is stored in git, so there is no text diff to show.
        The object itself lives on the LFS server.
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {old && <span data-testid="lfs-old-oid">− {old.oid.slice(0, 12)}</span>}
        {next && <span data-testid="lfs-new-oid">+ {next.oid.slice(0, 12)}</span>}
      </div>
    </div>
  );
}
