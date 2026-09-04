// Opens (or focuses) the single merge resolver window. The window fetches its
// own data over IPC; the only cross-window state is events.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { useRepoStore } from "@/features/repo/useRepoStore";

/**
 * Which repository a live resolver window is working on, as far as THIS webview
 * knows. `attributed` is false when a live window was not opened by this page
 * instance and has not announced itself either, which callers must treat as
 * "it might be any repository".
 *
 * Two producers set it. This module, when it opens or retargets the window —
 * and the resolver itself, over `merge://holding`. The second exists because
 * since #256 there can be several repository windows: the resolver may have
 * been opened by a window that is not the one now closing a tab, and each
 * window opens its own `RepoId`, so "some resolver is up" stopped being a good
 * enough reason to confirm. The announcement is what lets a window that did not
 * open it still compare ids.
 */
let liveMerge: { repoId: string; attributed: boolean } | null = null;

// Never unsubscribed — its lifetime is the window's, like the appearance watch.
// Guarded so a hot reload does not stack listeners.
let holdingWatch: Promise<() => void> | null = null;

/**
 * Start listening for the resolver's "I am on this repository" announcement.
 *
 * Idempotent, and mounted from `AppShell` rather than started lazily: the
 * announcement is emitted when the resolver opens, and the window that needs to
 * have heard it is whichever one later closes a tab. A listener registered at
 * that moment would already have missed it.
 */
export function watchMergeHolding(): void {
  if (holdingWatch) return;
  holdingWatch = listen<{ repoId: string }>("merge://holding", (e) => {
    if (e.payload?.repoId) liveMerge = { repoId: e.payload.repoId, attributed: true };
  });
}

/** Test-only: forget which repository a live resolver is on, the state a fresh
 *  page load starts from. Same shape as `__resetDialogs`. */
export function __resetMergeAttribution(): void {
  liveMerge = null;
  holdingWatch = null;
}

/**
 * True when a resolver window is live and might be resolving `repoId`.
 *
 * Used before evicting a repository backend-side (#90): the resolver is a
 * separate window driving IPC with that `RepoId`, so closing its repository
 * underneath would make its next call fail with `UnknownRepo` mid-resolution. An
 * unattributed window counts as a match on purpose — one extra confirmation is
 * far cheaper than breaking a conflict resolution in progress.
 */
export async function mergeWindowHoldsRepo(repoId: string): Promise<boolean> {
  watchMergeHolding();
  const existing = await WebviewWindow.getByLabel("merge");
  if (!existing) {
    liveMerge = null;
    return false;
  }
  if (!liveMerge || !liveMerge.attributed) return true;
  return liveMerge.repoId === repoId;
}

/**
 * Close the resolver window and resolve once it is really gone, so the caller
 * can safely evict the repository it was using.
 *
 * Deliberately bypasses the window's own unapplied-progress confirm: the caller
 * has already asked in the main window, which is where the user's attention is.
 */
export async function closeMergeWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("merge");
  if (!existing) {
    liveMerge = null;
    return;
  }
  await existing.close().catch(() => {
    // Already gone, or refused — the poll below is the real answer either way.
  });
  // `close()` resolves when the request is delivered, not when the window is
  // destroyed. Evicting before then is exactly the race this function exists to
  // avoid, so wait for the label to disappear (bounded: a stuck window must not
  // hang the tab close forever).
  for (let i = 0; i < 40; i++) {
    if (!(await WebviewWindow.getByLabel("merge"))) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  liveMerge = null;
}

/**
 * `path` is optional: the operation bar, the status-bar count and the
 * `conflict.openResolver` chord all open the resolver on the repository rather
 * than on one file (#108), and the window then picks the first unresolved file
 * from its own list. A path is passed only when the user named a file.
 */
export async function openMergeWindow(repoId: string, path?: string): Promise<void> {
  const existing = await WebviewWindow.getByLabel("merge");
  if (existing) {
    // A null path retargets the window to the repository without stealing the
    // file the user is in the middle of — see MergeWindow's listener.
    await emit("merge://open-file", { repoId, path: path ?? null });
    await existing.setFocus();
    // A retarget changes which repository the window is on, so re-attribute it.
    liveMerge = { repoId, attributed: true };
    return;
  }
  liveMerge = { repoId, attributed: true };
  const params = new URLSearchParams({ window: "merge", repoId });
  if (path) params.set("path", path);
  const win = new WebviewWindow("merge", {
    url: `/?${params.toString()}`,
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 500,
    title: path ? `Resolve: ${path}` : "Resolve conflicts",
    // Same reason the main window carries it in tauri.conf.json: without it
    // both the window and webview layers default to white, and opening the
    // resolver flashes a white rectangle before the dark UI arrives. Kept as
    // the literal `--bg-0` of the default dark theme; `startupPaint.test.ts`
    // fails the build if this and the main window's value drift apart.
    //
    // Left VISIBLE, unlike the main window: this one opens in response to a
    // click, where a window that appears instantly (correctly coloured, then
    // filled) beats one that appears a beat after the click that asked for it.
    backgroundColor: "#0d1013",
  });
  // Any exit path (Apply-through-last-file, Esc, OS close button) must leave
  // the main window showing disk truth — but only for the repository this
  // resolver was opened for. With multiple repositories open in tabs (#90) an
  // unguarded refresh here would re-read whichever repo happens to be active by
  // the time the window closes.
  void win.once("tauri://destroyed", () => {
    if (liveMerge?.repoId === repoId) liveMerge = null;
    if (useRepoStore.getState().current?.id !== repoId) return;
    void useRepoStore.getState().refreshAll();
  });
  void win.once("tauri://error", (e) => {
    console.error("merge window failed to open", e);
  });
}
