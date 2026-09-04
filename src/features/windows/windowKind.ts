// Multiple windows (#256) — the pure half. Labels, per-window storage keys, and
// the `pg-windows` record. No IPC, no React, no `WebviewWindow`: everything here
// is a function of its arguments, which is what makes the awkward parts (an
// upgrading user's session, a corrupted record, a label nobody owns) testable
// without a second webview.
//
// `openAppWindow.ts` creates windows on top of this; `useWindowLifecycle.ts`
// restores and prunes them. The backend half is `src-tauri/src/windows.rs`,
// which owns the same label rules for the questions a webview cannot answer.

/** The window `tauri.conf.json` declares. Always the first one to exist. */
export const MAIN_LABEL = "main";
/** The conflict resolver — a window, but not a repository window. */
export const MERGE_LABEL = "merge";
/** Sibling windows: `pg-1`, `pg-2`, … Kept in step with `windows.rs`. */
export const REPO_WINDOW_PREFIX = "pg-";

/** Where the sibling-window list lives. */
export const WINDOWS_KEY = "pg-windows";

/** Emitted by the backend to a SURVIVING window when another one is destroyed.
 *  Kept in step with `WINDOW_CLOSED_EVENT` in `src-tauri/src/windows.rs`; the
 *  close-versus-quit rule it encodes is written up there. */
export const WINDOW_CLOSED_EVENT = "window://closed";
/** `main`'s open set, unchanged since #90 — see `openReposKey`. */
export const OPEN_REPOS_KEY = "pg-open-repos";

/** Bound on how many windows are restored at launch. Same spirit as tabs.ts's
 *  `OPEN_LIMIT`: a corrupted or runaway record must not make startup open
 *  windows until the machine gives up. */
export const WINDOW_LIMIT = 8;

export function isRepoWindowLabel(label: string): boolean {
  if (label === MAIN_LABEL) return true;
  if (!label.startsWith(REPO_WINDOW_PREFIX)) return false;
  return /^[0-9]+$/.test(label.slice(REPO_WINDOW_PREFIX.length));
}

/**
 * Where a window's open repository set is persisted.
 *
 * `main` keeps the bare `pg-open-repos` key it has written since #90, so an
 * upgrading user's session restores exactly as it did before windows existed —
 * a suffix for every window would have silently emptied everyone's tab strip
 * once on upgrade. Siblings, which no previous build could have written, are
 * namespaced.
 */
export function openReposKey(label: string): string {
  return label === MAIN_LABEL ? OPEN_REPOS_KEY : `${OPEN_REPOS_KEY}:${label}`;
}

/**
 * Where a sibling window is, in PHYSICAL pixels.
 *
 * Physical rather than logical because the point of remembering a window's
 * place is the multi-monitor case, and two monitors can have different scale
 * factors — a logical position is only meaningful next to the scale factor of
 * the screen it was read on, and a window moved between them would come back on
 * the wrong one.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One sibling window in the restore set. `main` is never in it: it is not
 *  restored, it is what does the restoring. */
export interface WindowRecord {
  label: string;
  bounds: WindowBounds | null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function readBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(r.x) ||
    !isFiniteNumber(r.y) ||
    !isFiniteNumber(r.width) ||
    !isFiniteNumber(r.height)
  ) {
    return null;
  }
  // A zero-area window is not a window. Treated as "no remembered bounds"
  // rather than dropped, so the record itself survives.
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * The sibling windows to bring back, tolerant of anything in the slot.
 *
 * Same contract as `loadOpenRepos`: junk reads as "nothing to restore" rather
 * than throwing, because the alternative is an app that will not start until
 * someone clears localStorage by hand. `main` is filtered out defensively — a
 * record naming it would make the primary window try to create itself.
 */
export function loadWindowRecords(storage: Storage = localStorage): WindowRecord[] {
  try {
    const raw = storage.getItem(WINDOWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: WindowRecord[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const label = (entry as Record<string, unknown>).label;
      if (typeof label !== "string") continue;
      if (label === MAIN_LABEL || !isRepoWindowLabel(label)) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, bounds: readBounds((entry as Record<string, unknown>).bounds) });
      if (out.length >= WINDOW_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveWindowRecords(
  records: WindowRecord[],
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(WINDOWS_KEY, JSON.stringify(records.slice(0, WINDOW_LIMIT)));
  } catch {
    // Quota errors are non-fatal — the extra windows just won't come back.
  }
}

/** Add `label` to the restore set, or update the bounds it already has. */
export function rememberWindow(
  label: string,
  bounds: WindowBounds | null,
  storage: Storage = localStorage,
): void {
  if (label === MAIN_LABEL || !isRepoWindowLabel(label)) return;
  const records = loadWindowRecords(storage);
  const i = records.findIndex((r) => r.label === label);
  if (i < 0) records.push({ label, bounds });
  // A null on an update means "no new measurement", not "forget where it was":
  // the record is written on creation before the window has any bounds to read.
  else records[i] = { label, bounds: bounds ?? records[i].bounds };
  saveWindowRecords(records, storage);
}

/**
 * Drop `label` from the restore set AND its open-repository set.
 *
 * Called when a window is closed while others survive — see the close-versus-
 * quit rule in `windows.rs`. Dropping the repository set too is what keeps
 * localStorage from accumulating one dead `pg-open-repos:pg-n` per window the
 * user ever opened.
 */
export function forgetWindow(label: string, storage: Storage = localStorage): void {
  if (label === MAIN_LABEL || !isRepoWindowLabel(label)) return;
  saveWindowRecords(
    loadWindowRecords(storage).filter((r) => r.label !== label),
    storage,
  );
  try {
    storage.removeItem(openReposKey(label));
  } catch {
    // Same as above: a storage that refuses writes just keeps a stale key.
  }
}

/**
 * Where a new window goes when it has no remembered place: down and right of
 * the window that opened it, so it is obviously a second window rather than one
 * hiding exactly behind the first.
 *
 * Clamped to a positive coordinate. A cascade off a window near the bottom-right
 * of a screen would otherwise walk a new window off it, and there is no
 * cross-platform way to ask "which screen, how big" that is worth the
 * complexity here — the OS will place a window with no position itself, which
 * is what `null` asks for.
 */
export const CASCADE_STEP = 32;

export function cascadeFrom(
  from: WindowBounds | null,
  step = CASCADE_STEP,
): WindowBounds | null {
  if (!from) return null;
  return {
    x: Math.max(0, from.x + step),
    y: Math.max(0, from.y + step),
    width: from.width,
    height: from.height,
  };
}
