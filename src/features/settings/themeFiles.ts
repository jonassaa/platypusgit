import {
  SETTINGS_FILE_FILTERS,
  THEME_FILE_FILTERS,
  openTextFile,
  saveTextFile,
} from "@/lib/userFile";

import {
  BUILTIN_THEMES,
  parseThemeJson,
  useSettingsStore,
  type SettingsExportOptions,
  type ThemeColors,
  type ThemeDef,
} from "./useSettingsStore";

/**
 * The side-effecting half of theme and settings export (#435).
 *
 * The store keeps the PURE serialisers — `exportTheme`, `exportSettings` — and
 * this module owns the dialogs and the bytes. Same split `features/report/`
 * makes between `report.ts` and `fileReport.ts`, and for the same reason: a
 * pure function is what the tests can assert on cheaply, and the file path is
 * what changes per platform.
 *
 * `downloadTheme` and `downloadSettings` used to live on the store and wrote
 * their file with an `<a download>` click that WebKitGTK ignores. They are
 * REMOVED rather than kept as aliases: a working export and a broken one under
 * two names is worse than either.
 */

/** `My Cool Theme` → `my-cool-theme.pgtheme.json`. */
export function themeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "theme"}.pgtheme.json`;
}

/** Export a saved theme. Resolves to the path written, or `null` on cancel. */
export async function exportThemeToFile(id: string): Promise<string | null> {
  const store = useSettingsStore.getState();
  const contents = store.exportTheme(id);
  const theme = [...BUILTIN_THEMES, ...store.customThemes].find((t) => t.id === id);
  return saveTextFile({
    defaultName: themeFileName(theme?.name ?? "theme"),
    contents,
    filters: THEME_FILE_FILTERS,
  });
}

/**
 * Export the editor's UNSAVED draft — the round trip through an external editor
 * that #435's reporter was trying to make.
 */
export async function exportThemeDraftToFile(draft: {
  name: string;
  mode: "dark" | "light";
  colors: ThemeColors;
}): Promise<string | null> {
  const contents = JSON.stringify(
    {
      $schema: "https://platypusgit.dev/theme.schema.json",
      version: 1,
      name: draft.name,
      mode: draft.mode,
      colors: draft.colors,
    },
    null,
    2,
  );
  return saveTextFile({
    defaultName: themeFileName(draft.name),
    contents,
    filters: THEME_FILE_FILTERS,
  });
}

/** Import a theme file into the store. `null` on cancel; throws on bad JSON. */
export async function importThemeFromFile(): Promise<ThemeDef | null> {
  const picked = await openTextFile({ filters: THEME_FILE_FILTERS });
  if (!picked) return null;
  return useSettingsStore.getState().importThemeJson(picked.contents);
}

/**
 * Read a theme file WITHOUT adding it to the store — for loading one into the
 * editor's draft, where the user has not decided to keep it yet.
 */
export async function readThemeFromFile(): Promise<ThemeDef | null> {
  const picked = await openTextFile({ filters: THEME_FILE_FILTERS });
  if (!picked) return null;
  return parseThemeJson(picked.contents);
}

/** Export the whole settings bundle. `null` on cancel. */
export async function exportSettingsToFile(
  opts?: SettingsExportOptions,
): Promise<string | null> {
  const contents = useSettingsStore.getState().exportSettings(opts);
  const stamp = new Date().toISOString().slice(0, 10);
  return saveTextFile({
    defaultName: `platypusgit-settings-${stamp}.json`,
    contents,
    filters: SETTINGS_FILE_FILTERS,
  });
}

/**
 * Pick a settings bundle and read it, WITHOUT applying it. `null` on cancel.
 *
 * Read-then-confirm rather than a one-shot import, because an import replaces
 * every preference at once and the Backup page asks before applying — the file
 * is the one thing the user can still recognise at that point. The page calls
 * `importSettings` itself once the answer is yes.
 */
export async function readSettingsFile(): Promise<{ path: string; contents: string } | null> {
  return openTextFile({ filters: SETTINGS_FILE_FILTERS });
}
