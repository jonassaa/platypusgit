// "Loading: fetching remotes + 5 others", and what the 5 others are (#296 gap 8).
//
// A refresh is ten backend reads behind one `Promise.all`. The status bar used
// to describe all of them as "syncing…", which is exactly no help on the setups
// where a refresh is slow enough to notice — a `/mnt/c` repository under WSL
// (#274) spends its nine seconds in one or two of the ten, and nothing said
// which. Collapsed, this names the one running longest; expanded, it lists them
// all with their own clocks, so the answer is readable rather than inferred.
//
// Modelled on Rider's background-task indicator: a quiet line in the corner
// that opens upward into the detail, and is absent entirely when there is
// nothing slow to report.

import React from "react";

import { PGIcon, PGStatusItem } from "@/design";
import { formatElapsed, useDelayedFlag, useElapsed } from "./elapsed";
import { byAge, loadingSummary, type LoadingTask } from "./loadingTasks";
import { useRepoStore } from "./useRepoStore";

/**
 * How long a refresh must run before it is worth mentioning.
 *
 * The flicker floor, and the reason this is tolerable in a status bar at all: a
 * refresh runs on every tab switch, every commit and after every network op,
 * and almost always finishes inside 100 ms. Without the delay the corner of the
 * screen would strobe all day. What survives the delay is the refresh that did
 * not finish quickly — the only one anybody wants to read about.
 */
export const SHOW_AFTER_MS = 400;

/** One row of the expanded panel: what it is, and how long it has been. */
function TaskRow({ task }: { task: LoadingTask }) {
  const elapsed = useElapsed(task.startedAt);
  return (
    <div
      data-testid="loading-task"
      data-task-id={task.id}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "var(--fg-1)" }}>{task.label}</span>
      <span
        style={{
          color: "var(--fg-3)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
        }}
      >
        {formatElapsed(elapsed ?? 0)}
      </span>
    </div>
  );
}

export function LoadingStatus() {
  const tasks = useRepoStore((s) => s.loadingTasks);
  const loading = useRepoStore((s) => s.loading);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // `loading` as well as the task list: opening a repository sets the flag
  // before there is a repository to attribute reads to, so it has no named
  // tasks and would otherwise report nothing at all.
  const active = tasks.length > 0 || loading;
  const visible = useDelayedFlag(active, SHOW_AFTER_MS);

  // Collapse when the thing being described stops existing. Without this the
  // panel would reappear already-open on the next slow refresh, over a
  // completely different set of reads.
  React.useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // `mousedown`, not `click`: a click that starts outside and ends inside
    // should still close, and this fires before the toggle's own handler.
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!visible) return null;

  // No named tasks means there is nothing to expand INTO — say what is happening
  // and leave it at that rather than offering an affordance that opens an empty
  // box.
  const summary = loadingSummary(tasks) ?? "Loading…";
  const expandable = tasks.length > 0;

  return (
    <div
      ref={containerRef}
      data-testid="loading-status"
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      {open && (
        <div
          data-testid="loading-panel"
          role="group"
          aria-label="Loading"
          style={{
            position: "absolute",
            // Upward: the status bar is the last row on screen, so there is
            // nowhere below it to put this.
            bottom: "100%",
            left: 0,
            marginBottom: 6,
            minWidth: 240,
            padding: "5px 0",
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: 4,
            boxShadow: "0 6px 20px oklch(0 0 0 / 0.35)",
            fontSize: "var(--fs-12)",
            // Above screen content (1–5), deliberately BELOW the pickers and
            // modals (100): a branch picker or a dialog opening over this must
            // cover it, not sit behind a status popover the user has forgotten
            // is open. The shell root's `overflow: hidden` does not clip it —
            // the panel expands up into the content area, not out of the window.
            zIndex: 40,
          }}
        >
          {byAge(tasks).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
      {/*
        The wrapper owns every interaction, and `PGStatusItem` stays purely
        visual, so there is ONE focusable thing with the right role rather than
        a div-with-onClick that a keyboard cannot reach. The status bar has no
        other tab stop, so this costs nothing to tab past when it is absent —
        and it is absent almost always.
      */}
      <span
        {...(expandable
          ? {
              role: "button" as const,
              tabIndex: 0,
              "aria-expanded": open,
              "aria-label": summary,
              onClick: () => setOpen((o) => !o),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              },
              style: { cursor: "pointer", display: "inline-flex" },
            }
          : { style: { display: "inline-flex" } })}
      >
        <PGStatusItem
          icon="sync"
          label={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span data-testid="loading-summary">{summary}</span>
              {expandable && (
                <PGIcon name={open ? "chevronDown" : "chevronUp"} size={10} />
              )}
            </span>
          }
        />
      </span>
    </div>
  );
}
