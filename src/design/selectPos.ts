// Where a PGSelect's option list goes — PURE arithmetic, no React and no DOM,
// for the same reason `paneSize.ts` sits beside `resizable.tsx`: jsdom performs
// no layout, so every measurement a component test could offer is 0, and the one
// branch that matters here only exists once real numbers arrive.
//
// The list is `position: fixed`, and the shell is a fixed frame (html/body/#root
// are `overflow: hidden`), so a popup placed off the viewport is not merely ugly
// — it is unreachable, with no scrollbar anywhere that could bring it back.

export interface PopoverBox {
  /** The trigger's viewport rect. */
  anchor: { left: number; top: number; bottom: number };
  /** The list's measured box. 0 means "not measured yet". */
  listW: number;
  listH: number;
  viewportW: number;
  viewportH: number;
}

/** Gap between the trigger and the list. */
const GAP = 2;
/** Keep this much viewport edge clear on every side. */
const EDGE = 4;

/**
 * Preference first — directly below the trigger, else flipped above it — then a
 * clamp into the viewport on BOTH axes and BOTH ends.
 *
 * The final clamp is not belt-and-braces. An anchor that is ITSELF off the
 * viewport (a control below the fold of a scrolled pane, opened
 * programmatically) puts "above" off-screen too, so choosing between two
 * out-of-view positions is not enough. Measured on WebKitGTK: Settings' keymap
 * picker put its list at y≈1130 in an 800px-tall window, invisible and
 * unreachable.
 *
 * A list taller than the viewport pins to the top edge — `maxHeight` on the list
 * is what keeps that from happening in practice.
 */
export function selectPopoverPos(box: PopoverBox): { left: number; top: number } {
  const { anchor, listW, listH, viewportW, viewportH } = box;
  const below = anchor.bottom + GAP;
  const preferred =
    below + listH + EDGE <= viewportH ? below : anchor.top - listH - GAP;
  return {
    left: Math.max(EDGE, Math.min(anchor.left, viewportW - listW - EDGE)),
    top: Math.max(EDGE, Math.min(preferred, viewportH - listH - EDGE)),
  };
}
