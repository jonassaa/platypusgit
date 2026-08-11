// File-type icon + tint resolution for every file row in the app.
//
// Two axes, deliberately kept separate:
//  - GLYPH is per *category* (code / data / doc / style / image / …). Nine
//    category glyphs stay legible at 11–12px, where a per-language logo would
//    turn to mush, and adding a language means one map entry, not new SVG.
//  - TINT is per *extension*, drawn from the themeable `--graph-*` lane tokens
//    so a `.ts` and a `.rs` are still told apart at a glance and every color
//    follows the active theme (see applyTheme's semantic remap).
//
// Resolution order: exact basename (lockfiles, Dockerfile, .gitignore) →
// extension → generic `file` in `--fg-2`. Unknown types therefore render
// exactly as they did before this map existed.

import type { IconName } from "@/design/icons";

export interface FileIconSpec {
  icon: IconName;
  /** CSS color value — always a `var(--…)` token so themes remap it. */
  color: string;
}

const C = {
  blue: "var(--graph-1)",
  violet: "var(--graph-2)",
  green: "var(--graph-3)",
  amber: "var(--graph-4)",
  red: "var(--graph-5)",
  pink: "var(--graph-6)",
  teal: "var(--graph-7)",
  muted: "var(--fg-2)",
  faint: "var(--fg-3)",
} as const;

export const GENERIC_FILE_ICON: FileIconSpec = { icon: "file", color: C.muted };
export const FOLDER_ICON_COLOR = "var(--accent-4)";

/** extension (no dot, lowercased) → glyph + tint. */
const BY_EXT: Record<string, FileIconSpec> = {
  // ── code ──────────────────────────────────────────────────────────────
  ts: { icon: "fileCode", color: C.blue },
  tsx: { icon: "fileCode", color: C.blue },
  mts: { icon: "fileCode", color: C.blue },
  cts: { icon: "fileCode", color: C.blue },
  js: { icon: "fileCode", color: C.amber },
  jsx: { icon: "fileCode", color: C.amber },
  mjs: { icon: "fileCode", color: C.amber },
  cjs: { icon: "fileCode", color: C.amber },
  rs: { icon: "fileCode", color: C.red },
  go: { icon: "fileCode", color: C.teal },
  py: { icon: "fileCode", color: C.green },
  rb: { icon: "fileCode", color: C.red },
  java: { icon: "fileCode", color: C.red },
  kt: { icon: "fileCode", color: C.violet },
  kts: { icon: "fileCode", color: C.violet },
  swift: { icon: "fileCode", color: C.red },
  c: { icon: "fileCode", color: C.blue },
  h: { icon: "fileCode", color: C.blue },
  cc: { icon: "fileCode", color: C.blue },
  cpp: { icon: "fileCode", color: C.blue },
  hpp: { icon: "fileCode", color: C.blue },
  cs: { icon: "fileCode", color: C.violet },
  php: { icon: "fileCode", color: C.violet },
  lua: { icon: "fileCode", color: C.blue },
  ex: { icon: "fileCode", color: C.violet },
  exs: { icon: "fileCode", color: C.violet },
  hs: { icon: "fileCode", color: C.violet },
  scala: { icon: "fileCode", color: C.red },
  dart: { icon: "fileCode", color: C.teal },
  zig: { icon: "fileCode", color: C.amber },
  html: { icon: "fileCode", color: C.red },
  htm: { icon: "fileCode", color: C.red },
  vue: { icon: "fileCode", color: C.green },
  svelte: { icon: "fileCode", color: C.red },
  astro: { icon: "fileCode", color: C.pink },

  // ── shell ─────────────────────────────────────────────────────────────
  sh: { icon: "fileShell", color: C.green },
  bash: { icon: "fileShell", color: C.green },
  zsh: { icon: "fileShell", color: C.green },
  fish: { icon: "fileShell", color: C.green },
  ps1: { icon: "fileShell", color: C.blue },
  bat: { icon: "fileShell", color: C.faint },
  cmd: { icon: "fileShell", color: C.faint },

  // ── data / config ─────────────────────────────────────────────────────
  json: { icon: "fileData", color: C.amber },
  jsonc: { icon: "fileData", color: C.amber },
  json5: { icon: "fileData", color: C.amber },
  yaml: { icon: "fileData", color: C.teal },
  yml: { icon: "fileData", color: C.teal },
  toml: { icon: "fileData", color: C.teal },
  ini: { icon: "fileData", color: C.teal },
  env: { icon: "fileConfig", color: C.amber },
  conf: { icon: "fileConfig", color: C.teal },
  cfg: { icon: "fileConfig", color: C.teal },
  properties: { icon: "fileConfig", color: C.teal },
  xml: { icon: "fileData", color: C.green },
  csv: { icon: "fileData", color: C.green },
  tsv: { icon: "fileData", color: C.green },
  sql: { icon: "fileData", color: C.teal },
  graphql: { icon: "fileData", color: C.pink },
  gql: { icon: "fileData", color: C.pink },
  proto: { icon: "fileData", color: C.blue },

  // ── style ─────────────────────────────────────────────────────────────
  css: { icon: "fileStyle", color: C.violet },
  scss: { icon: "fileStyle", color: C.pink },
  sass: { icon: "fileStyle", color: C.pink },
  less: { icon: "fileStyle", color: C.violet },
  styl: { icon: "fileStyle", color: C.violet },

  // ── docs ──────────────────────────────────────────────────────────────
  md: { icon: "fileDoc", color: C.muted },
  mdx: { icon: "fileDoc", color: C.muted },
  rst: { icon: "fileDoc", color: C.muted },
  txt: { icon: "fileDoc", color: C.muted },
  adoc: { icon: "fileDoc", color: C.muted },
  pdf: { icon: "fileDoc", color: C.red },

  // ── images ────────────────────────────────────────────────────────────
  png: { icon: "fileImage", color: C.green },
  jpg: { icon: "fileImage", color: C.green },
  jpeg: { icon: "fileImage", color: C.green },
  gif: { icon: "fileImage", color: C.green },
  webp: { icon: "fileImage", color: C.green },
  avif: { icon: "fileImage", color: C.green },
  bmp: { icon: "fileImage", color: C.green },
  ico: { icon: "fileImage", color: C.amber },
  svg: { icon: "fileImage", color: C.amber },

  // ── archives / binaries ───────────────────────────────────────────────
  zip: { icon: "fileArchive", color: C.faint },
  tar: { icon: "fileArchive", color: C.faint },
  gz: { icon: "fileArchive", color: C.faint },
  tgz: { icon: "fileArchive", color: C.faint },
  bz2: { icon: "fileArchive", color: C.faint },
  xz: { icon: "fileArchive", color: C.faint },
  zst: { icon: "fileArchive", color: C.faint },
  rar: { icon: "fileArchive", color: C.faint },
  "7z": { icon: "fileArchive", color: C.faint },
  exe: { icon: "fileBinary", color: C.faint },
  dll: { icon: "fileBinary", color: C.faint },
  so: { icon: "fileBinary", color: C.faint },
  dylib: { icon: "fileBinary", color: C.faint },
  wasm: { icon: "fileBinary", color: C.violet },
  bin: { icon: "fileBinary", color: C.faint },
  o: { icon: "fileBinary", color: C.faint },
  a: { icon: "fileBinary", color: C.faint },
  woff: { icon: "fileBinary", color: C.faint },
  woff2: { icon: "fileBinary", color: C.faint },
  ttf: { icon: "fileBinary", color: C.faint },
  otf: { icon: "fileBinary", color: C.faint },
  lock: { icon: "fileLock", color: C.red },
};

/**
 * Exact basename (lowercased) → glyph + tint. Wins over the extension map, so
 * `package-lock.json` reads as a lockfile rather than as JSON and `Dockerfile`
 * resolves at all (it has no extension).
 */
const BY_NAME: Record<string, FileIconSpec> = {
  // Lockfiles — a padlock signals "generated, don't hand-edit".
  "package-lock.json": { icon: "fileLock", color: C.red },
  "pnpm-lock.yaml": { icon: "fileLock", color: C.red },
  "yarn.lock": { icon: "fileLock", color: C.red },
  "bun.lockb": { icon: "fileLock", color: C.red },
  "cargo.lock": { icon: "fileLock", color: C.red },
  "poetry.lock": { icon: "fileLock", color: C.red },
  "composer.lock": { icon: "fileLock", color: C.red },
  "gemfile.lock": { icon: "fileLock", color: C.red },
  "go.sum": { icon: "fileLock", color: C.red },

  // Git's own dotfiles.
  ".gitignore": { icon: "fileGit", color: C.red },
  ".gitattributes": { icon: "fileGit", color: C.red },
  ".gitmodules": { icon: "fileGit", color: C.red },
  ".gitkeep": { icon: "fileGit", color: C.faint },
  ".mailmap": { icon: "fileGit", color: C.red },

  // Build / tooling entry points.
  dockerfile: { icon: "fileConfig", color: C.blue },
  "docker-compose.yml": { icon: "fileConfig", color: C.blue },
  "docker-compose.yaml": { icon: "fileConfig", color: C.blue },
  makefile: { icon: "fileConfig", color: C.amber },
  justfile: { icon: "fileConfig", color: C.amber },
  "cmakelists.txt": { icon: "fileConfig", color: C.amber },
  ".editorconfig": { icon: "fileConfig", color: C.teal },
  ".npmrc": { icon: "fileConfig", color: C.red },
  ".nvmrc": { icon: "fileConfig", color: C.green },
  ".dockerignore": { icon: "fileConfig", color: C.blue },
  ".prettierrc": { icon: "fileConfig", color: C.pink },
  ".eslintrc": { icon: "fileConfig", color: C.violet },

  license: { icon: "fileDoc", color: C.amber },
  "license.md": { icon: "fileDoc", color: C.amber },
  "license.txt": { icon: "fileDoc", color: C.amber },
  readme: { icon: "fileDoc", color: C.blue },
  "readme.md": { icon: "fileDoc", color: C.blue },
};

/**
 * Glyph + tint for a file path. Accepts a bare name or a full repo-relative
 * path; only the basename is inspected. Directories must not be passed here —
 * they get {@link FOLDER_ICON_COLOR} and the folder glyph at the call site.
 */
export function fileIconSpec(path: string): FileIconSpec {
  // libgit2 marks an embedded repo with a trailing slash; strip it so the
  // basename below isn't empty.
  const clean = path.replace(/\/+$/, "");
  const base = (clean.split("/").pop() ?? clean).toLowerCase();
  if (!base) return GENERIC_FILE_ICON;

  const byName = BY_NAME[base];
  if (byName) return byName;

  // A dotfile with no further dot (".bashrc") has no extension to speak of —
  // `split(".").pop()` would return "bashrc" and match nothing, which is the
  // right answer anyway, so no special case is needed beyond guarding "".
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return GENERIC_FILE_ICON;
  const ext = base.slice(dot + 1);
  return BY_EXT[ext] ?? GENERIC_FILE_ICON;
}
