import { create } from "zustand";

import {
  BUILTIN_THEMES,
  applyTheme,
  useSettingsStore,
  type ThemeColors,
  type ThemeDef,
} from "@/features/settings/useSettingsStore";

import {
  NO_LOCKS,
  generate,
  inferTraits,
  rollTraits,
  type PaletteTraits,
  type TraitLocks,
} from "./palette";

/**
 * The theme editor's draft, in a store rather than in the component.
 *
 * Two reasons, and the first is not cosmetic:
 *
 *  - **`app.closeOverlay` reads stores.** Its chain in
 *    `features/keymap/actions.ts` walks `useCreateStore`, `useCreateTagStore`,
 *    `useReportStore` and so on, because a handler registered from a component
 *    runs BEFORE the default runner and would take Escape ahead of the
 *    credential prompt. Local React state cannot join that chain — which is
 *    exactly why the old dialog grew a `window.addEventListener("keydown")` of
 *    its own, the anti-pattern `design/modal.tsx` documents.
 *  - **Closing must RESTORE.** `close()` re-applies the theme that was live
 *    when the editor opened, so Escape, the backdrop click and Cancel are one
 *    path. An Escape that only unmounted the dialog would leave the abandoned
 *    draft painted on the app.
 *
 * `save()` is the one exit that does NOT restore: the theme just saved is what
 * should stay on screen.
 */
export type ThemeEditorState = {
  /** `null` when the editor is closed. */
  open: null | { mode: "new" | "edit"; sourceTheme: ThemeDef };
  name: string;
  themeMode: "dark" | "light";
  colors: ThemeColors;
  /** The theme that was live when the editor opened; restored by `close`. */
  originalTheme: ThemeDef | null;
  /** Which theme the guided "Start from" picker is pointing at. */
  baseId: string;
  /** The four values the palette is generated from. See `palette.ts`. */
  traits: PaletteTraits;
  /** Which traits a shuffle must leave alone. Session state, never persisted. */
  locks: TraitLocks;

  openNew: (source: ThemeDef) => void;
  openEdit: (theme: ThemeDef) => void;
  /** Dismiss WITHOUT saving, restoring the theme that was live on open. */
  close: () => void;
  setName: (name: string) => void;
  setThemeMode: (mode: "dark" | "light") => void;
  patchColors: (patch: Partial<ThemeColors>) => void;
  setColors: (colors: ThemeColors) => void;
  /** The guided start: take a base theme's palette, keep an accent. */
  applyBase: (baseId: string, accent?: string) => void;
  setTrait: <K extends keyof PaletteTraits>(key: K, value: PaletteTraits[K]) => void;
  toggleLock: (key: keyof TraitLocks) => void;
  /** Re-roll every unlocked trait and regenerate. */
  shuffle: () => void;
  /** Back to the theme this draft was opened from. */
  revert: () => void;
  /** Persist and leave. Returns the saved theme, or `null` for an empty name. */
  save: () => ThemeDef | null;
};

/** Every theme the "Start from" picker can name. */
function allThemes(): ThemeDef[] {
  return [...BUILTIN_THEMES, ...useSettingsStore.getState().customThemes];
}

/** What a new draft is called before the user names it themselves. */
function autoName(base: { name: string }): string {
  return `${base.name} (custom)`;
}

const EMPTY_DRAFT = {
  open: null,
  name: "",
  themeMode: "dark" as const,
  colors: BUILTIN_THEMES[0].colors,
  originalTheme: null,
  baseId: BUILTIN_THEMES[0].id,
  traits: inferTraits(BUILTIN_THEMES[0]),
  locks: NO_LOCKS,
};

export const useThemeEditorStore = create<ThemeEditorState>((set, get) => {
  /**
   * Paint the current draft on the live window.
   *
   * `"__draft__"` is a deliberate non-id: it stamps `data-theme` with something
   * no theme claims, so nothing downstream mistakes an unsaved draft for a
   * saved theme.
   */
  const preview = () => {
    const s = get();
    if (!s.open) return;
    applyTheme({
      id: "__draft__",
      name: s.name,
      mode: s.themeMode,
      colors: s.colors,
    });
  };

  /**
   * Write the traits' palette into the draft and repaint.
   *
   * Keeps `baseId` in step with `traits.baseId`: the "Start from" select and the
   * base-ramp trait are the same choice wearing two names, and letting them
   * drift is how the dialog ends up showing one theme while generating from
   * another.
   */
  const regenerate = (traits: PaletteTraits) => {
    const base = allThemes().find((t) => t.id === traits.baseId);
    if (!base) return;
    set({
      traits,
      baseId: base.id,
      themeMode: base.mode,
      colors: generate(base, traits),
    });
    preview();
  };

  return {
    ...EMPTY_DRAFT,

    openNew(source) {
      set({
        open: { mode: "new", sourceTheme: source },
        name: autoName(source),
        themeMode: source.mode,
        colors: { ...source.colors },
        baseId: source.id,
        traits: inferTraits(source),
        locks: NO_LOCKS,
        // Read BEFORE anything is applied, or the "original" is already the draft.
        originalTheme: useSettingsStore.getState().getActiveTheme(),
      });
      preview();
    },

    openEdit(theme) {
      set({
        open: { mode: "edit", sourceTheme: theme },
        name: theme.name,
        themeMode: theme.mode,
        colors: { ...theme.colors },
        baseId: theme.id,
        traits: inferTraits(theme),
        locks: NO_LOCKS,
        originalTheme: useSettingsStore.getState().getActiveTheme(),
      });
      preview();
    },

    close() {
      const orig = get().originalTheme;
      // A no-op when already closed, so `app.closeOverlay` can call it
      // defensively without repainting anything.
      if (!get().open) return;
      if (orig) applyTheme(orig);
      set({ ...EMPTY_DRAFT });
    },

    setName(name) {
      set({ name });
      preview();
    },

    setThemeMode(themeMode) {
      set({ themeMode });
      preview();
    },

    patchColors(patch) {
      set((s) => ({ colors: { ...s.colors, ...patch } }));
      preview();
    },

    setColors(colors) {
      set({ colors: { ...colors } });
      preview();
    },

    applyBase(baseId, accent) {
      const s = get();
      const base = allThemes().find((t) => t.id === baseId);
      if (!base) return;
      // A NEW draft is named after the palette it starts from, so re-basing
      // has to move the name too — otherwise "Add theme" leaves you with a
      // "Dracula (custom)" built out of Solarized. Only while the name is
      // still the automatic one: nothing overwrites what the user typed, and
      // an existing theme being edited already has a name of its own.
      const from = allThemes().find((t) => t.id === s.baseId);
      const auto = s.open?.mode === "new" && !!from && s.name === autoName(from);
      if (auto) set({ name: autoName(base) });
      // Through the traits rather than `deriveTheme` directly: the base ramp IS
      // a trait, and a second path that wrote `colors` without moving
      // `traits.baseId` would leave the palette section describing a theme the
      // draft is no longer built from.
      regenerate({ ...s.traits, baseId, seed: accent ?? base.colors.accent });
    },

    setTrait(key, value) {
      const s = get();
      if (!s.open) return;
      regenerate({ ...s.traits, [key]: value });
    },

    toggleLock(key) {
      set((s) => ({ locks: { ...s.locks, [key]: !s.locks[key] } }));
    },

    shuffle() {
      const s = get();
      if (!s.open) return;
      regenerate(rollTraits(s.traits, s.locks, s.themeMode, allThemes(), Math.random));
    },

    revert() {
      const open = get().open;
      if (!open) return;
      set({
        name: open.mode === "new" ? autoName(open.sourceTheme) : open.sourceTheme.name,
        themeMode: open.sourceTheme.mode,
        colors: { ...open.sourceTheme.colors },
        baseId: open.sourceTheme.id,
        // The traits go back too. Restoring only the colours leaves them
        // describing the abandoned generation, so the palette section reads
        // "Custom" against a palette it could regenerate exactly.
        traits: inferTraits(open.sourceTheme),
      });
      preview();
    },

    save() {
      const s = get();
      if (!s.open) return null;
      const trimmed = s.name.trim();
      // The dialog is what tells the user; the store stays free of the design
      // system so it can be tested without rendering.
      if (!trimmed) return null;

      const store = useSettingsStore.getState();
      const patch = { name: trimmed, mode: s.themeMode, colors: { ...s.colors } };

      let saved: ThemeDef;
      if (s.open.mode === "new") {
        const created = store.saveAsNewTheme(trimmed);
        useSettingsStore.setState((st) => ({
          customThemes: st.customThemes.map((t) =>
            t.id === created.id ? { ...t, ...patch } : t,
          ),
        }));
        saved = { ...created, ...patch };
      } else {
        const id = s.open.sourceTheme.id;
        useSettingsStore.setState((st) => ({
          customThemes: st.customThemes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        saved = { ...s.open.sourceTheme, ...patch };
      }

      // Through the store, not just `setState`: the draft's dark/light toggle
      // may have flipped the mode the theme inherited, and in "follow the
      // system" mode that decides WHICH half of the pairing this theme is.
      useSettingsStore.getState().setActiveThemeId(saved.id);
      // Leave WITHOUT restoring — the theme just saved is what should stay on
      // screen. Clearing `originalTheme` first makes that impossible to get
      // wrong if `close()` is called afterwards.
      set({ ...EMPTY_DRAFT });
      applyTheme(saved);
      return saved;
    },
  };
});
