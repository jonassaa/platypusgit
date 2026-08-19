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

/**
 * Tiny bottom toast.
 *
 * ONE element, reused. It used to append a fresh node per call with no dedup, so
 * two calls in quick succession stacked two toasts at the same fixed position,
 * drawn on top of each other — which is exactly what a "press the chord again"
 * hint invites. Re-showing replaces the text and restarts both timers instead.
 */
let flashEl: HTMLDivElement | null = null;
let flashTimers: ReturnType<typeof setTimeout>[] = [];

export function pgFlash(msg: string) {
  for (const t of flashTimers) clearTimeout(t);
  flashTimers = [];
  // `isConnected` covers the window a test (or a React root swap) cleared the
  // body under us: the module-level handle would otherwise point at an orphan.
  if (!flashEl || !flashEl.isConnected) {
    flashEl = document.createElement("div");
    flashEl.setAttribute("data-pg-flash", "");
    flashEl.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
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
