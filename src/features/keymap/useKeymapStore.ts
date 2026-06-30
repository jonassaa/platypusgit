// Dispatcher store — owns the active preset, the chord→action reverse map, and
// a live registry of action handlers. A single global keydown listener (in
// AppShell) calls `dispatch`, which resolves the chord to an action and invokes
// the innermost registered handler.

import { create } from "zustand";
import { ACTIONS, type ActionId } from "./registry";
import { buildReverseMap, presetById, PLATYPUSGIT_PRESET } from "./presets";
import { eventToChord } from "./chord";

const STORAGE_KEY = "pg-keymap-preset";

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

function initialPresetId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? PLATYPUSGIT_PRESET.id;
  } catch {
    return PLATYPUSGIT_PRESET.id;
  }
}

/** A handler returns `false` to decline the event (fall through to an
 *  outer handler / the browser); any other value counts as handled. */
export type ActionHandler = () => boolean | void;

interface KeymapState {
  activePresetId: string;
  reverse: Map<string, ActionId[]>;
  /** Per-action handler stacks; innermost (last-registered) gets first refusal. */
  handlers: Map<ActionId, ActionHandler[]>;
  setPreset: (id: string) => void;
  register: (id: ActionId, handler: ActionHandler) => () => void;
  /** Returns true if the event resolved to a handler and was prevented. */
  dispatch: (e: KeyboardEvent) => boolean;
}

export const useKeymapStore = create<KeymapState>((set, get) => {
  const startId = initialPresetId();
  return {
    activePresetId: startId,
    reverse: buildReverseMap(presetById(startId)),
    handlers: new Map(),

    setPreset(id) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // non-fatal
      }
      set({ activePresetId: id, reverse: buildReverseMap(presetById(id)) });
    },

    register(id: ActionId, handler: ActionHandler) {
      const arr = get().handlers.get(id) ?? [];
      arr.push(handler);
      get().handlers.set(id, arr);
      return () => {
        const cur = get().handlers.get(id);
        if (!cur) return;
        const i = cur.indexOf(handler);
        if (i >= 0) cur.splice(i, 1);
      };
    },

    dispatch(e) {
      const chord = eventToChord(e);
      if (!chord) return false;
      const ids = get().reverse.get(chord);
      if (!ids || ids.length === 0) return false;
      const editable = isEditable(e.target);
      for (const id of ids) {
        const def = ACTIONS[id];
        if (editable && !def.allowInInput) continue;
        const hs = get().handlers.get(id);
        if (!hs) continue;
        // Innermost-first; a handler may decline (return false), letting the
        // next outer handler — or the browser — take the key.
        for (let i = hs.length - 1; i >= 0; i--) {
          if (hs[i]() !== false) {
            e.preventDefault();
            return true;
          }
        }
      }
      return false;
    },
  };
});
