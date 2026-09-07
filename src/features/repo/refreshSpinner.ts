// Does the titlebar's Refresh button spin?
//
// The obvious wiring — `loading={useRepoStore(s => s.loading)}` — is wrong, and
// `elapsed.ts` already explains why: `loading` flips on every tab switch, every
// commit and after every network op, and almost always settles inside 100 ms.
// Bound straight to the button it would twitch all day and mean nothing.
//
// The inverse is wrong too. `useDelayedFlag(loading, 400)` never strobes, but a
// click on Refresh in a warm repository would then produce no feedback at all,
// which is the whole reason the button wants an animation.
//
// So the two cases are told apart by WHO asked:
//
//   - The user asked (button, `Mod+Alt+Y`, the palette) → spin immediately, and
//     keep spinning for `MIN_SPIN_MS` even when the work is already done. A
//     60 ms quarter-turn reads as a glitch; the floor is what turns it into an
//     acknowledgement.
//   - Something else asked (a commit finishing, a tab switch) → spin only once
//     it has run past `SHOW_AFTER_MS`, the same flicker floor the status-bar
//     indicator uses. A refresh nobody asked for is worth showing exactly when
//     it is slow enough to be in the way — a `/mnt/c` repository under WSL
//     (#274) spends nine seconds here.
//
// The two overlap on purpose: `MIN_SPIN_MS` outlasts `SHOW_AFTER_MS`, so a slow
// user-invoked refresh hands off from the hold to the delayed flag without a
// gap in the middle.

import React from "react";

import { SHOW_AFTER_MS, useDelayedFlag } from "./elapsed";
import { useRepoStore } from "./useRepoStore";

/**
 * How long the button spins for a refresh the user asked for, however fast the
 * backend actually was.
 */
export const MIN_SPIN_MS = 450;

// A plain counter rather than a field on `useRepoStore`: this is not repository
// state. It is per-window, transient, and it must survive `emptySlice()` on a
// tab switch — a slice field would be reset out from under a spin in progress.
let requests = 0;
const listeners = new Set<() => void>();

/**
 * Record that the USER asked for the refresh that is about to start.
 *
 * Called by `refreshOp()`, which is the single entry point the button, the
 * keymap action and the palette command all share — so a fourth way to ask for
 * a refresh gets the spinner by going through `refreshOp` too, and not by
 * calling this.
 */
export function markRefreshRequested(): void {
  requests += 1;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const read = () => requests;

/**
 * Test seam: forget the requests made by earlier cases. Leaves `listeners`
 * alone — dropping a live subscriber's callback would wedge it, and the test
 * renderer unmounts between cases anyway.
 */
export function resetRefreshRequests(): void {
  requests = 0;
}

/** Whether the Refresh button should be showing its spinner right now. */
export function useRefreshSpinner(): boolean {
  const loading = useRepoStore((s) => s.loading);
  const slow = useDelayedFlag(loading, SHOW_AFTER_MS);

  const seen = React.useSyncExternalStore(subscribe, read, read);
  const [held, setHeld] = React.useState(false);

  // The count at mount is the baseline, so mounting mid-session does not read
  // every earlier refresh as one the user just asked for. It is deliberately
  // never updated: after the first request the ref only exists to make that
  // first comparison false, and the effect re-runs on each later increment.
  const baseline = React.useRef(seen);

  React.useEffect(() => {
    if (seen === baseline.current) return;
    setHeld(true);
    const id = window.setTimeout(() => setHeld(false), MIN_SPIN_MS);
    return () => window.clearTimeout(id);
  }, [seen]);

  return held || slow;
}
