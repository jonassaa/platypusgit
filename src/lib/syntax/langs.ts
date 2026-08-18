// Path → Shiki language, plus the grammar loaders.
//
// LANG_LOADERS is an EXPLICIT map of static import() calls, not
// `import(`…/${lang}.mjs`)`. A template-literal specifier is not
// statically analysable, so Vite can neither resolve nor code-split it; written
// out, each grammar becomes its own lazily-fetched chunk.
//
// The grammars come from @shikijs/langs-precompiled, paired with
// createJavaScriptRawEngine in shiki.ts: the regexes are already translated to
// native JS RegExp at package build time, so loading a grammar skips the
// oniguruma-to-es translation the plain JS engine runs per pattern — the
// dominant cost of the first highlight in each language — and the translator
// itself stays out of the bundle. Every language below exists in the
// precompiled set (verified against @shikijs/langs-precompiled@4.4.3).
//
// Ported from the highlight.js table this replaces (src/lib/highlight.ts), with
// Shiki's language ids: `tsx` and `jsx` are real grammars here rather than
// aliases of typescript/javascript, and `sh` is `shellscript`.

export type ShikiLang =
  | "typescript" | "tsx" | "javascript" | "jsx" | "rust" | "python" | "go"
  | "java" | "kotlin" | "swift" | "c" | "cpp" | "csharp" | "ruby" | "php"
  | "lua" | "sql" | "shellscript" | "json" | "yaml" | "toml" | "xml" | "html"
  | "css" | "scss" | "less" | "markdown" | "docker" | "make" | "graphql"
  | "ini" | "diff" | "perl" | "r" | "objective-c";

export const LANG_LOADERS: Record<ShikiLang, () => Promise<unknown>> = {
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  python: () => import("@shikijs/langs-precompiled/python"),
  go: () => import("@shikijs/langs-precompiled/go"),
  java: () => import("@shikijs/langs-precompiled/java"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  php: () => import("@shikijs/langs-precompiled/php"),
  lua: () => import("@shikijs/langs-precompiled/lua"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  json: () => import("@shikijs/langs-precompiled/json"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
  toml: () => import("@shikijs/langs-precompiled/toml"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
  html: () => import("@shikijs/langs-precompiled/html"),
  css: () => import("@shikijs/langs-precompiled/css"),
  scss: () => import("@shikijs/langs-precompiled/scss"),
  less: () => import("@shikijs/langs-precompiled/less"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  docker: () => import("@shikijs/langs-precompiled/docker"),
  make: () => import("@shikijs/langs-precompiled/make"),
  graphql: () => import("@shikijs/langs-precompiled/graphql"),
  ini: () => import("@shikijs/langs-precompiled/ini"),
  diff: () => import("@shikijs/langs-precompiled/diff"),
  perl: () => import("@shikijs/langs-precompiled/perl"),
  r: () => import("@shikijs/langs-precompiled/r"),
  "objective-c": () => import("@shikijs/langs-precompiled/objective-c"),
};

const BY_EXT: Record<string, ShikiLang> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  lua: "lua",
  sql: "sql",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "shellscript",
  json: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  xml: "xml", svg: "xml",
  html: "html", htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown", markdown: "markdown",
  graphql: "graphql", gql: "graphql",
  ini: "ini", conf: "ini",
  diff: "diff", patch: "diff",
  pl: "perl",
  r: "r",
  m: "objective-c", mm: "objective-c",
  dockerfile: "docker",
  mk: "make",
};

const BY_NAME: Record<string, ShikiLang> = {
  dockerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
};

export function langForPath(path: string): ShikiLang | null {
  if (!path) return null;
  const base = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return null;
  return BY_EXT[base.slice(dot + 1)] ?? null;
}
