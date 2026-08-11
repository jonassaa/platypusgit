import type { IconName } from "@/design";

export interface FileIcon {
  /** Glyph from the design system's icon set. */
  icon: IconName;
  /** CSS var expression for the glyph color. */
  tint: string;
}

const FALLBACK: FileIcon = { icon: "file", tint: "var(--fg-2)" };

const CODE: FileIcon = { icon: "fileCode", tint: "var(--accent-2)" };
const MARKUP: FileIcon = { icon: "fileMarkup", tint: "var(--accent-2)" };
const STYLE: FileIcon = { icon: "fileStyle", tint: "var(--accent-4)" };
const CONFIG: FileIcon = { icon: "fileConfig", tint: "var(--accent-3)" };
const DOC: FileIcon = { icon: "fileDoc", tint: "var(--fg-2)" };
const IMAGE: FileIcon = { icon: "fileImage", tint: "var(--accent-5)" };
const LOCK: FileIcon = { icon: "lock", tint: "var(--fg-3)" };
const ARCHIVE: FileIcon = { icon: "fileArchive", tint: "var(--fg-3)" };
const BINARY: FileIcon = { icon: "fileBinary", tint: "var(--fg-3)" };

const BY_EXT: Record<string, FileIcon> = {
  ts: CODE, tsx: CODE, js: CODE, jsx: CODE, mjs: CODE, cjs: CODE,
  rs: CODE, py: CODE, go: CODE, rb: CODE, java: CODE, kt: CODE,
  c: CODE, h: CODE, cpp: CODE, hpp: CODE, cs: CODE, swift: CODE,
  sh: CODE, bash: CODE, zsh: CODE, fish: CODE, sql: CODE, lua: CODE,
  html: MARKUP, htm: MARKUP, xml: MARKUP, svg: MARKUP, vue: MARKUP, svelte: MARKUP,
  css: STYLE, scss: STYLE, sass: STYLE, less: STYLE,
  json: CONFIG, jsonc: CONFIG, toml: CONFIG, yaml: CONFIG, yml: CONFIG,
  ini: CONFIG, env: CONFIG, conf: CONFIG, cfg: CONFIG, properties: CONFIG,
  gitignore: CONFIG, gitattributes: CONFIG, editorconfig: CONFIG,
  md: DOC, mdx: DOC, txt: DOC, rst: DOC, adoc: DOC, pdf: DOC,
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE,
  ico: IMAGE, avif: IMAGE, bmp: IMAGE,
  lock: LOCK,
  zip: ARCHIVE, tar: ARCHIVE, gz: ARCHIVE, tgz: ARCHIVE, bz2: ARCHIVE,
  xz: ARCHIVE, rar: ARCHIVE, "7z": ARCHIVE,
  exe: BINARY, dll: BINARY, so: BINARY, dylib: BINARY, a: BINARY,
  bin: BINARY, wasm: BINARY, woff: BINARY, woff2: BINARY, ttf: BINARY, otf: BINARY,
};

/**
 * Whole-filename matches, checked BEFORE the extension. `pnpm-lock.yaml` is a
 * lockfile, not a YAML config, and `Dockerfile` has no extension at all.
 */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: CONFIG,
  makefile: CONFIG,
  "cargo.lock": LOCK,
  "pnpm-lock.yaml": LOCK,
  "package-lock.json": LOCK,
  "yarn.lock": LOCK,
  license: DOC,
};

/**
 * Resolve a repo-relative path to a glyph + tint. Unknown extensions fall back
 * to the generic `file` glyph, so a new file type is never a blank row.
 */
export function fileIcon(path: string): FileIcon {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  // dot === 0 is a leading-dot file (".env") — its suffix IS the extension.
  if (dot < 0) return FALLBACK;
  return BY_EXT[name.slice(dot + 1)] ?? FALLBACK;
}
