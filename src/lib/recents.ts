const KEY = "pg-recent-repos";
const LIMIT = 10;

export interface RecentRepo {
  path: string;
  /** unix ms */
  openedAt: number;
}

export function loadRecents(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentRepo =>
          r && typeof r.path === "string" && typeof r.openedAt === "number",
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function saveRecents(list: RecentRepo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // quota errors are non-fatal
  }
}

export function pushRecent(list: RecentRepo[], path: string): RecentRepo[] {
  const now = Date.now();
  const filtered = list.filter((r) => r.path !== path);
  return [{ path, openedAt: now }, ...filtered].slice(0, LIMIT);
}

export function removeRecent(list: RecentRepo[], path: string): RecentRepo[] {
  return list.filter((r) => r.path !== path);
}
