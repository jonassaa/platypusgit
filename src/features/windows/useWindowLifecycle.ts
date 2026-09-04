// The window's own lifecycle (#256): bring the other windows back at launch,
// remember where this one is, and forget one the user closed.
//
// Mounted once from `AppShell`, so it runs in every repository window and in
// none of the resolver's. Each of the three jobs is scoped to the window that
// can actually do it — see the comments on each.

import React from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { listenToThisWindow } from "./windowEvents";

import { openAppWindow, currentBounds, releaseWindowLabel } from "./openAppWindow";
import {
  forgetWindow,
  loadWindowRecords,
  MAIN_LABEL,
  rememberWindow,
  WINDOW_CLOSED_EVENT,
} from "./windowKind";

/** How long a drag or a resize has to settle before the new bounds are written.
 *  A move emits an event per frame; writing localStorage per frame is the kind
 *  of thing that shows up as a stutter on a window being dragged. */
const BOUNDS_DEBOUNCE_MS = 400;

/** This window's label. Read once — it cannot change. */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    // jsdom, and any host where the Tauri window is not reachable. Behaving as
    // the primary window is the right default: it is what a single-window build
    // was.
    return MAIN_LABEL;
  }
}

/** The window that restores the others, takes the first-launch CLI intent, and
 *  is the one `tauri.conf.json` declares. */
export function isPrimaryWindow(): boolean {
  return windowLabel() === MAIN_LABEL;
}

/**
 * Recreate the sibling windows persisted at the last quit.
 *
 * Primary-only, and once per process: a sibling running this too would have
 * every window try to restore every other window. Sequential rather than
 * parallel because each creation asks the backend for the next free label, and
 * two overlapping asks get the same answer.
 */
export async function restoreWindows(): Promise<string[]> {
  const records = loadWindowRecords();
  const opened: string[] = [];
  for (const record of records) {
    const label = await openAppWindow({ restore: record });
    if (label) opened.push(label);
  }
  return opened;
}

let restored = false;

/** Test seam: the module-level "already restored" latch, reset between tests
 *  the same way `__resetMergeAttribution` resets the resolver's. */
export function __resetWindowRestore(): void {
  restored = false;
}

export function useWindowLifecycle(): void {
  // 1. Restore. Primary only, once.
  React.useEffect(() => {
    if (!isPrimaryWindow() || restored) return;
    restored = true;
    void restoreWindows();
  }, []);

  // 2. Forget a window the user closed.
  //
  // The backend picks ONE survivor to tell — whichever sorts first among the
  // live windows: `main` when it is up, a sibling when the user closed `main`
  // first — so the listener is scoped to this window rather than answering
  // every window's mail. A window destroyed with no survivor at all is the quit
  // case, and nothing is emitted, which is exactly how the session is kept for
  // the next launch.
  React.useEffect(() => {
    const unlisten = listenToThisWindow<string>(WINDOW_CLOSED_EVENT, (e) => {
      if (typeof e.payload !== "string") return;
      forgetWindow(e.payload);
      // The label is free again — a long session that opens and closes windows
      // should keep reusing `pg-1` rather than climbing.
      releaseWindowLabel(e.payload);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // 3. Remember where this window is. Siblings only: `main`'s geometry is the
  //    one `tauri.conf.json` gives it, and restoring that is a separate change
  //    with its own blast radius (see the spec).
  React.useEffect(() => {
    const label = windowLabel();
    if (label === MAIN_LABEL) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const write = () => {
      timer = null;
      void currentBounds().then((bounds) => {
        if (!cancelled && bounds) rememberWindow(label, bounds);
      });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, BOUNDS_DEBOUNCE_MS);
    };
    const subs = [listen("tauri://move", schedule), listen("tauri://resize", schedule)];
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const s of subs) void s.then((f) => f());
    };
  }, []);
}
