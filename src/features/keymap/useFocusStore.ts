// Focus model — tracks which pane holds focus. Panes register their DOM element
// via <PGPane>; Alt+Arrow traversal (`move`) picks the nearest pane by geometry
// (see spatial.ts), so no screen has to hand-code a neighbor graph.
//
// The activity bar registers as a "bar" pane: it never auto-grabs focus and is
// excluded from "first content pane" resolution, but is reachable spatially
// (it's the leftmost pane, so Alt+Left from any content pane finds it).

import { create } from "zustand";
import { pickNeighbor, topLeftmost, type Dir, type Rect } from "./spatial";

interface RegisterOpts {
  autoFocus?: boolean;
  isBar?: boolean;
  isPrimary?: boolean;
}

interface PaneEntry {
  el: HTMLElement | null;
  isBar: boolean;
}

interface FocusState {
  focused: string | null;
  panes: Map<string, PaneEntry>;
  order: string[];
  barId: string | null;
  /**
   * The current screen's main pane — the commit list in History, the tree in
   * Files. Entering a screen focuses it, and Alt+Right off the activity bar
   * lands on it, instead of whatever geometry or mount order happened to win
   * (from the full-height bar, a bottom detail panel can be the nearest pane
   * to the right, which is never what "go into this screen" means).
   */
  primaryId: string | null;
  pendingContentFocus: boolean;
  register: (
    id: string,
    el: HTMLElement | null,
    opts?: RegisterOpts,
  ) => () => void;
  focus: (id: string) => void;
  move: (dir: Dir) => void;
  /** Tab-cycle panes in reading order (top-left → bottom-right), wrapping. */
  cycle: (delta: 1 | -1) => void;
  requestContentFocus: () => void;
}

function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // jsdom / detached nodes report an all-zero rect — treat as unusable.
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function contentPanes(s: FocusState): { id: string; rect: Rect }[] {
  const out: { id: string; rect: Rect }[] = [];
  for (const id of s.order) {
    const entry = s.panes.get(id);
    if (!entry || entry.isBar) continue;
    const rect = rectOf(entry.el);
    if (rect) out.push({ id, rect });
  }
  return out;
}

function firstContentId(s: FocusState): string | null {
  // The screen said which pane it considers its main one — that outranks both
  // geometry and mount order.
  if (s.primaryId && s.panes.get(s.primaryId)?.isBar === false) return s.primaryId;
  const withRects = contentPanes(s);
  const spatial = topLeftmost(withRects);
  if (spatial) return spatial;
  // Fallback (no layout, e.g. tests): first non-bar pane in registration order.
  return s.order.find((id) => id !== s.barId && s.panes.has(id)) ?? null;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focused: null,
  panes: new Map(),
  order: [],
  barId: null,
  primaryId: null,
  pendingContentFocus: false,

  register(id, el, opts) {
    const isBar = opts?.isBar ?? false;
    const autoFocus = opts?.autoFocus ?? true;
    get().panes.set(id, { el, isBar });
    if (!get().order.includes(id)) set({ order: [...get().order, id] });
    if (isBar) set({ barId: id });
    if (opts?.isPrimary) set({ primaryId: id });

    if (
      autoFocus &&
      !isBar &&
      (get().pendingContentFocus || get().focused === null)
    ) {
      set({ focused: id, pendingContentFocus: false });
    }
    // No reclaim branch here on purpose: the pane that registers first may not
    // be the primary one, but every screen entry ends with AppShell calling
    // requestContentFocus() — child effects run before the parent's, so the
    // primary is registered by then and firstContentId prefers it.

    return () => {
      get().panes.delete(id);
      set({ order: get().order.filter((x) => x !== id) });
      if (get().barId === id) set({ barId: null });
      if (get().primaryId === id) set({ primaryId: null });
      if (get().focused === id) {
        const next = firstContentId(get()) ?? get().barId ?? null;
        set({ focused: next });
      }
    };
  },

  focus(id) {
    if (get().panes.has(id)) set({ focused: id });
  },

  move(dir) {
    const s = get();
    const cur = s.focused;
    if (!cur) {
      // Nothing focused yet → enter the first content pane.
      s.requestContentFocus();
      return;
    }
    // Leaving the activity bar means "go into this screen", so it lands on the
    // screen's primary pane. Geometry would answer differently: the bar spans
    // the full height, so a bottom detail panel is often the nearest pane to
    // its right — History would open on the commit-detail panel, not the log.
    if (dir === "right" && cur === s.barId && s.primaryId && s.panes.has(s.primaryId)) {
      set({ focused: s.primaryId });
      return;
    }
    const curEl = s.panes.get(cur)?.el ?? null;
    const curRect = rectOf(curEl);
    const candidates: { id: string; rect: Rect }[] = [];
    for (const id of s.order) {
      if (id === cur) continue;
      const rect = rectOf(s.panes.get(id)?.el ?? null);
      if (rect) candidates.push({ id, rect });
    }
    if (!curRect || candidates.length === 0) return;
    const next = pickNeighbor(curRect, candidates, dir);
    if (next) set({ focused: next });
  },

  cycle(delta) {
    const s = get();
    // Reading order: rows first (top, tolerating small offsets), then left.
    const all: { id: string; rect: Rect }[] = [];
    for (const id of s.order) {
      const rect = rectOf(s.panes.get(id)?.el ?? null);
      if (rect) all.push({ id, rect });
    }
    if (all.length === 0) {
      // No layout (tests) — fall back to registration order.
      const ids = s.order.filter((id) => s.panes.has(id));
      if (ids.length === 0) return;
      const cur = s.focused ? ids.indexOf(s.focused) : -1;
      const next = ids[(cur + delta + ids.length) % ids.length];
      set({ focused: next });
      return;
    }
    all.sort((a, b) => {
      const rowDiff = a.rect.top - b.rect.top;
      if (Math.abs(rowDiff) > 8) return rowDiff;
      return a.rect.left - b.rect.left;
    });
    const idx = s.focused ? all.findIndex((p) => p.id === s.focused) : -1;
    const next = all[(idx + delta + all.length) % all.length];
    set({ focused: next.id });
  },

  requestContentFocus() {
    const first = firstContentId(get());
    if (first) set({ focused: first, pendingContentFocus: false });
    else set({ pendingContentFocus: true });
  },
}));
