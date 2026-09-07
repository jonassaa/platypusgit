// The status bar's "something is running" line (#296).
//
// One component rather than markup inlined in `AppStatusBar`, because it is the
// only place in the STATUS BAR that answers all four of the questions a waiting
// user has — what is running, how far along, how long it has been, and can I
// stop it. Those answers must not drift apart across surfaces, and since #431
// there are two surfaces: the history view carries a strip of its own. So the
// answers themselves are decided once, in `activityView.ts`, and this file is
// only the status bar's layout of them.
//
// Its own file also keeps the 1 Hz elapsed-time re-render inside a leaf: the
// whole status bar would otherwise re-render every second while any op is live.

import { PGStatusItem } from "@/design";
import { ELAPSED_AFTER_MS, useActivityView } from "./activityView";
import { formatElapsed, useElapsed } from "./elapsed";
import type { ActivityState } from "./repoActivity";

// Where the threshold lives moved to `activityView.ts` when the strip started
// sharing it; it is still importable from here, which is where every caller
// looked for it first.
export { ELAPSED_AFTER_MS };

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
  const view = useActivityView();
  if (!view) return null;

  // More than one op at a time stopped being hypothetical once LFS, submodule
  // and forge checkouts joined `activity` (#296). Naming the count beats
  // silently hiding the others behind whichever one sorts first.
  const { state, others, cancellable, cancelRequested, cancel } = view;

  return (
    <>
      <PGStatusItem
        icon="sync"
        tone="accent"
        // `state` is already the state to render, not the state the store
        // holds: the "Cancelling…" override lives in `useActivityView` so the
        // history strip cannot disagree with this line about it.
        label={<ActivityLine state={state} />}
      />
      {others > 0 && (
        <PGStatusItem
          label={`+${others} more`}
        />
      )}
      {cancellable && (
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
          onClick={cancel}
        />
      )}
    </>
  );
}
