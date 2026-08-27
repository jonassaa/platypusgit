// jsdom implements no `matchMedia` at all, so `prefers-color-scheme` — one of
// the two sources behind "follow the system appearance" (#236) — has nothing
// to read in the unit suite. This installs a controllable one.
//
// Deliberately NOT installed globally in `setup.ts`: with no matchMedia the
// app falls back to dark, which is exactly what every pre-existing test
// expects, and a global stub would quietly make that fallback untested.

export type StubAppearance = "dark" | "light";

interface Listener {
  query: string;
  fn: (e: MediaQueryListEvent) => void;
}

export interface MatchMediaStub {
  /** Flip the OS appearance and notify every subscriber. */
  set(next: StubAppearance): void;
}

const DARK = "(prefers-color-scheme: dark)";

/**
 * @param initial `null` models a webview with no prefers-color-scheme support:
 *   BOTH queries answer false, which must not be read as "light".
 */
export function installMatchMedia(initial: StubAppearance | null): MatchMediaStub {
  let current = initial;
  const listeners = new Set<Listener>();
  const matchesFor = (query: string, value: StubAppearance | null) =>
    value === null ? false : query === DARK ? value === "dark" : value === "light";

  const matchMedia = (query: string): MediaQueryList =>
    ({
      media: query,
      get matches() {
        return matchesFor(query, current);
      },
      addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
        listeners.add({ query, fn });
      },
      removeEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
        for (const l of [...listeners]) if (l.fn === fn) listeners.delete(l);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as unknown as MediaQueryList;

  (window as unknown as { matchMedia?: unknown }).matchMedia = matchMedia;

  return {
    set(next) {
      current = next;
      for (const l of [...listeners]) {
        l.fn({ matches: matchesFor(l.query, next) } as MediaQueryListEvent);
      }
    },
  };
}

/** Back to jsdom's default — no matchMedia at all. */
export function uninstallMatchMedia(): void {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
}
