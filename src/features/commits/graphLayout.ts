import type { CommitInfo } from "@/lib/types";
import type { GraphLane, GraphNode } from "@/design";
import { createAncestryResolver } from "./graphAncestry";

export interface GraphRow {
  lanes: GraphLane[];
  node: GraphNode;
}

interface ActiveLane {
  awaitingOid: string;
  color: string;
  /**
   * The link this lane is currently traversing skipped commits. Carried on the
   * lane rather than emitted per row, so every row the lane crosses inherits
   * it, and it resets when the lane reaches its rewritten parent.
   */
  dashed: boolean;
}

const PALETTE = [
  "var(--graph-1)",
  "var(--graph-2)",
  "var(--graph-3)",
  "var(--graph-4)",
  "var(--graph-5)",
  "var(--graph-6)",
  "var(--graph-7)",
];

export interface LayoutOptions {
  /**
   * Ancestry pool for parent rewriting — every commit the store knows for this
   * log scope (`commits ∪ searchResults`). Omitted → the laid-out list is its
   * own ancestry, which is the unfiltered case.
   */
  ancestry?: readonly CommitInfo[];
  /**
   * HEAD's oid. Reserved for the primary-lane emphasis and HEAD marker in
   * Phase 3 (#68 G6/G7); declared now so this signature does not churn again.
   */
  headOid?: string;
}

export interface GraphLayout {
  rows: GraphRow[];
  /**
   * Highest lane or node column used by any row. 0 for a single-lane log.
   * Callers size the gutter from this — a fixed width silently clipped
   * everything past column 8 (#68 G1).
   */
  maxCol: number;
}

export function layoutGraph(
  commits: readonly CommitInfo[],
  opts?: LayoutOptions,
): GraphLayout {
  const active: Array<ActiveLane | null> = [];
  const rows: GraphRow[] = [];
  let laneBirthCounter = 0;
  let maxCol = 0;

  // Maps each commit's TRUE parents onto the nearest ancestor still in `commits`.
  // Without this, a lane awaiting a filtered-out parent never resolves and is
  // drawn to the bottom of the log (#68 G2).
  const ancestry = createAncestryResolver(commits, opts?.ancestry);

  const allocSlot = (): number => {
    const free = active.indexOf(null);
    if (free !== -1) return free;
    active.push(null);
    return active.length - 1;
  };

  const nextColor = (): string => {
    const color = PALETTE[laneBirthCounter % PALETTE.length]!;
    laneBirthCounter++;
    return color;
  };

  for (const commit of commits) {
    // Lane bookkeeping reads REWRITTEN parents; node shape reads TRUE parents.
    // A merge whose parents both rewrite onto one ancestor emits a single
    // deduped link but is still a merge.
    const resolved = ancestry.resolve(commit.oid);
    const trueParents = ancestry.trueParents(commit.oid);

    // 1. Find lanes awaiting this commit (collapse targets)
    const awaiting: number[] = [];
    for (let i = 0; i < active.length; i++) {
      if (active[i]?.awaitingOid === commit.oid) awaiting.push(i);
    }

    let nodeCol: number;
    let nodeColor: string;

    if (awaiting.length === 0) {
      // New root or branch tip visible at top of view
      nodeCol = allocSlot();
      nodeColor = nextColor();
    } else {
      // Leftmost wins; other awaiting lanes collapse into it
      nodeCol = awaiting[0]!;
      nodeColor = active[nodeCol]!.color;
    }

    // Snapshot the top-of-row state before mutating `active`. Carries `dashed`
    // so half-top / merge-top / pass-through lanes inherit the incoming link's
    // elision rather than the outgoing one's.
    const lanesAtTop: Array<{ col: number; color: string; dashed: boolean } | null> =
      active.map((a, i) => (a ? { col: i, color: a.color, dashed: a.dashed } : null));
    // Lanes that end at this row's node (collapsed secondary matches)
    const collapsingCols = awaiting.slice(1);

    // 2. First resolved parent continues in node's lane
    if (resolved.length >= 1) {
      active[nodeCol] = {
        awaitingOid: resolved[0]!.oid,
        color: nodeColor,
        dashed: resolved[0]!.elided,
      };
    } else {
      // No resolvable parent: a true root, or a truncated link. Either way the
      // lane ends here — which is what kills the phantom lanes.
      active[nodeCol] = null;
    }

    // Free collapsed slots
    for (const col of collapsingCols) active[col] = null;

    // 3. Place additional parents (merge commits)
    const forkTargets: Array<{ toCol: number; color: string; dashed: boolean }> = [];
    for (let p = 1; p < resolved.length; p++) {
      const link = resolved[p]!;
      const existing = active.findIndex((a) => a?.awaitingOid === link.oid);
      if (existing !== -1) {
        forkTargets.push({
          toCol: existing,
          color: active[existing]!.color,
          dashed: link.elided,
        });
      } else {
        const slot = allocSlot();
        const color = nextColor();
        active[slot] = { awaitingOid: link.oid, color, dashed: link.elided };
        forkTargets.push({ toCol: slot, color, dashed: link.elided });
      }
    }

    // 4. Emit lanes for this row
    const lanes: GraphLane[] = [];
    const width = Math.max(active.length, lanesAtTop.length);

    for (let col = 0; col < width; col++) {
      const top = lanesAtTop[col] ?? null;
      const bot = active[col] ?? null;

      if (col === nodeCol) {
        if (top)
          lanes.push({ col, color: top.color, kind: "half-top", dashed: top.dashed });
        if (bot)
          lanes.push({ col, color: bot.color, kind: "half-bot", dashed: bot.dashed });
        continue;
      }

      if (collapsingCols.includes(col) && top) {
        lanes.push({
          col,
          color: top.color,
          kind: "merge-top",
          to: nodeCol,
          dashed: top.dashed,
        });
        continue;
      }

      if (top && bot) {
        // Pass-through — lane continues straight down through this row
        lanes.push({ col, color: top.color, kind: "line", dashed: top.dashed });
        continue;
      }

      // Born at bottom-only (a fork target) is handled below via fork-bot
    }

    // Fork-bot curves from node → each additional-parent column
    for (const f of forkTargets) {
      if (f.toCol === nodeCol) continue;
      lanes.push({
        col: nodeCol,
        color: f.color,
        kind: "fork-bot",
        to: f.toCol,
        dashed: f.dashed,
      });
    }

    // Node shape reads TRUE parents — a merge stays a merge even when its
    // parents rewrote onto a single ancestor. `truncated` marks the case where
    // parents exist but none survive in the window, so the lane stops with a
    // stub rather than pretending this is a root.
    const isRoot = trueParents.length === 0;
    const node: GraphNode = {
      col: nodeCol,
      color: nodeColor,
      solid: trueParents.length <= 1,
      merge: trueParents.length >= 2,
      truncated: !isRoot && resolved.length === 0,
    };

    for (const ln of lanes) {
      if (ln.col > maxCol) maxCol = ln.col;
      if (ln.to !== undefined && ln.to > maxCol) maxCol = ln.to;
    }
    if (node.col > maxCol) maxCol = node.col;

    rows.push({ lanes, node });
  }

  return { rows, maxCol };
}
