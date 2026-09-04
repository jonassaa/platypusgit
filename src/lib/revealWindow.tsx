// Reveals the window once there is something worth looking at.
//
// The main window is created with `"visible": false` (src-tauri/tauri.conf.json)
// so that the several hundred milliseconds between process start and React's
// first commit are spent behind nothing at all, instead of behind an empty
// frame. This module is the other half of that trade: the window MUST be shown,
// or the app is a process with no UI.
//
// Why an effect and not a `requestAnimationFrame` after `createRoot().render()`:
// a hidden window may never get a frame callback at all. Compositors throttle
// or stop ticking for windows nobody can see (the same suspend policy Tauri's
// `backgroundThrottling` config exists to talk about), so a reveal that waits
// for a paint can wait forever — deadlocking on the very state it is trying to
// leave. A layout effect fires on commit, driven by the JS task queue, which
// runs regardless of visibility. The DOM and the render-blocking stylesheet are
// both in place by then, so the first frame the user actually sees is the
// finished UI.
//
// There is a backstop in Rust as well (`lib.rs`, the reveal fallback thread):
// if this code never runs — a throw at module scope, a bundle that fails to
// load — the window is shown anyway after a timeout. A visible broken window is
// a bug report; an invisible one is a ghost process.

import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Show the current window, whichever window this bundle is running in.
 *
 * Idempotent and non-throwing on purpose: it runs for the merge resolver too
 * (which is created already visible, making this a no-op), and a failure here
 * must not be able to take down the render that was about to become visible.
 */
export async function revealWindow(): Promise<void> {
  try {
    await getCurrentWindow().show();
  } catch (err) {
    // Nothing to fall back to from here — Rust's timeout owns that case.
    console.warn("failed to reveal the window", err);
  }
}

/**
 * Renders nothing; reveals the window on first commit.
 *
 * Mount it as a SIBLING of the error boundary rather than inside it. Inside, a
 * throw from the app would swap this component out for the boundary's fallback
 * and the effect would never run, leaving the "something went wrong" screen
 * inside a window nobody can see — the one case where being visible matters
 * most.
 */
export function RevealOnFirstPaint(): null {
  React.useLayoutEffect(() => {
    void revealWindow();
  }, []);
  return null;
}
