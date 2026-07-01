/** Per-item usage record. */
export interface FrecencyEntry {
  count: number;
  /** Epoch ms of the most recent use. */
  lastUsed: number;
}

export type FrecencyMap = Record<string, FrecencyEntry>;

const KEY = "pg-palette-frecency";
const CAP = 200;
const HALF_LIFE_MS = 3 * 24 * 3600 * 1000; // 3 days
/** Scales frecency into the fuzzy-score range so it nudges, not dominates. */
const BOOST = 5;

export function loadFrecency(): FrecencyMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FrecencyMap) : {};
  } catch {
    return {};
  }
}

function save(map: FrecencyMap, now: number): void {
  const ids = Object.keys(map);
  if (ids.length > CAP) {
    // Evict lowest-scoring entries down to CAP.
    const ranked = ids.sort(
      (a, b) => frecencyScore(map, b, now) - frecencyScore(map, a, now),
    );
    for (const id of ranked.slice(CAP)) delete map[id];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — frecency is best-effort */
  }
}

export function bumpFrecency(id: string, now: number): void {
  const map = loadFrecency();
  const prev = map[id];
  map[id] = { count: (prev?.count ?? 0) + 1, lastUsed: now };
  save(map, now);
}

export function frecencyScore(
  map: FrecencyMap,
  id: string,
  now: number,
): number {
  const e = map[id];
  if (!e) return 0;
  const recency = Math.pow(0.5, (now - e.lastUsed) / HALF_LIFE_MS);
  return e.count * recency * BOOST;
}

export function recentIds(map: FrecencyMap, limit: number): string[] {
  return Object.keys(map)
    .sort((a, b) => map[b].lastUsed - map[a].lastUsed)
    .slice(0, limit);
}
