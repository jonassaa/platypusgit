// Spatial navigation — pick the nearest pane in a direction from bounding
// rects. Lets Alt+Arrow "just work" across every screen without hand-coded
// neighbor graphs: wrap a pane in <PGPane id> and geometry does the rest.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Dir = "left" | "right" | "up" | "down";

const centerX = (r: Rect) => (r.left + r.right) / 2;
const centerY = (r: Rect) => (r.top + r.bottom) / 2;

/** From `cur`, choose the best candidate pane in `dir`. Returns its id, or null
 *  if nothing lies in that direction. Cross-axis misalignment is penalized so
 *  the pane most "in line" with the current one wins. */
export function pickNeighbor(
  cur: Rect,
  candidates: { id: string; rect: Rect }[],
  dir: Dir,
): string | null {
  const cx = centerX(cur);
  const cy = centerY(cur);
  let best: string | null = null;
  let bestScore = Infinity;

  for (const c of candidates) {
    const ccx = centerX(c.rect);
    const ccy = centerY(c.rect);
    const dx = ccx - cx;
    const dy = ccy - cy;

    let primary: number;
    let cross: number;
    if (dir === "left") {
      if (dx >= -1) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (dir === "right") {
      if (dx <= 1) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (dir === "up") {
      if (dy >= -1) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else {
      if (dy <= 1) continue;
      primary = dy;
      cross = Math.abs(dx);
    }

    // Weight cross-axis distance heavily: a pane directly in the direction of
    // travel beats one that's closer but off to the side.
    const score = primary + cross * 3;
    if (score < bestScore) {
      bestScore = score;
      best = c.id;
    }
  }
  return best;
}

/** Order panes topmost-then-leftmost — used to pick the "first" content pane. */
export function topLeftmost(
  panes: { id: string; rect: Rect }[],
): string | null {
  let best: { id: string; rect: Rect } | null = null;
  for (const p of panes) {
    if (
      !best ||
      p.rect.top < best.rect.top - 1 ||
      (Math.abs(p.rect.top - best.rect.top) <= 1 && p.rect.left < best.rect.left)
    ) {
      best = p;
    }
  }
  return best?.id ?? null;
}
