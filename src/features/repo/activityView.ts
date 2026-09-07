/**
 * What the app tells a waiting user, decided once for every surface (#431).
 *
 * `ActivityStatus.tsx` opens by saying it is "the only place in the app that
 * answers all four of the questions a waiting user has — what is running, how
 * far along, how long it has been, and can I stop it — and those answers should
 * not drift apart across surfaces". That was a description of one component
 * until the history view grew a strip of its own; now it is a promise about
 * two, and this hook is how the promise is kept.
 *
 * Everything that is a DECISION lives here: which of several live operations
 * gets named, what its label reads once a cancellation has been asked for, and
 * whether Cancel can be honoured at all. Everything that is LAYOUT stays in the
 * surfaces — the status bar renders items with an inline 52 px bar, the strip
 * renders a line with a full-width one, and they are free to differ about that
 * because nobody is misinformed by it.
 *
 * `activityView.test.tsx` mounts both surfaces over one store and asserts they
 * say the same thing, so a future third surface cannot quietly disagree.
 */

import React from "react";

import {
  activityCount,
  isCancellable,
  primaryActivity,
  type ActivityKey,
  type ActivityState,
} from "./repoActivity";
import { useRepoStore } from "./useRepoStore";

/**
 * How long an operation must run before its elapsed time appears.
 *
 * Every fetch shows a number for a moment otherwise, which is noise: the reason
 * to show elapsed time at all is "this is taking longer than I expected", and
 * nothing under a few seconds is. It also keeps the 1 Hz re-render off the
 * common case, where the op is over before the first tick.
 */
export const ELAPSED_AFTER_MS = 3000;

/** The one live operation to report, already resolved to what should be said. */
export interface ActivityView {
  key: ActivityKey;
  /**
   * The state to RENDER — which is not always the state the store holds. Once
   * Cancel has been clicked the transfer is being torn down, so the label says
   * that and the percentage goes (#263): a bar still climbing after the click
   * is the clearest possible way to tell the user their click did nothing,
   * which is what makes them click again, and the second click is SIGKILL.
   */
  state: ActivityState;
  /** How many other operations are live and therefore going unnamed. */
  others: number;
  /** Whether `cancel` can actually reach this kind of operation. */
  cancellable: boolean;
  cancelRequested: boolean;
  cancel: () => void;
}

/** The operation every activity surface should be reporting, or null when idle. */
export function useActivityView(): ActivityView | null {
  const activity = useRepoStore((s) => s.activity);
  const cancelRequested = useRepoStore((s) => s.cancelRequested);
  // Above the early return, or a surface that mounts while idle and then sees an
  // operation start renders a different number of hooks on its second pass.
  const cancel = React.useCallback(() => {
    void useRepoStore.getState().cancelNetworkOps();
  }, []);

  const primary = primaryActivity(activity);
  if (!primary) return null;

  return {
    key: primary.key,
    state: cancelRequested
      ? { ...primary.state, label: "Cancelling…", percent: undefined }
      : primary.state,
    others: activityCount(activity) - 1,
    cancellable: isCancellable(primary.key),
    cancelRequested,
    cancel,
  };
}
