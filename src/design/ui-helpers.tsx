import type { ReactNode } from "react";

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          color: "var(--fg-3)",
          width: 70,
          fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {k}
      </span>
      <span
        style={{
          flex: 1,
          color: "var(--fg-0)",
          fontSize: "var(--fs-12)",
        }}
      >
        {v}
      </span>
    </div>
  );
}

/**
 * Total lifetime of a `pgFlash` toast, in ms — visible, then faded out and gone.
 *
 * Exported because a hint that says "press F7 again" is a promise about a window
 * of time: `useHunkNav` arms its cross-into-the-next-file state for exactly as
 * long as the toast that announced it is on screen, so a press minutes later
 * cannot teleport the reader out of the file they are looking at.
 */
const FLASH_VISIBLE_MS = 1400;
const FLASH_FADE_MS = 200;
export const PG_FLASH_MS = 1700; // visible, then the fade, then a little slack

/** Breathing room between an anchored toast and the row it belongs to, in px. */
const FLASH_GAP = 8;

/**
 * Put the toast at the bottom of the window, or beside the row a caller named.
 *
 * The element is reused across calls, so every positioning property one branch
 * sets must be cleared by the other — a leftover `bottom` under a fresh `top`
 * stretches one toast down the screen.
 */
function placeFlash(el: HTMLDivElement, anchor: Element | null) {
  if (!anchor) {
    el.removeAttribute("data-pg-flash-at");
    el.style.top = "auto";
    el.style.bottom = "24px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    return;
  }
  const r = anchor.getBoundingClientRect();
  el.setAttribute("data-pg-flash-at", "");
  el.style.bottom = "auto";
  el.style.transform = "none";
  // Measured after the text is in, so this is the box that will actually be
  // drawn. jsdom reports zeros throughout and the clamps degrade to the top-left
  // corner, which is the honest answer for a layout that does not exist.
  const box = el.getBoundingClientRect();
  const clamp = (v: number, max: number) =>
    Math.max(FLASH_GAP, Math.min(v, Math.max(FLASH_GAP, max)));
  // Below the row by preference, above it when there is no room. Either side of
  // the row is a shorter trip for the eye than the bottom of the window.
  const below = r.bottom + FLASH_GAP;
  const wantTop =
    below + box.height + FLASH_GAP > window.innerHeight
      ? r.top - box.height - FLASH_GAP
      : below;
  // Left-aligned with the row, which is the left edge of the diff pane: a change
  // starts there, so that is where the reading is happening.
  el.style.top = `${clamp(wantTop, window.innerHeight - box.height - FLASH_GAP)}px`;
  el.style.left = `${clamp(r.left, window.innerWidth - box.width - FLASH_GAP)}px`;
}

/**
 * Tiny toast — at the bottom of the window, or beside `anchor` when the message
 * is about where the reader is standing (#297).
 *
 * The bottom-centre position is right for messages with no location ("copied",
 * "no upstream configured"). It is wrong for F7's "press F7 again for the next
 * file", which appears at the far bottom edge of the app — a sidebar and a file
 * list away from the change the same keypress just centred — and is easy to miss
 * entirely. Missing it matters: it is the only thing that says a second press
 * leaves the file, and the arming it announces expires with it.
 *
 * A null anchor degrades to the centred toast, so a caller that cannot find the
 * reader's row needs no branch of its own.
 *
 * Deliberately NOT dismissed when the pane scrolls: the arming expires on a
 * TIMER (`PG_FLASH_MS`), so taking the hint down early would leave a live arming
 * with nothing on screen to explain it.
 *
 * ONE element, reused. It used to append a fresh node per call with no dedup, so
 * two calls in quick succession stacked two toasts at the same fixed position,
 * drawn on top of each other — which is exactly what a "press the chord again"
 * hint invites. Re-showing replaces the text and restarts both timers instead.
 */
let flashEl: HTMLDivElement | null = null;
let flashTimers: ReturnType<typeof setTimeout>[] = [];

export function pgFlash(msg: string, anchor: Element | null = null) {
  for (const t of flashTimers) clearTimeout(t);
  flashTimers = [];
  // `isConnected` covers the window a test (or a React root swap) cleared the
  // body under us: the module-level handle would otherwise point at an orphan.
  if (!flashEl || !flashEl.isConnected) {
    flashEl = document.createElement("div");
    flashEl.setAttribute("data-pg-flash", "");
    flashEl.style.cssText = `
      position: fixed;
      background: var(--bg-3); color: var(--fg-0);
      border: 1px solid var(--border-1); border-radius: var(--r-3);
      padding: 6px 12px; font-size: var(--fs-12);
      font-family: var(--font-mono);
      box-shadow: var(--shadow-2); z-index: 999999;
      animation: pg-fade-in 160ms ease-out;
    `;
    // The entrance animation only plays on insert, so a reused element changes
    // its text without re-animating. That is the point: a second message on the
    // same toast should read as an update, not as a new toast.
    document.body.appendChild(flashEl);
  }
  const el = flashEl;
  el.textContent = msg;
  el.style.transition = "";
  el.style.opacity = "1";
  // After the text, so an anchored toast is placed by the size it will be drawn
  // at rather than by the previous message's.
  placeFlash(el, anchor);
  flashTimers.push(
    setTimeout(() => {
      el.style.transition = `opacity ${FLASH_FADE_MS}ms`;
      el.style.opacity = "0";
    }, FLASH_VISIBLE_MS),
  );
  flashTimers.push(
    setTimeout(() => {
      el.remove();
      if (flashEl === el) flashEl = null;
    }, PG_FLASH_MS),
  );
}

/**
 * Take the toast down NOW, timers and all.
 *
 * A flash is a statement about where the reader is, and some of them stop being
 * true before they expire. `useHunkNav`'s "press F7 again for the next file" is
 * the case this exists for: it is a QUESTION, and the very next press answers
 * it — after which it sits under the file it just left for the rest of its 1.4s,
 * reading as "no more changes" while the reader stands on the first change of a
 * file full of them.
 *
 * Dropping the timers is not tidiness. The remove-timer closes over `el` and the
 * module handle, so leaving it pending is a scheduled removal aimed at whatever
 * toast happens to be up when it fires.
 */
export function pgFlashClear() {
  for (const t of flashTimers) clearTimeout(t);
  flashTimers = [];
  flashEl?.remove();
  flashEl = null;
}
