// Dispatcher store — owns the active preset, the chord→action reverse map, and
// a live registry of action handlers. A single global keydown listener (in
// AppShell) calls `dispatch`, which resolves the chord to an action and invokes
// the right handler:
//
//   pane-scoped actions  → innermost handler whose scope covers the FOCUSED
//                          pane (a handler may name several panes)
//   global actions       → innermost mounted handler, else the catalog's
//                          default runner (actions.ts)
//
// Text-input policy: inside INPUT/TEXTAREA/contentEditable, chords carrying a
// real modifier (Mod/Ctrl/Alt) still dispatch — they can't type characters.
// Bare-key chords (arrows, letters, "?") are suppressed unless the action
// opts in via `allowInInput` (Escape, DoubleShift). An action can also opt
// OUT of inputs entirely via `suppressInInput` even for modifier chords
// (Alt+Arrow = caret word/paragraph movement on macOS).

import { create } from "zustand";
import { ACTIONS, type ActionId } from "./actions";
import { buildReverseMap, presetById, DEFAULT_PRESET } from "./presets";
import { eventToChord, DOUBLE_SHIFT } from "./chord";
import { useFocusStore } from "./useFocusStore";
import { useSpeedSearchStore } from "./useSpeedSearchStore";

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

/**
 * Whether the event came from inside the built-in terminal (#243).
 *
 * xterm renders a hidden `<textarea>`, so `isEditable` already suppresses bare
 * chords there. It does NOT suppress MODIFIER chords — and those are exactly
 * the ones a shell needs: Ctrl+C to interrupt, Ctrl+D for EOF, Ctrl+R for
 * history search, Ctrl+A/E to move. A terminal that sends Ctrl+C to the command
 * palette instead of the foreground process is worse than no terminal.
 *
 * So everything typed in there belongs to the shell, with exactly two
 * exceptions in [`TERMINAL_ESCAPES`]: the chord that hides the panel, which is
 * the way back out, and the overlay escape, so a cheat sheet opened over the
 * terminal can still be dismissed.
 */
function inTerminal(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("[data-testid='terminal-view']");
}

/** The only actions a key press inside the terminal may reach. */
const TERMINAL_ESCAPES: ReadonlySet<string> = new Set([
  "terminal.toggle",
  "app.closeOverlay",
]);

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
  /** For pane-scoped actions: only runs while one of these panes holds focus.
   *  Absent = unscoped (answers wherever focus sits); an empty list can never
   *  match, so the handler never runs. */
  paneIds?: readonly string[];
}

export interface RegisterOpts {
  /** One pane, or several — a screen whose chord answers from any of the panes
   *  it owns (F7 hunk nav from either the file list or the diff view) needs ONE
   *  registration covering them all, not one registration per pane. */
  paneId?: string | readonly string[];
}

function inScope(paneIds: readonly string[], focused: string | null): boolean {
  return focused !== null && paneIds.includes(focused);
}

interface KeymapState {
  activePresetId: string;
  reverse: Map<string, ActionId[]>;
  /** Per-action handler stacks; innermost (last-registered) gets first refusal. */
  handlers: Map<ActionId, HandlerEntry[]>;
  /** Timestamp of the last lone Shift tap — DoubleShift detection. */
  lastShiftAt: number;
  /** Panes that opted into speed-search (usePaneList with searchText). */
  speedPanes: Set<string>;
  setPreset: (id: string) => void;
  register: (
    id: ActionId,
    handler: ActionHandler,
    opts?: RegisterOpts,
  ) => () => void;
  /** Opt the pane into the speed-search fallback; returns unregister. */
  registerSpeedSearch: (paneId: string) => () => void;
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

  // Speed-search fallback: a keydown no binding claimed, carrying a single
  // printable character (or Backspace) without Mod/Ctrl/Alt, aimed at a
  // non-editable target, feeds the focused pane's query when that pane opted
  // in. The keymap principle "no handler reads raw keys" has exactly this
  // documented exception — unbound printable keys are query DATA, not chords.
  function speedFallback(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (isEditable(e.target)) return false;
    const pane = useFocusStore.getState().focused;
    if (!pane || !get().speedPanes.has(pane)) return false;
    const search = useSpeedSearchStore.getState();
    if (e.key === "Backspace") {
      if (!(search.queries[pane] ?? "")) return false;
      search.backspace(pane);
      return true;
    }
    if (e.key.length !== 1) return false;
    search.append(pane, e.key);
    return true;
  }

  return {
    activePresetId: startId,
    reverse: buildReverseMap(presetById(startId)),
    handlers: new Map(),
    lastShiftAt: 0,
    speedPanes: new Set(),

    setPreset(id) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // non-fatal
      }
      set({ activePresetId: id, reverse: buildReverseMap(presetById(id)) });
    },

    registerSpeedSearch(paneId) {
      get().speedPanes.add(paneId);
      return () => {
        get().speedPanes.delete(paneId);
        useSpeedSearchStore.getState().clear(paneId);
      };
    },

    register(id, handler, opts) {
      const scope = opts?.paneId;
      const paneIds =
        scope === undefined
          ? undefined
          : typeof scope === "string"
            ? [scope]
            : scope;
      const entry: HandlerEntry = { fn: handler, paneIds };
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
      if (!ids || ids.length === 0) {
        if (speedFallback(e)) {
          e.preventDefault();
          return true;
        }
        return false;
      }

      const editable = isEditable(e.target);
      const modChord = hasRealModifier(chord);
      const terminal = inTerminal(e.target);
      const focusedPane = useFocusStore.getState().focused;

      for (const id of ids) {
        const def = ACTIONS[id];
        // Inside the terminal the shell owns the keyboard — see `inTerminal`.
        // This is checked BEFORE the input rules because it is stricter than
        // them: `allowInInput` is not a licence to steal Ctrl+C from a shell.
        if (terminal && !TERMINAL_ESCAPES.has(id)) continue;
        if (editable && def.suppressInInput) continue;
        if (editable && !modChord && !def.allowInInput) continue;

        const hs = get().handlers.get(id) ?? [];
        // Innermost-first; a handler may decline (return false), letting the
        // next outer handler — or the default runner / browser — take the key.
        let handled = false;
        for (let i = hs.length - 1; i >= 0; i--) {
          const h = hs[i];
          if (def.scope === "pane" && h.paneIds && !inScope(h.paneIds, focusedPane)) {
            continue;
          }
          if (h.fn() !== false) {
            handled = true;
            break;
          }
        }
        if (!handled && def.scope === "global" && def.run) {
          // The chord is passed so one action can serve a FAMILY of chords —
          // `tab.select` is bound to Alt+1…Alt+9 and reads its digit from here
          // rather than needing nine catalog entries. Every other runner
          // ignores the argument.
          handled = def.run(chord) !== false;
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
