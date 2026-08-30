// "How long has this been going?" — shared by the two status-bar indicators
// (#296).
//
// Both the activity line (a fetch, a rebase) and the loading popover (the
// backend reads behind a refresh) answer the same question the same way, and a
// second copy of the formatting would drift.

import React from "react";

/** `42s`, `1m 20s`. Seconds resolution — this is a "should I worry?" readout. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/**
 * Milliseconds since `startedAt`, re-read once a second. Null when idle.
 *
 * The 1 Hz re-render is why every caller is a leaf component: subscribing to
 * this from a status bar that also renders branch, ahead/behind and file counts
 * would re-render all of it every second for the duration of an operation.
 */
export function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (startedAt === null) return;
    // Re-read immediately as well as on the interval: mounting mid-operation
    // (a tab switch back) would otherwise show a stale `now` for up to a second.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return null;
  return Math.max(0, now - startedAt);
}

/**
 * `active`, but only after it has been continuously true for `delayMs`.
 *
 * The flicker floor. A refresh is ten backend reads that usually finish inside
 * 100 ms, and it runs on every tab switch, every commit and after every network
 * op — an indicator with no delay would strobe in the corner of the screen all
 * day and say nothing. What is worth showing is the refresh that did NOT finish
 * quickly, which is exactly what survives the delay.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);
  return shown;
}
