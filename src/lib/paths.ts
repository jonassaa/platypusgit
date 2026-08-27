// Workdir-relative ⇄ absolute path arithmetic for the "Copy path" / "Copy
// relative path" menu entries (#245).
//
// Pure string work, deliberately not `node:path` — this runs in the webview,
// where there is no `path` module and no way to ask the host which separator
// it uses. The separator is inferred from the value instead: a repository
// opened on Windows hands the frontend `C:\Users\me\repo`, a UNC share hands
// it `\\server\share\repo`, and everywhere else it is posix. Git itself always
// reports file paths with forward slashes, so the two sides of a join can and
// do disagree — every function normalises first and only re-applies the
// workdir's own style on the way out.
//
// The whole module is total: no throw, and no `../..` walking. A path that is
// not inside the workdir has no meaningful repository-relative form, so
// `relativeToWorkdir` answers `null` rather than emitting a traversal string a
// user would paste into a bug report.

/** A drive-letter root: `C:` or `C:/…`. */
const DRIVE = /^[A-Za-z]:(?:\/|$)/;

/**
 * One canonical form: forward slashes, no repeated separators, no trailing
 * separator. A lone root stays `/`, and the leading pair of a UNC path
 * (`\\server\share`) is part of its root and survives.
 */
export function normalizeSeparators(path: string): string {
  if (!path) return "";
  const slashed = path.replace(/\\/g, "/");
  const unc = slashed.startsWith("//");
  const collapsed = slashed.replace(/\/{2,}/g, "/");
  const joined = unc ? `/${collapsed}` : collapsed;
  return joined.replace(/\/+$/, "") || "/";
}

/** `true` for a posix root, a drive letter, or a UNC share. */
export function isAbsolutePath(path: string): boolean {
  const s = normalizeSeparators(path);
  return s.startsWith("/") || DRIVE.test(s);
}

/**
 * Does this value look like a Windows path? Drive letter or UNC root settle
 * it; failing that, a backslash anywhere can only be a separator, since git
 * never emits one and a literal backslash in a filename is not addressable on
 * the platform we would be guessing wrong for.
 */
function isWindowsStyle(path: string): boolean {
  const s = normalizeSeparators(path);
  return DRIVE.test(s) || s.startsWith("//") || path.includes("\\");
}

/** `./a/b` → `a/b`. Git never emits the prefix; hand-typed paths carry it. */
function stripDotSlash(path: string): string {
  return path.replace(/^(?:\.\/)+/, "");
}

/** Re-apply the platform's separator to a normalized path. */
function denormalize(path: string, windows: boolean): string {
  return windows ? path.replace(/\//g, "\\") : path;
}

/**
 * `path` expressed relative to the repository workdir, with forward slashes.
 *
 * - A path that is already relative comes back normalized, untouched — the
 *   file lists hand out git-relative paths and asking for their relative form
 *   must be a no-op, not a second prefix strip.
 * - `""` when `path` *is* the workdir (a repository relative to itself), which
 *   callers treat the same as `null`: nothing worth putting on a clipboard.
 * - `null` when there is no workdir, `path` is empty, or `path` is absolute
 *   and outside the workdir. Comparison is per segment, so `/repository` is
 *   never read as a child of `/repo`; it is case-insensitive only for
 *   Windows-style paths, where `/Repo` and `/repo` are one directory.
 */
export function relativeToWorkdir(
  workdir: string | null | undefined,
  path: string,
): string | null {
  const p = normalizeSeparators(path ?? "");
  if (!p) return null;
  if (!isAbsolutePath(p)) return stripDotSlash(p);

  const root = normalizeSeparators(workdir ?? "");
  if (!root) return null;

  const windows = isWindowsStyle(root) || isWindowsStyle(path);
  const fold = (s: string) => (windows ? s.toLowerCase() : s);
  if (fold(p) === fold(root)) return "";

  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!fold(p).startsWith(fold(prefix))) return null;
  return p.slice(prefix.length);
}

/**
 * `path` as an absolute path, using the workdir's own separator style.
 *
 * An already-absolute `path` comes back as-is (normalized), so this is safe to
 * apply to a value whose provenance is mixed. `""` resolves to the workdir
 * itself. `null` only when a relative path has no workdir to hang from — the
 * "no repository open" case, where callers disable the entry rather than
 * copying a half-answer.
 */
export function absoluteInWorkdir(
  workdir: string | null | undefined,
  path: string,
): string | null {
  const p = stripDotSlash(normalizeSeparators(path ?? ""));
  if (isAbsolutePath(p)) return denormalize(p, isWindowsStyle(path ?? ""));

  const root = normalizeSeparators(workdir ?? "");
  if (!root) return null;

  const joined = !p ? root : root === "/" ? `/${p}` : `${root}/${p}`;
  return denormalize(joined, isWindowsStyle(workdir ?? ""));
}
