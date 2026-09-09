import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { readUserFile, writeUserFile } from "./tauri";

/**
 * The ONE way this app puts a file on disk or reads one back (#435).
 *
 * Export used to be a `Blob`, an `<a download>` and a synthetic click, and
 * import a hidden file input. The download attribute is ignored by WebKitGTK,
 * so on Linux every export button did nothing at all — silently, with no error
 * to report. Both are browser affordances in an app that has native dialogs,
 * so both are gone; `test/fileSave.test.ts` fails the build if either comes
 * back. (That guard greps for the literals, so this comment names neither.)
 *
 * A cancelled dialog resolves to `null`, never a throw: a dismissal is "no
 * answer", the same reading `pgConfirm` and `pgPrompt` give it. Every save
 * returns the PATH, because "your settings were exported" is useless without
 * saying to what.
 */
export type FileFilter = { name: string; extensions: string[] };

/** Single-theme files. The double extension is what the app has always written. */
export const THEME_FILE_FILTERS: FileFilter[] = [
  { name: "PlatypusGit theme", extensions: ["pgtheme.json", "json"] },
];

/** Whole-settings bundles (#254). */
export const SETTINGS_FILE_FILTERS: FileFilter[] = [
  { name: "PlatypusGit settings", extensions: ["json"] },
];

/**
 * Ask where to put a text file, then write it. Resolves to the chosen path, or
 * `null` when the user cancelled.
 */
export async function saveTextFile(opts: {
  defaultName: string;
  contents: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  const path = await saveDialog({
    defaultPath: opts.defaultName,
    filters: opts.filters,
  });
  if (!path) return null;
  await writeUserFile(path, opts.contents);
  return path;
}

/**
 * Ask for a text file, then read it. Resolves to `null` when the user
 * cancelled.
 */
export async function openTextFile(opts?: {
  filters?: FileFilter[];
}): Promise<{ path: string; contents: string } | null> {
  const picked = await openDialog({
    multiple: false,
    directory: false,
    filters: opts?.filters,
  });
  // `open()`'s type admits string[] (multiple: true). We never ask for it, but
  // reading [0] is cheaper than trusting the cast.
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  return { path, contents: await readUserFile(path) };
}
