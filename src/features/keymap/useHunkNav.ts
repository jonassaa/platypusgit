// useHunkNav — F7/⇧F7 diff-change navigation (Rider NextDiff/PreviousDiff).
// Keeps a hunk cursor for a diff screen, scoped to every pane the screen owns
// (file list AND diff view), so the chord works wherever focus sits.
//
// The screen renders the cursor as `data-hunk-active` on its `[data-hunk-index]`
// wrapper — since #157 that is the hunk's first CHANGED row, which is what "next
// change" actually means.
//
// Three behaviours live here rather than in the four screens that call it
// (`DiffViewer`, `CommitPanel`, `CommitDiffPanel`, `RepoBrowser`) — implementing
// any of them per screen is how F7 came to be missing from two of them for as
// long as both existed (issue 188, #157):
//
//  1. AUTO-OPEN. Whole file is the default view, so a diff otherwise opens on
//     line 1 of unchanged context. Once the caller says the row model is final
//     (`ready`), the first change is revealed and the cursor is set to it, so the
//     highlight and the scroll position can never disagree. `ready` must include a
//     MEASURED viewport: an unmeasured one reads 0 and must not count (read first,
//     observe second — WebKitGTK 605 has no ResizeObserver).
//  2. CARRY INTO THE NEXT FILE. On the last hunk, F7 flashes a hint naming its own
//     chord; a second press within the hint's lifetime opens the next file at its
//     FIRST change. ⇧F7 mirrors it — previous file, landing on its LAST change.
//     The armed state expires with the hint, so a press minutes later cannot
//     teleport the reader out of the file they are looking at. A caller that
//     supplies no `files` keeps the old clamp.
//  3. STOP AT THE ENDS. The last file's last hunk flashes and stays put; there is
//     no wrap-around. Silently re-showing a file already reviewed is worse.
//
// Scrolling goes through the caller's `scrollToHunk` when it supplies one, and it
// must: under windowing the anchor row is usually unmounted, so the DOM route
// below silently does nothing (the #68 G10 trap). That fallback survives for an
// unwindowed caller (the Diff screen's Wrap mode, where `heights` no longer
// describes the rendered rows) and this hook's own unit test.

import React from "react";
import { useAction } from "./useAction";
import { chordFor } from "./chordFor";
import { pgFlash, PG_FLASH_MS } from "@/design/ui-helpers";

/**
 * The caller's own file list, and the only thing that makes F7 cross files.
 *
 * The hook decides whether a crossing is legal (`index ± 1` inside the list) so
 * the "stop at the ends, never cycle" rule has one implementation instead of
 * four. `index < 0` means the shown file is not in the list, which is the same
 * answer as having no list: today's clamp.
 */
export interface HunkNavFiles {
  /** How many files the surface's list holds. */
  count: number;
  /** Index of the file currently shown, or -1 when it is not in the list. */
  index: number;
  /**
   * Show the file at `index`. MUST move the file-list selection, not just the
   * diff pane — otherwise the two panes disagree about which file is open.
   */
  select: (index: number) => void;
}

/** Which end of the next file's hunks to land on. */
type Landing = "first" | "last";

export function useHunkNav(opts: {
  /** Panes this diff screen owns — the handler answers from any of them. */
  paneIds: readonly string[];
  /** Hunk count of the currently viewed file. */
  count: number;
  /** Cursor resets when this changes (the viewed file). */
  resetKey: unknown;
  /**
   * Scroll a hunk into view BY OFFSET — build it from `hunkAnchorRows` +
   * `scrollTopForRow`. Windowed panes MUST supply this.
   *
   * Return `false` when the hunk could not be addressed — no scroll container, no
   * anchor row, or a write the container was too short to accept. The auto-open
   * reads that: a reveal that did not land must not be counted as this file having
   * been opened, or the pane keeps the cursor's promise without keeping its
   * position. Returning nothing means "assume it landed" — for a caller that has
   * no way to check. The DOM fallback below reports whether it found the row.
   */
  scrollToHunk?: (hunkIndex: number) => boolean | void;
  /**
   * Rows, heights and a MEASURED viewport are all in, and the row model for this
   * file is final — see `diffOpenReady`, which is where the four surfaces answer
   * it identically. Only then is the auto-open safe: whole-file mode renders fold
   * separators until the file text lands and fills them in, and scrolling to the
   * first change before that lands on a row that is about to move.
   *
   * "Measured" also means the scroll container is THERE — the surfaces unmount it
   * while the next diff is in flight, and a reveal into a pane that does not exist
   * is a silent no-op that still spends this open. `useViewportH` answers 0 in
   * that window, which is what `diffOpenReady` reads.
   */
  ready?: boolean;
  /** Supply to let F7 carry into the next file. Omit to keep the old clamp. */
  files?: HunkNavFiles;
}): number {
  const { paneIds, count, resetKey, scrollToHunk, ready = false, files } = opts;
  const [cursor, setCursor] = React.useState(-1);

  // Read by the key handlers, which run long after any render, so a ref keeps a
  // freshly-built `files` object from re-registering the actions every render.
  const filesRef = React.useRef(files);
  React.useEffect(() => {
    filesRef.current = files;
  });

  // Which end of the NEXT file to land on, and the request that sets it. Two refs
  // because a crossing sets its intent BEFORE the file changes: `pending` is
  // handed to `landing` by the very reset the crossing causes, so a file with no
  // hunks at all consumes it rather than passing it on to the file after that.
  const landing = React.useRef<Landing>("first");
  const pending = React.useRef<Landing | null>(null);
  /** Armed to cross, and when — the arming expires with the hint that announced it. */
  const armed = React.useRef<{ dir: 1 | -1; at: number } | null>(null);
  /** The auto-open has LANDED for this file, while the pane has stayed ready. */
  const opened = React.useRef(false);
  /** The reader has moved the cursor in this file — from here on it is theirs. */
  const readerActed = React.useRef(false);

  React.useEffect(() => {
    setCursor(-1);
    armed.current = null;
    opened.current = false;
    readerActed.current = false;
    landing.current = pending.current ?? "first";
    pending.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  /** Did the hunk actually get addressed? See `scrollToHunk`. */
  const reveal = (hunkIndex: number): boolean => {
    if (scrollToHunk) return scrollToHunk(hunkIndex) !== false;
    // Fallback for an unwindowed pane. Scroll the FIRST pane that actually
    // renders the target hunk: the file list has no `[data-hunk-index]` children
    // at all, and a screen with two diff panes wants the leading one.
    for (const paneId of paneIds) {
      const el = document.querySelector<HTMLElement>(
        `[data-pg-pane="${paneId}"] [data-hunk-index="${hunkIndex}"]`,
      );
      if (el) {
        el.scrollIntoView?.({ block: "start" });
        return true;
      }
    }
    return false;
  };

  // Open the file AT its first change (or its last, when ⇧F7 arrived here from
  // the file below).
  //
  // Two guards decide when this may run, and they are NOT the same guard:
  //
  // - `opened` is spent only by a reveal that LANDED, so a render where the pane
  //   cannot be addressed yet leaves the budget alone and the next qualifying
  //   render tries again. Spending it on a miss is how the second file came to
  //   open at line 1 with its cursor claiming otherwise.
  // - `ready` going false again RETURNS the budget. A diff surface unmounts its
  //   scroll container to refetch, and a container that comes back has lost its
  //   scroll position — so opening at the first change again is the correct answer
  //   there, not a yank: there is nothing left to preserve. `readerActed` is what
  //   keeps a reader's own cursor across the same round trip.
  //
  // Once it has landed, a later re-render — text arriving, a gap expanded, a
  // manual scroll — never moves the reader again.
  React.useEffect(() => {
    if (!ready) {
      // The pane cannot be addressed right now — most often because a diff surface
      // unmounted its scroll container to refetch. Return the budget: a container
      // that comes back has lost its scroll position, so the first change is the
      // right place to be again. The reader's own guard below is what keeps THEIR
      // cursor across the same round trip, so this needs no second check.
      opened.current = false;
      return;
    }
    if (count === 0 || opened.current || readerActed.current) return;
    const target = landing.current === "last" ? count - 1 : 0;
    if (!reveal(target)) return;
    landing.current = "first";
    opened.current = true;
    setCursor(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, count, resetKey, scrollToHunk]);

  const go = (delta: 1 | -1) => (): boolean => {
    if (count === 0) return false;
    // The reader has taken this file over, so nothing that settles LATER may
    // auto-open on top of them. (The crossing below re-arms it for the file it
    // moves to: the reset effect runs after this handler and clears the flag.)
    readerActed.current = true;
    const list = filesRef.current;
    // `cursor === 0` rather than `cursor <= 0`: an untouched cursor (-1) means the
    // auto-open did not run, and the first ⇧F7 must still land on hunk 0 there
    // rather than announce there is nothing above it.
    const atEdge = delta === 1 ? cursor >= count - 1 : cursor === 0;
    if (atEdge && list && list.index >= 0) {
      const to = list.index + delta;
      const crossable = to >= 0 && to < list.count;
      const now = Date.now();
      const isArmed =
        !!armed.current &&
        armed.current.dir === delta &&
        now - armed.current.at <= PG_FLASH_MS;
      if (isArmed && crossable) {
        armed.current = null;
        // Coming from below, land on the previous file's LAST change.
        pending.current = delta === 1 ? "first" : "last";
        list.select(to);
        return true;
      }
      if (!crossable) {
        // Nothing to arm for — say so on the FIRST press rather than making the
        // reader ask twice to learn the list has ended.
        armed.current = null;
        pgFlash(
          delta === 1
            ? "Last file — no more changes"
            : "First file — no earlier changes",
        );
        return true;
      }
      armed.current = { dir: delta, at: now };
      const chord = chordFor(delta === 1 ? "diff.nextChange" : "diff.prevChange");
      pgFlash(
        `No more changes — press ${chord} again for the ${
          delta === 1 ? "next" : "previous"
        } file`,
      );
      return true;
    }
    armed.current = null;
    const next = Math.max(0, Math.min(count - 1, cursor + delta));
    setCursor(next);
    reveal(next);
    return true;
  };

  // ONE registration per action, carrying the whole pane list as its scope —
  // NOT a useAction call per pane, which was a rules-of-hooks violation that
  // only held together while every caller passed a constant-length literal.
  useAction("diff.nextChange", go(1), [cursor, count, scrollToHunk], { paneId: paneIds });
  useAction("diff.prevChange", go(-1), [cursor, count, scrollToHunk], { paneId: paneIds });

  return cursor;
}
