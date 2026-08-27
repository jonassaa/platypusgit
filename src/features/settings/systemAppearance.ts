// The OS light/dark appearance, as THIS window observes it (#236).
//
// Deliberately not a setting. Nothing here is persisted or exported: it is a
// fact about the machine at this moment, not something a person chose, and
// importing "it was dark where this file was written" would be meaningless.
// The same call `useUpdateStore.lastCheckedAt` got in #283.
//
// TWO SOURCES, because neither covers every platform or every moment:
//
//   `prefers-color-scheme` — synchronous, so it can answer during module load
//     and the first paint is already the right theme instead of a flash of the
//     other one. It is also the ONLY source outside Tauri (a plain `pnpm dev`
//     browser tab, and the unit suite).
//   `getCurrentWindow().theme()` + `tauri://theme-changed` — authoritative,
//     and the one that actually fires when the OS switches at sunset. Async,
//     so it refines the first answer rather than providing it.
//
// Both are per-window, which is what makes the merge resolver follow on its
// own: it is a second Tauri window running the same bundle, and it subscribes
// for itself rather than depending on the main window being open.

import { getCurrentWindow } from "@tauri-apps/api/window";

export type Appearance = "dark" | "light";

/**
 * The answer when no source can tell us.
 *
 * Dark, because that is the appearance this app has always had — a machine
 * that cannot report its preference must not be handed a change.
 */
export const FALLBACK_APPEARANCE: Appearance = "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function queryMatches(query: string): boolean {
  try {
    // jsdom implements no matchMedia at all; some embedded webviews implement
    // it without the color-scheme feature.
    return window.matchMedia?.(query)?.matches === true;
  } catch {
    return false;
  }
}

/**
 * What `prefers-color-scheme` says, or null when it cannot say.
 *
 * BOTH queries are asked, never only the dark one. A webview with no support
 * for the feature answers `false` to both — indistinguishable from "light" if
 * you only ask about dark, and reading that as light would flip the app's
 * appearance on exactly the platforms that cannot correct it.
 */
export function readMediaQuery(): Appearance | null {
  if (queryMatches(DARK_QUERY)) return "dark";
  if (queryMatches(LIGHT_QUERY)) return "light";
  return null;
}

let observed: Appearance = readMediaQuery() ?? FALLBACK_APPEARANCE;

/** The last observed appearance. Available synchronously, from module load. */
export function getSystemAppearance(): Appearance {
  return observed;
}

/**
 * Record an observation. Returns true only when it actually changed, so the
 * two sources agreeing costs nothing — no re-resolve, no re-apply, no write.
 */
export function setSystemAppearance(next: Appearance): boolean {
  if (next === observed) return false;
  observed = next;
  return true;
}

/**
 * Subscribe this window to the OS appearance for as long as it lives.
 *
 * `onChange` fires only on a real change (see `setSystemAppearance`), never
 * with the value already in hand — the caller has `getSystemAppearance()` for
 * that and has already used it.
 */
export function watchSystemAppearance(
  onChange: (appearance: Appearance) => void,
): () => void {
  let live = true;
  const cleanups: Array<() => void> = [];

  const deliver = (next: Appearance | null) => {
    if (!live || !next) return;
    if (setSystemAppearance(next)) onChange(next);
  };

  // Source 1 — the media query.
  try {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (mq?.addEventListener) {
      const handler = (e: MediaQueryListEvent) =>
        deliver(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      cleanups.push(() => mq.removeEventListener("change", handler));
    }
  } catch {
    // No matchMedia: source 2 is the whole answer here.
  }

  // Source 2 — the Tauri window theme. Async, and absent entirely outside
  // Tauri, so every step is guarded: a browser tab must degrade to source 1
  // rather than throwing an unhandled rejection out of module load.
  void (async () => {
    try {
      const win = getCurrentWindow();
      const now = await win.theme?.();
      deliver(now === "dark" || now === "light" ? now : null);
      const unlisten = await win.onThemeChanged?.(({ payload }) => {
        deliver(payload === "dark" || payload === "light" ? payload : null);
      });
      if (!unlisten) return;
      // The caller may have unsubscribed while we were awaiting.
      if (!live) {
        unlisten();
        return;
      }
      cleanups.push(unlisten);
    } catch {
      // Not running under Tauri, or the window API is unavailable.
    }
  })();

  return () => {
    live = false;
    for (const off of cleanups.splice(0)) off();
  };
}
