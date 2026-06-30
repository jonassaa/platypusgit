import hljs from "highlight.js/lib/common";

// Extension → highlight.js language name. Extensions not listed here fall
// back to plaintext; highlight.js's "common" bundle is intentionally small.
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  m: "objectivec",
  mm: "objectivec",
  php: "php",
  pl: "perl",
  lua: "lua",
  r: "r",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  ini: "ini",
  toml: "ini",
  conf: "ini",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  graphql: "graphql",
  gql: "graphql",
};

function langForPath(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  const lower = base.toLowerCase();

  // Filename-based matches for things without an extension.
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";

  const dot = lower.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = lower.slice(dot + 1);
  const lang = EXT_TO_LANG[ext];
  if (!lang) return null;
  return hljs.getLanguage(lang) ? lang : null;
}

/**
 * Split highlighted HTML into an array of per-line HTML strings, correctly
 * closing and reopening any spans that span a newline (e.g. block comments).
 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  let current = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        current += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("</")) {
        openTags.pop();
      } else if (!tag.endsWith("/>")) {
        openTags.push(tag);
      }
      current += tag;
      i = end + 1;
    } else if (ch === "\n") {
      for (let j = 0; j < openTags.length; j++) current += "</span>";
      lines.push(current);
      current = "";
      for (const t of openTags) current += t;
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  lines.push(current);
  // Drop the trailing empty line a final newline produces.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface HighlightedFile {
  language: string | null;
  lines: string[];
}

export function highlightFile(path: string, text: string): HighlightedFile {
  const lang = langForPath(path);
  if (!lang) {
    return {
      language: null,
      lines: text.split("\n").map(escapeHtml),
    };
  }
  const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
  return { language: lang, lines: splitHighlightedLines(result.value) };
}
