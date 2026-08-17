/**
 * The pane clamp, as pure arithmetic (#162).
 *
 * A resizable pane used to carry a hard-coded pixel maximum, which is arbitrary
 * on a large display and — worse — was still not enough to keep the layout
 * recoverable on a small one. The constraint that actually matters is not "how
 * big may this pane be" but "how small may the REST of the container get": the
 * handle sits BETWEEN the two panes and every flexible sibling is
 * `flex: 1; minWidth: 0`, so once the sibling reaches zero the handle is at (or
 * past) the container edge and the drag cannot be reversed.
 *
 * Expressed that way the ceiling disappears on its own:
 *
 *     max = container - siblingMin - reserve - handle
 *
 * `container` is 0 until a real measurement lands (see `useElementSize`), and
 * that case is NOT the same as "no space" — clamping against 0 would drive every
 * pane to its minimum and, if the result were stored, corrupt the persisted size.
 * So an unmeasured container yields `Infinity`: the floor still applies, the
 * ceiling waits.
 */

/** `PGResizeHandle`'s thickness. The handle needs room too. */
export const PANE_HANDLE_PX = 4;

/**
 * Fallback floor for the flexible side of a split. Call sites should say what
 * their own sibling needs; this is only a defensible default for one that does
 * not, and matches the old default `min`.
 */
export const DEFAULT_SIBLING_MIN = 160;

export type PaneClamp = {
  /** Floor for the pane being sized. Beats `siblingMin` when they conflict. */
  min: number;
  /** Floor for the flexible neighbour that shares the container. */
  siblingMin: number;
  /**
   * Extent already spoken for by OTHER fixed-size panes in the same container,
   * their handles included. A three-pane layout (RepoBrowser, CommitPanel) needs
   * this: "the rest of the container" is then a flexible middle pane plus a
   * second fixed one.
   */
  reserve?: number;
  /** Handle thickness; `PANE_HANDLE_PX` unless a call site differs. */
  handle?: number;
  /** Measured container extent on this pane's axis. 0 = not measured yet. */
  container: number;
};

/**
 * Largest this pane may be while its neighbours keep their floors.
 *
 * `Infinity` while the container is unmeasured — deliberately unbounded rather
 * than "0 minus the floors", which is negative and would collapse the layout.
 * When the container is genuinely too small for `min + siblingMin + …`, the
 * pane's own `min` wins: the result is `min`, never something smaller.
 */
export function paneMaxSize({
  min,
  siblingMin,
  reserve = 0,
  handle = PANE_HANDLE_PX,
  container,
}: PaneClamp): number {
  if (!Number.isFinite(container) || container <= 0) return Infinity;
  return Math.max(min, container - siblingMin - reserve - handle);
}

/**
 * `size` brought inside `[min, paneMaxSize(...)]`.
 *
 * A non-finite size falls back to `min` rather than propagating NaN through a
 * style — a stored value can be anything.
 */
export function clampPaneSize(size: number, clamp: PaneClamp): number {
  if (!Number.isFinite(size)) return clamp.min;
  return Math.min(paneMaxSize(clamp), Math.max(clamp.min, size));
}
