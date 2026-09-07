// "Something is running" where the user is actually looking (#431).
//
// The status bar has reported running operations since #296, and it reports
// them well — but it reports them at the very bottom edge of the window, and
// what a user watches while a checkout or a rebase runs is the commit list.
// A four-second checkout therefore looked like a click that did nothing: the
// list sat there showing the branch that had just been left, and the only
// contradiction was a small line as far from the pointer as the window allows.
//
// So this is the same information, pinned directly above the rows it is warning
// you about. It is deliberately NOT a second opinion: `useActivityView` decides
// what is said and this file only lays it out — see `activityView.ts`.

import { PGButton, PGProgressBar, PGSpinner } from "@/design";

import { useActivityView, ELAPSED_AFTER_MS } from "./activityView";
import { formatElapsed, useDelayedFlag, useElapsed } from "./elapsed";

/**
 * How long an operation must run before the strip appears at all.
 *
 * The flicker floor, and it is load-bearing here in a way it is not in the
 * status bar: the strip sits IN the layout, so every operation it reports
 * shoves the commit list down and back up again. Most operations finish inside
 * a tenth of a second — a checkout of a branch that differs by three files, the
 * refresh that follows every commit — and reporting those would turn ordinary
 * use into a twitching list for no information at all.
 *
 * Matches `LoadingStatus`'s floor on purpose: both answer "is this taking
 * longer than I expected", and two different thresholds would mean the two
 * indicators appeared at different moments during the same slow refresh.
 */
export const SHOW_AFTER_MS = 400;

/**
 * The elapsed clock, in its own leaf.
 *
 * `useElapsed` re-renders once a second for the life of the operation, and the
 * strip contains a progress bar with a CSS animation — keeping the tick down
 * here means the second hand does not re-render the bar with it.
 */
function ElapsedReadout({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsed(startedAt);
  if (elapsed === null || elapsed < ELAPSED_AFTER_MS) return null;
  return (
    <span
      data-testid="activity-strip-elapsed"
      style={{ color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}
    >
      {formatElapsed(elapsed)}
    </span>
  );
}

export function ActivityStrip() {
  const view = useActivityView();
  const shown = useDelayedFlag(view !== null, SHOW_AFTER_MS);
  if (!view || !shown) return null;

  const { state, others, cancellable, cancelRequested, cancel } = view;
  const determinate = state.percent !== undefined;

  return (
    <div
      data-testid="activity-strip"
      // `polite`, and the whole strip rather than the label alone: a screen
      // reader user gets the same "still working" that the bar draws, without
      // it interrupting whatever they are reading in the list.
      role="status"
      aria-live="polite"
      style={{
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        fontSize: "var(--fs-11)",
        color: "var(--fg-1)",
        // The list below is windowed and measures its own viewport, so it
        // reflows around this on its own — but it must never be the thing that
        // shrinks, or a slow operation would eat the rows being read.
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          padding: "5px 12px 6px",
        }}
      >
        <PGSpinner size={12} style={{ color: "var(--accent)", flex: "0 0 auto" }} />
        <span
          data-testid="activity-strip-label"
          style={{
            // The labels carry branch and remote names, which are arbitrarily
            // long; the strip is one line and truncates rather than wrapping,
            // because a two-line strip moves the list twice.
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={state.label}
        >
          {state.label}
        </span>
        {determinate && (
          <span
            data-testid="activity-strip-percent"
            style={{ color: "var(--fg-2)", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}
          >
            {state.percent}%
          </span>
        )}
        <ElapsedReadout startedAt={state.startedAt} />
        {others > 0 && (
          <span
            data-testid="activity-strip-others"
            style={{ color: "var(--fg-3)", flex: "0 0 auto" }}
          >
            +{others} more
          </span>
        )}
        <span style={{ flex: 1 }} />
        {cancellable && (
          /*
            The way out of a stalled fetch, and the reason the strip carries one
            at all: travelling to the bottom of the window to stop the thing
            being complained about here is the trip this feature exists to
            remove. Two labels and never disabled, exactly as in the status bar
            — the first click SIGTERMs so git can clean up its own lock files,
            the second SIGKILLs, and a git that ignores SIGTERM is escapable
            only by clicking again (#263).

            Its own test hook, NOT the status bar's: `cancel.e2e.ts` waits on
            `activity-label` and clicks `activity-cancel`, WebdriverIO's `$`
            takes the first match in document order, and this renders above the
            status bar. Sharing the hooks would silently re-point a passing spec
            at a surface with a 400 ms delay in front of it.
          */
          <PGButton
            data-testid="activity-strip-cancel"
            variant="ghost"
            size="xs"
            tone="danger"
            icon="x"
            onClick={cancel}
            style={{ flex: "0 0 auto" }}
          >
            {cancelRequested ? "Force stop" : "Cancel"}
          </PGButton>
        )}
      </div>
      <div
        data-testid="activity-strip-bar"
        // Full-bleed, and the strip has no border of its own: the bar's track
        // IS the edge between the strip and the list. A 2 px bar inset inside a
        // bordered box put three horizontal lines within four pixels of each
        // other, and the moving one read as a stray tick rather than progress.
        data-percent={determinate ? state.percent : undefined}
        // Indeterminate is the common case, not the fallback: only fetch, pull
        // and push run with `--progress`, so a checkout, a rebase replay and a
        // stash have no number to report and must not imply one.
        data-indeterminate={determinate ? undefined : "true"}
      >
        <PGProgressBar
          height={3}
          indeterminate={!determinate}
          value={state.percent ?? 0}
        />
      </div>
    </div>
  );
}
