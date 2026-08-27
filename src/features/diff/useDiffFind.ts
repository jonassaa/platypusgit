// useDiffFind — the find bar's state, keys and scrolling, once for every diff
// surface that renders the flat row model.
//
// Three rules from `docs/dev/frontend.md` meet here, and all three are the reason
// this is a hook rather than four copies:
//
// 1. **Search the ROW MODEL, never the rendered window.** The surfaces are
//    windowed, so the webview's own find would search a screenful and report "no
//    results" for a match two thousand lines down. `lib/diffFind.ts` scans
//    `DiffRow[]`, which is the whole file. (Same reason `lib/diffCopy.ts` exists.)
// 2. **Scroll BY OFFSET, never `scrollIntoView`.** The row a match sits on is
//    almost always unmounted, so a `querySelector` finds nothing and the DOM route
//    silently does nothing — the #68 G10 trap. `scrollTopForRow` needs no DOM at
//    all, and the write goes through `useVariableWindow.scrollTo` so the rendered
//    range actually follows (issue 188).
// 3. **The find chord must not steal the key from an input that already wants it.**
//    That is `diff.find`'s `suppressInInput` in `features/keymap/actions.ts`, not
//    anything here: the dispatcher never resolves the action while focus sits in a
//    text field, so the commit-message box, the file filter and this bar's own
//    input all keep Mod+F.
import React from "react";
import { useAction } from "@/features/keymap";
import { scrollTopForRow } from "@/lib/diffRows";
import type { DiffRow } from "@/lib/diffRows";
import {
  findDiffMatches,
  findMarksByRow,
  firstMatchFrom,
  rowAtOffset,
  stepMatch,
  type FindMark,
} from "@/lib/diffFind";

export interface DiffFind {
  open: boolean;
  /**
   * Find is possible on what is showing (the `enabled` input).
   *
   * Exposed so a surface can HIDE its find affordance instead of offering a
   * button that quietly does nothing — a control that declines invisibly is worse
   * than no control.
   */
  available: boolean;
  query: string;
  caseSensitive: boolean;
  /** Number of matches in the whole row model — not in the window. */
  matchCount: number;
  /** True when the count is a floor (`MAX_FIND_MATCHES`). */
  truncated: boolean;
  /** 0-based index of the current match, `-1` when there is none. */
  current: number;
  setQuery: (q: string) => void;
  setCaseSensitive: (v: boolean) => void;
  next: () => void;
  prev: () => void;
  /** Open the bar and focus its input — the toolbar button's half of the chord. */
  openBar: () => void;
  close: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Marks for one ABSOLUTE row index — the prop `PGWindowedDiff` wants. */
  marksFor: (rowIndex: number) => readonly FindMark[] | undefined;
}

export function useDiffFind(o: {
  /** Panes the find chords answer from — the diff pane, or it and its file list. */
  paneIds: string | readonly string[];
  rows: DiffRow[];
  heights: number[];
  scrollRef: React.RefObject<HTMLElement | null>;
  /** `useVariableWindow`'s setter. A bare `scrollTop =` leaves the window behind. */
  scrollTo: (top: number) => void;
  /**
   * There is something searchable on screen. Gate this on `isTextualDiff` — a
   * binary or LFS diff renders a notice, not rows, and a find bar over it would
   * be a control that can never match anything.
   */
  enabled: boolean;
  /** The viewed file. The cursor restarts when it changes; the query survives. */
  resetKey?: unknown;
}): DiffFind {
  const { paneIds, rows, heights, scrollRef, scrollTo, enabled, resetKey } = o;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [current, setCurrent] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Closed, or nothing to search: no scan at all. `enabled` going false must also
  // drop the matches, or a binary file would keep the previous file's count.
  const { matches, truncated } = React.useMemo(
    () =>
      open && enabled
        ? findDiffMatches(rows, query, { caseSensitive })
        : { matches: [], truncated: false },
    [open, enabled, rows, query, caseSensitive],
  );

  /**
   * Put a row on screen BY OFFSET.
   *
   * `scrollTopForRow` REVEALS — the smallest move that brings the row into view,
   * and a no-op when it is already visible. That is the right semantics for a
   * find: stepping through neighbouring matches should scroll a line at a time,
   * exactly as the line cursor does, rather than yanking the pane on every Enter
   * the way `scrollTopForHunk`'s centring deliberately does for F7.
   */
  const revealRow = React.useCallback(
    (rowIndex: number) => {
      const el = scrollRef.current;
      if (!el) return;
      scrollTo(
        scrollTopForRow(heights, rowIndex, {
          scrollTop: el.scrollTop,
          viewportH: el.clientHeight,
        }),
      );
    },
    [heights, scrollRef, scrollTo],
  );

  /**
   * The reader's current row, from the scroll offset by prefix sum.
   *
   * From the model, not the DOM: the heights say exactly which row sits at the top
   * of the viewport, and the rows around it are the only ones a DOM query could
   * see anyway.
   */
  const readerRow = React.useCallback(
    () => rowAtOffset(heights, scrollRef.current?.scrollTop ?? 0),
    [heights, scrollRef],
  );

  // A new query (or a new file) restarts the cursor at the first match from where
  // the reader IS, so opening find deep in a file does not throw them back to the
  // top of it. `-1` when nothing matches — `stepMatch` reads that as "no cursor".
  const matchKey = matches.length === 0 ? "" : `${caseSensitive} ${query}`;
  React.useEffect(() => {
    setCurrent(matches.length === 0 ? -1 : firstMatchFrom(matches, readerRow()));
    // `matches` is a fresh array per scan, so keying on it would re-enter on every
    // unrelated render of the owning screen; the query+mode pair is what actually
    // changes the answer. `resetKey` is in here for the file change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, resetKey]);

  // Reveal whatever the cursor lands on, wherever it came from — typing, Enter,
  // the chevrons. One effect, so every path scrolls the same way.
  React.useEffect(() => {
    const m = matches[current];
    if (open && m) revealRow(m.rowIndex);
    // Same reason as above: keyed on the position, not on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, matchKey, open]);

  const step = React.useCallback(
    (delta: 1 | -1) => setCurrent((c) => stepMatch(matches.length, c, delta)),
    [matches.length],
  );
  const next = React.useCallback(() => step(1), [step]);
  const prev = React.useCallback(() => step(-1), [step]);

  const close = React.useCallback(() => {
    setOpen(false);
    setCurrent(-1);
  }, []);

  // The bar's input takes focus on open — and on a second find chord while it is
  // already open, which re-selects the query so typing replaces it. That second
  // press only ever arrives from OUTSIDE a text field (see `suppressInInput`),
  // which is precisely the case where the reader has clicked back into the diff.
  const openFind = React.useCallback(() => {
    setOpen(true);
    // On a frame boundary: on the first open the input does not exist yet.
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else focus();
  }, []);

  useAction(
    "diff.find",
    () => {
      // Nothing searchable (binary, LFS, no diff): decline rather than offer a
      // control that can never match. The chord then falls through unhandled.
      if (!enabled) return false;
      openFind();
      return true;
    },
    [enabled, openFind],
    { paneId: paneIds },
  );

  useAction(
    "diff.closeFind",
    () => {
      // Declining is what keeps Escape reaching app.closeOverlay from a diff pane
      // when there is no find bar to close — see the ordering note in presets.ts.
      if (!open) return false;
      close();
      return true;
    },
    [open, close],
    { paneId: paneIds },
  );

  const marks = React.useMemo(
    () => (open ? findMarksByRow(matches, current) : new Map<number, FindMark[]>()),
    [open, matches, current],
  );
  const marksFor = React.useCallback(
    (rowIndex: number) => marks.get(rowIndex),
    [marks],
  );

  return {
    // `enabled` also HIDES the bar, so switching to a binary file does not leave a
    // find box floating over "Binary file — no textual diff."
    open: open && enabled,
    available: enabled,
    query,
    caseSensitive,
    matchCount: matches.length,
    truncated,
    current,
    setQuery,
    setCaseSensitive,
    next,
    prev,
    openBar: openFind,
    close,
    inputRef,
    marksFor,
  };
}
