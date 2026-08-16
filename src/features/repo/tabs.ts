// Repository tabs — the pure half (#90). List reducers, labelling, and the
// `pg-open-repos` session file. No store, no IPC, no React: everything here is
// a function of its arguments, which is what makes the tab invariants
// (dedupe-by-path, neighbour selection on close, wrap-around cycling) testable
// without a webview.
//
// `useTabsStore` is the thin store on top; `RepoTabs` is the strip.

import type { RepoSlice } from "./repoSlice";

const OPEN_REPOS_KEY = "pg-open-repos";
/** Bound on the persisted open set. Generous — it exists so a corrupted or
 *  runaway value can't make startup pathological, not to police workflow. */
const OPEN_LIMIT = 20;

/**
 * One open repository.
 *
 * **`path` is the identity.** Two tabs never share one: opening a path that is
 * already open focuses its tab. That is what keeps persistence trivial (a list
 * of paths) and rules out duplicate tabs for one repository.
 */
export interface RepoTab {
  path: string;
  /** Backend `RepoId`. Null until this tab has actually been opened. */
  repoId: string | null;
  /**
   * `pending` — persisted or queued, not yet opened (session restore is lazy).
   * `open`    — live; `repoId` is set.
   * `failed`  — its open was attempted and rejected (moved, deleted, refused).
   */
  status: "pending" | "open" | "failed";
  /** Screen this tab was last on. Session-only — never persisted, so launch
   *  still always lands on History (see CLAUDE.md's navigation model). */
  screen: string;
  /** Frozen store slice. Meaningful only while this tab is INACTIVE; the active
   *  tab's live state lives in `useRepoStore`. */
  slice: RepoSlice | null;
  /** Badge counts, taken from the slice when the tab was left. */
  dirty: number;
  conflicts: number;
}

export function newTab(path: string, over: Partial<RepoTab> = {}): RepoTab {
  return {
    path,
    repoId: null,
    status: "pending",
    // Every tab starts on History, restored tabs included.
    screen: "history",
    slice: null,
    dirty: 0,
    conflicts: 0,
    ...over,
  };
}

export function findTab(tabs: RepoTab[], path: string | null): RepoTab | null {
  if (!path) return null;
  return tabs.find((t) => t.path === path) ?? null;
}

export function indexOfTab(tabs: RepoTab[], path: string | null): number {
  if (!path) return -1;
  return tabs.findIndex((t) => t.path === path);
}

/**
 * Insert or update the tab for `patch.path`. Existing tabs keep their position:
 * re-opening a repository must not shuffle the strip under the user's cursor.
 */
export function upsertTab(tabs: RepoTab[], patch: RepoTab): RepoTab[] {
  const i = indexOfTab(tabs, patch.path);
  if (i < 0) return [...tabs, patch];
  const next = [...tabs];
  next[i] = { ...next[i], ...patch };
  return next;
}

/** Apply `patch` to the tab at `path`, or return the list unchanged. */
export function patchTab(
  tabs: RepoTab[],
  path: string,
  patch: Partial<RepoTab>,
): RepoTab[] {
  const i = indexOfTab(tabs, path);
  if (i < 0) return tabs;
  const next = [...tabs];
  next[i] = { ...next[i], ...patch };
  return next;
}

export function removeTab(tabs: RepoTab[], path: string): RepoTab[] {
  return tabs.filter((t) => t.path !== path);
}

/**
 * Which tab becomes active when the one at `closedIndex` goes away: the tab to
 * its right, else the one to its left, else none. `remaining` is the list AFTER
 * the removal, so the right-hand neighbour has already slid into `closedIndex`.
 */
export function closeNeighbour(
  remaining: RepoTab[],
  closedIndex: number,
): RepoTab | null {
  if (remaining.length === 0) return null;
  return remaining[Math.min(closedIndex, remaining.length - 1)] ?? null;
}

/** Next/previous tab path, wrapping. Null when there is nothing to cycle. */
export function cycle(
  tabs: RepoTab[],
  activePath: string | null,
  delta: 1 | -1,
): string | null {
  if (tabs.length === 0) return null;
  const i = indexOfTab(tabs, activePath);
  if (i < 0) return tabs[0].path;
  const n = tabs.length;
  return tabs[(((i + delta) % n) + n) % n].path;
}

/** Last non-empty path segment, or the path itself. Separator-agnostic so a
 *  Windows path labels as well as a POSIX one. */
export function repoDisplayName(path: string): string {
  const segs = path.split(/[/\\]+/).filter(Boolean);
  return segs[segs.length - 1] ?? path;
}

/** The segment before the last one, or "" at the root. */
function parentSegment(path: string): string {
  const segs = path.split(/[/\\]+/).filter(Boolean);
  return segs.length >= 2 ? segs[segs.length - 2] : "";
}

/**
 * Tab labels, disambiguated. `api`, `web` and `docs` are everywhere, so a strip
 * of three tabs all reading `api` is useless — but prefixing EVERY tab with its
 * parent directory is noise. Only the names that actually collide get the
 * `parent/name` form.
 */
export function labelTabs(tabs: RepoTab[]): string[] {
  const names = tabs.map((t) => repoDisplayName(t.path));
  const seen = new Map<string, number>();
  for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
  return tabs.map((t, i) => {
    const name = names[i];
    if ((seen.get(name) ?? 0) < 2) return name;
    const parent = parentSegment(t.path);
    return parent ? `${parent}/${name}` : name;
  });
}

// ── persistence ────────────────────────────────────────────────────────────
//
// Recents (`pg-recent-repos`) and the open set are deliberately separate keys
// with separate meanings: recents are where you have BEEN, the open set is
// where you ARE. Opening a repository still pushes a recent, so the two stay
// consistent without one becoming the other.

export interface OpenRepos {
  paths: string[];
  active: string | null;
}

export function loadOpenRepos(): OpenRepos {
  try {
    const raw = localStorage.getItem(OPEN_REPOS_KEY);
    if (!raw) return { paths: [], active: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { paths: [], active: null };
    const rec = parsed as Record<string, unknown>;
    const paths = Array.isArray(rec.paths)
      ? Array.from(
          new Set(
            rec.paths.filter((p): p is string => typeof p === "string" && !!p),
          ),
        ).slice(0, OPEN_LIMIT)
      : [];
    const active =
      typeof rec.active === "string" && paths.includes(rec.active)
        ? rec.active
        : (paths[0] ?? null);
    return { paths, active };
  } catch {
    return { paths: [], active: null };
  }
}

export function saveOpenRepos(tabs: RepoTab[], active: string | null): void {
  try {
    const paths = tabs.map((t) => t.path).slice(0, OPEN_LIMIT);
    const value: OpenRepos = {
      paths,
      active: active && paths.includes(active) ? active : (paths[0] ?? null),
    };
    localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify(value));
  } catch {
    // quota errors are non-fatal — the session just won't restore
  }
}

export { OPEN_REPOS_KEY, OPEN_LIMIT };
