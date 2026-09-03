// The status bar's "something is running" line (#296).
//
// One component rather than markup inlined in `AppStatusBar`, because it is the
// only place in the app that answers all four of the questions a waiting user
// has — what is running, how far along, how long it has been, and can I stop it
// — and those answers should not drift apart across surfaces.
//
// Its own file also keeps the 1 Hz elapsed-time re-render inside a leaf: the
// whole status bar would otherwise re-render every second while any op is live.

import { PGStatusItem } from "@/design";
import { formatElapsed, useElapsed } from "./elapsed";
import {
  activityCount,
  isCancellable,
  primaryActivity,
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

/** The determinate bar, shown only once git has reported a real percentage. */
function ProgressBar({ percent }: { percent: number }) {
  return (
    <span
      data-testid="activity-bar"
      data-percent={percent}
      aria-hidden
      style={{
        display: "inline-block",
        width: 52,
        height: 4,
        marginLeft: 2,
        background: "var(--bg-2)",
        borderRadius: 2,
        overflow: "hidden",
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          // Clamped: a malformed tick must not paint outside the track.
          width: `${Math.max(0, Math.min(100, percent))}%`,
          background: "var(--accent)",
        }}
      />
    </span>
  );
}

function ActivityLine({ state }: { state: ActivityState }) {
  const elapsed = useElapsed(state.startedAt);
  const showElapsed = elapsed !== null && elapsed >= ELAPSED_AFTER_MS;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span data-testid="activity-label">{state.label}</span>
      {state.percent !== undefined && (
        <>
          <ProgressBar percent={state.percent} />
          <span data-testid="activity-percent">{state.percent}%</span>
        </>
      )}
      {showElapsed && (
        <span data-testid="activity-elapsed" style={{ color: "var(--fg-3)" }}>
          {formatElapsed(elapsed)}
        </span>
      )}
    </span>
  );
}

export function ActivityStatus() {
  const activity = useRepoStore((s) => s.activity);
  const cancelRequested = useRepoStore((s) => s.cancelRequested);
  const primary = primaryActivity(activity);
  if (!primary) return null;

  // More than one op at a time stopped being hypothetical once LFS, submodule
  // and forge checkouts joined `activity` (#296). Naming the count beats
  // silently hiding the others behind whichever one sorts first.
  const others = activityCount(activity) - 1;

  return (
    <>
      <PGStatusItem
        icon="sync"
        tone="accent"
        label={
          <ActivityLine
            state={
              // Once Cancel has been clicked the transfer is being torn down,
              // so the label says that and the bar goes (#263). A percentage
              // still climbing after the click is the clearest possible way to
              // tell the user their click did nothing — which is what makes
              // them click again, and the second click is SIGKILL.
              cancelRequested
                ? { ...primary.state, label: "Cancelling…", percent: undefined }
                : primary.state
            }
          />
        }
      />
      {others > 0 && (
        <PGStatusItem
          label={`+${others} more`}
        />
      )}
      {isCancellable(primary.key) && (
        /*
          The way out of a stalled fetch, pull or push (#234), and the only one
          the toolbar's spinning buttons do not offer. It sits beside the label
          that says what is stuck, because that label is what a user stares at
          while deciding the app has hung.

          Its own item rather than an onClick on the label: a status line that
          silently kills the operation when clicked is a trap, and there is
          nowhere on a bare label to say "Cancel".

          Gated on the op actually being cancellable (#296): it now also covers
          LFS, submodule and forge ops — which were cancellable in the backend
          all along and simply had no button — while a rebase replay, which
          cannot be interrupted, does not get one it could not honour.

          Two labels, because there are two signals (#263). The first click
          SIGTERMs, which is what lets git remove its own lock files; a second
          escalates to SIGKILL, which does not. So the first click MUST visibly
          change something — otherwise the honest reading of a status line that
          still says "Fetching…" next to a button that still says "Cancel" is
          "nothing happened", and the user double-clicks their way to the
          stranded-lock-file bug the SIGTERM was added to avoid. Never
          disabled, either: a git that ignores SIGTERM is escapable only by
          clicking again.
        */
        <PGStatusItem
          testId="activity-cancel"
          icon="x"
          label={cancelRequested ? "Force stop" : "Cancel"}
          tone="danger"
          onClick={() => void useRepoStore.getState().cancelNetworkOps()}
        />
      )}
    </>
  );
}
