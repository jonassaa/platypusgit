// Multi-select list semantics shared by the CommitPanel change lists and the
// RepoBrowser file tree. Pure functions over row keys — components own the
// state, this module owns the rules.
//
// Model (classic desktop list):
// - plain click        → select exactly that row, anchor moves to it
// - cmd/ctrl click     → toggle row in/out; toggling in moves the anchor,
//                        toggling the anchor out re-homes it to the last
//                        remaining selected row
// - shift click        → replace selection with the contiguous range of
//                        visible rows between the anchor and the clicked row;
//                        the anchor stays put so successive shift-clicks
//                        re-extend from the same origin

export interface Selection {
  /** Selected row keys, in click/range order, no duplicates. */
  keys: string[];
  /** Range origin: the last plain- or ctrl-selected row. */
  anchor: string | null;
}

export const emptySelection: Selection = { keys: [], anchor: null };

export interface ClickModifiers {
  /** Cmd/Ctrl held — toggle the row. */
  toggle?: boolean;
  /** Shift held — extend a contiguous range from the anchor. */
  range?: boolean;
}

/**
 * Apply a click on `key` to the previous selection. `order` is the current
 * visible row order (used for shift ranges). Range wins over toggle when both
 * modifiers are held, matching Finder/Explorer behavior.
 */
export function clickSelection(
  order: readonly string[],
  prev: Selection,
  key: string,
  mods: ClickModifiers = {},
): Selection {
  if (mods.range) {
    const anchor = prev.anchor ?? key;
    const ai = order.indexOf(anchor);
    const ki = order.indexOf(key);
    if (ai < 0 || ki < 0) return { keys: [key], anchor: key };
    const [lo, hi] = ai <= ki ? [ai, ki] : [ki, ai];
    return { keys: order.slice(lo, hi + 1), anchor };
  }
  if (mods.toggle) {
    if (prev.keys.includes(key)) {
      const keys = prev.keys.filter((k) => k !== key);
      const anchor =
        prev.anchor === key ? (keys[keys.length - 1] ?? null) : prev.anchor;
      return { keys, anchor };
    }
    return { keys: [...prev.keys, key], anchor: key };
  }
  return { keys: [key], anchor: key };
}

/**
 * Drop keys that no longer exist (refresh, repo switch, files moving between
 * lists). A vanished anchor falls back to the last surviving selected row.
 * Returns `prev` by reference when nothing changed so callers can pass the
 * result straight to setState without spurious re-renders.
 */
export function pruneSelection(
  prev: Selection,
  valid: ReadonlySet<string>,
): Selection {
  const keys = prev.keys.filter((k) => valid.has(k));
  const anchorAlive = prev.anchor === null || valid.has(prev.anchor);
  if (keys.length === prev.keys.length && anchorAlive) return prev;
  const anchor =
    prev.anchor !== null && valid.has(prev.anchor)
      ? prev.anchor
      : (keys[keys.length - 1] ?? null);
  return { keys, anchor };
}

/**
 * The row that drives the single-file preview pane: the anchor while it is
 * still selected, otherwise the most recently selected row.
 */
export function primarySelectedKey(sel: Selection): string | null {
  if (sel.anchor !== null && sel.keys.includes(sel.anchor)) return sel.anchor;
  return sel.keys[sel.keys.length - 1] ?? null;
}
