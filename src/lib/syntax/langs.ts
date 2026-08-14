// Path → Shiki language, plus the grammar loaders.
//
// LANG_LOADERS is an EXPLICIT map of static import() calls, not
// `import(`shiki/langs/${lang}.mjs`)`. A template-literal specifier is not
// statically analysable, so Vite can neither resolve nor code-split it; written
// out, each grammar becomes its own lazily-fetched chunk.
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
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  "objective-c": () => import("shiki/langs/objective-c.mjs"),
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
