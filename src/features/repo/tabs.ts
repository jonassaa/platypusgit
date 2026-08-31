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

/**
 * The one spelling of a repository path on this side of the IPC boundary.
 *
 * `path` is a tab's identity, and the app receives paths from several producers
 * that do not agree on their spelling: `open_repo` returns the workdir with its
 * trailing separator stripped, a `pgit <path>` launch intent used to forward it
 * WITH one (#177), and a user-typed or dropped path can carry any number of
 * them. Compared raw, `/repo/` and `/repo` are two repositories — so the second
 * spelling opened the same repository again, minting a `RepoId` nothing would
 * ever close and leaving the store pointing at the losing one.
 *
 * Every path entering the tab layer goes through here, so no producer's
 * spelling can split one repository into two tabs. This is deliberately NOT
 * canonicalisation — a webview cannot resolve symlinks — the backend owns that
 * and `open`'s answer is what a tab is finally re-keyed onto.
 *
 * A path that is only separators is left alone: trimming `/` yields `""`, and
 * trimming a Windows drive root yields a drive-RELATIVE `C:`, so both would be
 * a different path rather than a tidier spelling of the same one.
 */
export function repoPathKey(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (!trimmed || trimmed.endsWith(":")) return path;
  return trimmed;
}

export function newTab(path: string, over: Partial<RepoTab> = {}): RepoTab {
  return {
    path: repoPathKey(path),
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
  const key = repoPathKey(path);
  return tabs.find((t) => t.path === key) ?? null;
}

export function indexOfTab(tabs: RepoTab[], path: string | null): number {
  if (!path) return -1;
  const key = repoPathKey(path);
  return tabs.findIndex((t) => t.path === key);
}

/**
 * Insert or update the tab for `patch.path`. Existing tabs keep their position:
 * re-opening a repository must not shuffle the strip under the user's cursor.
 */
export function upsertTab(tabs: RepoTab[], patch: RepoTab): RepoTab[] {
  const entry = { ...patch, path: repoPathKey(patch.path) };
  const i = indexOfTab(tabs, entry.path);
  if (i < 0) return [...tabs, entry];
  const next = [...tabs];
  next[i] = { ...next[i], ...entry };
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
  // A re-key (`open` answered with a different spelling) goes through the same
  // normalisation as any other incoming path.
  next[i] = {
    ...next[i],
    ...patch,
    ...(patch.path === undefined ? {} : { path: repoPathKey(patch.path) }),
  };
  return next;
}

export function removeTab(tabs: RepoTab[], path: string): RepoTab[] {
  const key = repoPathKey(path);
  return tabs.filter((t) => t.path !== key);
}

/**
 * Move the tab at `from` to index `to` (#238). Splice, not swap: a drag can
 * travel several tabs, and for the adjacent case the menu items and the chords
 * use, splice and swap are the same move.
 *
 * Returns the input array unchanged for a move that changes nothing, so the
 * store can skip a `persist()` it does not owe.
 */
export function moveTab(tabs: RepoTab[], from: number, to: number): RepoTab[] {
  if (from === to) return tabs;
  if (from < 0 || from >= tabs.length) return tabs;
  if (to < 0 || to >= tabs.length) return tabs;
  const next = [...tabs];
  const [tab] = next.splice(from, 1);
  next.splice(to, 0, tab);
  return next;
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
    // Normalize on the way in, and dedupe AFTER: a set written by an older
    // build (or by two producers disagreeing about the trailing separator) can
    // hold the same repository twice under two spellings, and restoring both
    // would open it twice — the very thing #177 was.
    const paths = Array.isArray(rec.paths)
      ? Array.from(
          new Set(
            rec.paths
              .filter((p): p is string => typeof p === "string" && !!p)
              .map(repoPathKey),
          ),
        ).slice(0, OPEN_LIMIT)
      : [];
    const activeKey = typeof rec.active === "string" ? repoPathKey(rec.active) : null;
    const active =
      activeKey && paths.includes(activeKey) ? activeKey : (paths[0] ?? null);
    return { paths, active };
  } catch {
    return { paths: [], active: null };
  }
}

export function saveOpenRepos(tabs: RepoTab[], active: string | null): void {
  try {
    const paths = tabs.map((t) => repoPathKey(t.path)).slice(0, OPEN_LIMIT);
    const activeKey = active ? repoPathKey(active) : null;
    const value: OpenRepos = {
      paths,
      active: activeKey && paths.includes(activeKey) ? activeKey : (paths[0] ?? null),
    };
    localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify(value));
  } catch {
    // quota errors are non-fatal — the session just won't restore
  }
}

export { OPEN_REPOS_KEY, OPEN_LIMIT };
