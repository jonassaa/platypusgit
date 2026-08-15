import type { CommitInfo } from "@/lib/types";

/**
 * Parent rewriting for the commit graph — the "same-branch search hits must
 * share one lane" fix (issue #68 G2).
 *
 * layoutGraph lays out the POST-filter list, and it keeps a lane alive until it
 * sees the oid that lane awaits. `CommitInfo.parents` holds the TRUE parent
 * oids, which a filter has usually removed, so the awaited oid never arrives:
 * the lane is drawn straight down through every remaining row to the bottom of
 * the log — an edge to a commit that will never appear — while the two commits
 * that genuinely ARE on the same branch get no visual link at all.
 *
 * This module maps each true parent onto the nearest ancestor that survived,
 * flagging the link as elided when it skipped anything. Callers draw elided
 * links dashed, and terminate the lane when nothing resolves.
 *
 * Deliberately frontend-only. Only text/author/path/date/sha filtering happens
 * in the backend; `hideMerges` is a client-side refinement over `baseCommits`,
 * so a backend rewrite would leave it still emitting phantom lanes. The
 * ancestry needed is already on the client —
 * useRepoStore holds the unfiltered `commits` next to `searchResults`. See the
 * spec's "Corrections to #68".
 */

export interface ResolvedParent {
  /** Oid of the nearest ancestor present in the laid-out list. */
  oid: string;
  /** True when reaching it skipped at least one commit. */
  elided: boolean;
}

export interface AncestryResolver {
  /**
   * Parent links for `oid`, rewritten onto the visible set and deduped.
   *
   * An empty result means no parent resolves. The caller distinguishes the two
   * reasons via `trueParents`: none at all is a real root; some, but none
   * reachable, is a truncated link whose lane must end.
   */
  resolve(oid: string): ResolvedParent[];
  /** True parent oids as loaded. Node shape (solid/merge) reads these. */
  trueParents(oid: string): string[];
}

export function createAncestryResolver(
  visibleCommits: readonly CommitInfo[],
  ancestry?: readonly CommitInfo[],
): AncestryResolver {
  const visible = new Set(visibleCommits.map((c) => c.oid));

  const parentsOf = new Map<string, string[]>();
  for (const c of ancestry ?? []) parentsOf.set(c.oid, c.parents);
  // The laid-out commits always contribute their own parents, so a hit that
  // reached deeper than the unfiltered window is still classified correctly.
  for (const c of visibleCommits) parentsOf.set(c.oid, c.parents);

  // Keyed by the queried oid. This is the load-bearing memo: a wide filter
  // leaves many visible commits pointing at the SAME filtered-out parent, and
  // without it each repeats the same walk. A single walk cannot blanket-memoize
  // the nodes it visits — an intermediate node's own nearest visible ancestor
  // need not be the one the outer query found.
  const nearestMemo = new Map<string, ResolvedParent | null>();
  const resolveMemo = new Map<string, ResolvedParent[]>();

  function nearestVisible(start: string): ResolvedParent | null {
    const cached = nearestMemo.get(start);
    if (cached !== undefined) return cached;

    if (visible.has(start)) {
      const direct: ResolvedParent = { oid: start, elided: false };
      nearestMemo.set(start, direct);
      return direct;
    }

    // Breadth-first over ancestors, so the nearest one wins. Parents are
    // enqueued in order, which at equal depth reaches the first-parent mainline
    // before a side branch. `seen` guards against malformed cyclic input.
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    let found: ResolvedParent | null = null;

    search: while (queue.length > 0) {
      const cur = queue.shift()!;
      const parents = parentsOf.get(cur);
      if (!parents) continue; // outside the loaded window — dead end
      for (const p of parents) {
        if (visible.has(p)) {
          found = { oid: p, elided: true };
          break search;
        }
        if (!seen.has(p)) {
          seen.add(p);
          queue.push(p);
        }
      }
    }

    nearestMemo.set(start, found);
    return found;
  }

  return {
    resolve(oid) {
      const cached = resolveMemo.get(oid);
      if (cached) return cached;

      const out: ResolvedParent[] = [];
      const targets = new Set<string>();
      for (const p of parentsOf.get(oid) ?? []) {
        const hit = nearestVisible(p);
        // Two true parents can rewrite onto one visible ancestor — collapse to
        // a single link. The node stays a merge; that reads trueParents.
        if (!hit || targets.has(hit.oid)) continue;
        targets.add(hit.oid);
        out.push(hit);
      }

      resolveMemo.set(oid, out);
      return out;
    },

    trueParents(oid) {
      return parentsOf.get(oid) ?? [];
    },
  };
}
