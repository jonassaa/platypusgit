// Dispatcher store — owns the active preset, the chord→action reverse map, and
// a live registry of action handlers. A single global keydown listener (in
// AppShell) calls `dispatch`, which resolves the chord to an action and invokes
// the right handler:
//
//   pane-scoped actions  → innermost handler registered for the FOCUSED pane
//   global actions       → innermost mounted handler, else the catalog's
//                          default runner (actions.ts)
//
// Text-input policy: inside INPUT/TEXTAREA/contentEditable, chords carrying a
// real modifier (Mod/Ctrl/Alt) still dispatch — they can't type characters.
// Bare-key chords (arrows, letters, "?", DoubleShift) are suppressed unless
// the action opts in via `allowInInput` (Escape).

import { create } from "zustand";
import { ACTIONS, type ActionId } from "./actions";
import { buildReverseMap, presetById, DEFAULT_PRESET } from "./presets";
import { eventToChord, DOUBLE_SHIFT } from "./chord";
import { useFocusStore } from "./useFocusStore";

const STORAGE_KEY = "pg-keymap-preset";
const DOUBLE_SHIFT_MS = 350;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

function hasRealModifier(chord: string): boolean {
  return (
    chord.startsWith("Mod+") ||
    chord.startsWith("Ctrl+") ||
    chord.includes("+Alt+") ||
    chord.startsWith("Alt+")
  );
}

function initialPresetId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_PRESET.id;
  } catch {
    return DEFAULT_PRESET.id;
  }
}

/** A handler returns `false` to decline the event (fall through to an
 *  outer handler / the browser); any other value counts as handled. */
export type ActionHandler = () => boolean | void;

interface HandlerEntry {
  fn: ActionHandler;
  /** For pane-scoped actions: only runs while this pane holds focus. */
  paneId?: string;
}

export interface RegisterOpts {
  paneId?: string;
}

interface KeymapState {
  activePresetId: string;
  reverse: Map<string, ActionId[]>;
  /** Per-action handler stacks; innermost (last-registered) gets first refusal. */
  handlers: Map<ActionId, HandlerEntry[]>;
  /** Timestamp of the last lone Shift tap — DoubleShift detection. */
  lastShiftAt: number;
  setPreset: (id: string) => void;
  register: (
    id: ActionId,
    handler: ActionHandler,
    opts?: RegisterOpts,
  ) => () => void;
  /** Returns true if the event resolved to a handler and was prevented. */
  dispatch: (e: KeyboardEvent) => boolean;
}

export const useKeymapStore = create<KeymapState>((set, get) => {
  const startId = initialPresetId();

  function resolveChord(e: KeyboardEvent): string | null {
    // DoubleShift: two lone Shift taps in quick succession. Any other key
    // (including other modifiers) between taps cancels the pending tap.
    if (
      e.key === "Shift" &&
      !e.repeat &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      const now = Date.now();
      const last = get().lastShiftAt;
      set({ lastShiftAt: now });
      if (last > 0 && now - last < DOUBLE_SHIFT_MS) {
        set({ lastShiftAt: 0 });
        return DOUBLE_SHIFT;
      }
      return null;
    }
    if (get().lastShiftAt !== 0) set({ lastShiftAt: 0 });
    return eventToChord(e);
  }

  return {
    activePresetId: startId,
    reverse: buildReverseMap(presetById(startId)),
    handlers: new Map(),
    lastShiftAt: 0,

    setPreset(id) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // non-fatal
      }
      set({ activePresetId: id, reverse: buildReverseMap(presetById(id)) });
    },

    register(id, handler, opts) {
      const entry: HandlerEntry = { fn: handler, paneId: opts?.paneId };
      const arr = get().handlers.get(id) ?? [];
      arr.push(entry);
      get().handlers.set(id, arr);
      return () => {
        const cur = get().handlers.get(id);
        if (!cur) return;
        const i = cur.indexOf(entry);
        if (i >= 0) cur.splice(i, 1);
      };
    },

    dispatch(e) {
      const chord = resolveChord(e);
      if (!chord) return false;
      const ids = get().reverse.get(chord);
      if (!ids || ids.length === 0) return false;

      const editable = isEditable(e.target);
      const modChord = hasRealModifier(chord);
      const focusedPane = useFocusStore.getState().focused;

      for (const id of ids) {
        const def = ACTIONS[id];
        if (editable && !modChord && !def.allowInInput) continue;

        const hs = get().handlers.get(id) ?? [];
        // Innermost-first; a handler may decline (return false), letting the
        // next outer handler — or the default runner / browser — take the key.
        let handled = false;
        for (let i = hs.length - 1; i >= 0; i--) {
          const h = hs[i];
          if (def.scope === "pane" && h.paneId && h.paneId !== focusedPane) {
            continue;
          }
          if (h.fn() !== false) {
            handled = true;
            break;
          }
        }
        if (!handled && def.scope === "global" && def.run) {
          handled = def.run() !== false;
        }
        if (handled) {
          e.preventDefault();
          return true;
        }
      }
      return false;
    },
  };
});
