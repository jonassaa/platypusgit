// Lane colour selection for the commit graph (#68 G4).
//
// The old rule was `PALETTE[laneBirthCounter++ % 7]`, which failed twice: the
// 8th concurrent lane silently reused --graph-1 with no adjacency check, and
// colour depended on birth order WITHIN the laid-out list, so toggling a filter
// repainted the whole graph for the same history.
//
// New rule: hash first, LRU only as a collision-breaker.

/** 32-bit FNV-1a. Stable across runs — a lane's colour follows its identity. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const PALETTE: readonly string[] = [
  "var(--graph-1)",
  "var(--graph-2)",
  "var(--graph-3)",
  "var(--graph-4)",
  "var(--graph-5)",
  "var(--graph-6)",
  "var(--graph-7)",
];

export interface LaneColorer {
  /**
   * `colorKey` identifies the lane (see graphLayout: the oid the lane awaits at
   * birth). `activeColors` is what is on screen RIGHT NOW, so a collision is
   * only broken when it would actually be visible.
   */
  pick(colorKey: string, activeColors: ReadonlySet<string>): string;
}

export function createLaneColorer(
  palette: readonly string[] = PALETTE,
): LaneColorer {
  /** colour → tick it was last handed out. Absent = never used. */
  const lastUsed = new Map<string, number>();
  let tick = 0;

  const take = (color: string): string => {
    lastUsed.set(color, tick++);
    return color;
  };

  return {
    pick(colorKey, activeColors) {
      const preferred = palette[fnv1a(colorKey) % palette.length]!;
      if (!activeColors.has(preferred)) return take(preferred);

      // Collision. Prefer an entry nobody is using; among those, the one used
      // longest ago (never-used counts as longest, hence -1). Only when every
      // entry is genuinely active do we accept a repeat.
      const free = palette.filter((c) => !activeColors.has(c));
      const pool = free.length > 0 ? free : palette;
      let best = pool[0]!;
      for (const c of pool) {
        if ((lastUsed.get(c) ?? -1) < (lastUsed.get(best) ?? -1)) best = c;
      }
      return take(best);
    },
  };
}
