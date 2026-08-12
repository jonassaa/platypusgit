// Reference-identity cache for laid-out graph rows (#68 G9).
//
// `layoutGraph` is memoized on `visible`, so a SEARCH keystroke rebuilds every
// row object even where the drawn geometry is identical. React.memo compares by
// reference, so without this each keystroke re-renders 500 SVGs.
//
// Selection changes don't need this — `rows` keeps its identity there — but
// search does, and search is the case the issue actually reported.
import type { CommitInfo } from "@/lib/types";
import type { GraphRow } from "./graphLayout";

/**
 * Compact geometry fingerprint. Anything that changes drawn pixels MUST appear
 * here, or a stale row survives a real change — add to this when GraphLane or
 * GraphNode grows a rendered field.
 */
function signature(row: GraphRow): string {
  const lanes = row.lanes
    .map(
      (l) =>
        `${l.col},${l.kind},${l.color},${l.to ?? ""},${l.dashed ? 1 : 0},${l.primary ? 1 : 0}`,
    )
    .join("|");
  const n = row.node;
  return `${lanes}#${n.col},${n.color},${n.solid ? 1 : 0},${n.merge ? 1 : 0},${n.truncated ? 1 : 0},${n.head ? 1 : 0}`;
}

export function createRowCache() {
  let prev = new Map<string, { sig: string; row: GraphRow }>();
  return {
    stabilize(commits: readonly CommitInfo[], rows: GraphRow[]): GraphRow[] {
      const next = new Map<string, { sig: string; row: GraphRow }>();
      const out = rows.map((row, i) => {
        const oid = commits[i]?.oid;
        if (oid === undefined) return row;
        const sig = signature(row);
        const hit = prev.get(oid);
        const kept = hit && hit.sig === sig ? hit.row : row;
        next.set(oid, { sig, row: kept });
        return kept;
      });
      // Rebuilt from THIS pass only, so oids that filtered out are dropped
      // rather than accumulating for the lifetime of the screen.
      prev = next;
      return out;
    },
    size: () => prev.size,
  };
}
