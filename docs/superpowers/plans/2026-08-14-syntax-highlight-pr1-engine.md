# Syntax Highlighting PR1: engine, palette, first surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tokenize code with Shiki into range-shaped tokens, theme them through a `--syn-*` palette, compose them with the existing word-diff spans in one tested builder, and light up the unified diff, Blame, and the RepoBrowser preview — retiring highlight.js.

**Architecture:** Shiki runs through `createHighlighterCore` with the JavaScript regex engine and lazily registered grammars. A generated *sentinel theme* assigns each palette token a unique unused hex value, so `codeToTokens` returns an identity we map to a CSS class — no baked colors, so theme-mode switches stay CSS-only. Tokens are `{start, end, cls}` ranges, made line-relative, which lets `buildLineSpans` tile a line from syntax tokens and `WordSpan`s together.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest + React Testing Library, `shiki@^4.4.3`, Tailwind v4 CSS variables.

**Spec:** `docs/superpowers/specs/2026-08-14-syntax-highlighting-diff-virtualization-design.md`

## Global Constraints

- Node 22 + pnpm. Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to any `pnpm`/`cargo` command.
- Never call `window.confirm`/`window.prompt`; use `pgConfirm`/`pgPrompt` from `@/design`.
- Import UI primitives from `@/design`. Do not create `src/components/ui/`.
- Path alias `@/` → `src/`.
- Never hardcode the accent hue; use `var(--accent)` or `oklch(from var(--accent) …)`.
- `applyTheme()` is the source of truth for themeable tokens. The `dark` column must stay byte-identical to `src/index.css`.
- Diff/code row geometry is owned by `--lh-code`. Density (`--row-step`) does not apply to code rows.
- Guard values, verbatim: `MAX_HIGHLIGHT_BYTES = 1_000_000`, `MAX_HIGHLIGHT_LINES = 20_000`, debounce for the merge result pane `120` ms (PR2).
- Shiki facts, verbatim from the spec: `codeToTokens` returns one token array per source line; token `offset` is **document-absolute**; returned `color` values are **upper-cased**; an unregistered language throws `ShikiError`; lazy grammars require explicit static `import()` thunks.
- Commit style: Conventional Commits, imperative subject under 72 chars, `Co-Authored-By: Claude …` trailer when the assistant drove it.
- Do not run e2e natively. Only `pnpm test:e2e:docker`.

---

## File Structure

**Created:**
- `src/lib/syntax/scopes.ts` — the one table mapping palette tokens to TextMate scopes; generates both the sentinel theme and the color→class lookup.
- `src/lib/syntax/scopes.test.ts`
- `src/lib/syntax/langs.ts` — path → Shiki language id, plus the explicit lazy grammar map.
- `src/lib/syntax/langs.test.ts`
- `src/lib/syntax/shiki.ts` — highlighter singleton and `ensureLanguage`.
- `src/lib/syntax/tokenize.ts` — `tokenizeFile`, guards, cache, and the pure absolute→line-relative conversion.
- `src/lib/syntax/tokenize.test.ts`
- `src/lib/syntax/useSyntax.ts` — React hook, cancels on input change.
- `src/lib/syntax/useSyntax.test.tsx`
- `src/lib/syntax/index.ts` — barrel.
- `src/lib/lineSpans.ts` — `buildLineSpans`, the single place syntax and word ranges reconcile.
- `src/lib/lineSpans.test.ts`

**Modified:**
- `src/index.css` — add `--syn-*` defaults, delete the `.hljs-*` block.
- `src/features/settings/useSettingsStore.ts` — `SYNTAX_TOKENS` written by `applyTheme()`.
- `src/design/git-components.tsx` — `DiffText` rewritten on `buildLineSpans`; `DiffLineData` gains `syntax?`.
- `src/screens/DiffViewer.tsx` — feed both sides' tokens into rows.
- `src/screens/CommitPanel.tsx` — same.
- `src/screens/Blame.tsx` — spans instead of plain text.
- `src/screens/RepoBrowser.tsx` — preview uses Shiki.
- `package.json` — add `shiki`, drop `highlight.js`.

**Deleted:**
- `src/lib/highlight.ts`

---

### Task 1: The scope table and sentinel theme

**Files:**
- Create: `src/lib/syntax/scopes.ts`
- Test: `src/lib/syntax/scopes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SYN_TOKENS: readonly SynToken[]`, `type SynToken`, `SENTINEL_THEME` (a Shiki `ThemeRegistrationRaw`-shaped object), `classForColor(color: string): string | undefined`, `SYN_CLASS_PREFIX = "syn-"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/syntax/scopes.test.ts
import { describe, expect, it } from "vitest";
import {
  SYN_TOKENS,
  SENTINEL_THEME,
  classForColor,
  sentinelFor,
} from "./scopes";

describe("scopes table", () => {
  it("gives every token a unique sentinel", () => {
    const seen = new Set(SYN_TOKENS.map((t) => sentinelFor(t)));
    expect(seen.size).toBe(SYN_TOKENS.length);
  });

  it("maps each sentinel back to its class", () => {
    for (const t of SYN_TOKENS) {
      expect(classForColor(sentinelFor(t))).toBe(`syn-${t}`);
    }
  });

  it("matches sentinels case-insensitively, because Shiki upper-cases colours", () => {
    const s = sentinelFor("keyword");
    expect(classForColor(s.toUpperCase())).toBe("syn-keyword");
    expect(classForColor(s.toLowerCase())).toBe("syn-keyword");
  });

  it("returns undefined for a colour that is not a sentinel", () => {
    expect(classForColor("#ff00ff")).toBeUndefined();
    expect(classForColor("")).toBeUndefined();
  });

  it("emits one theme setting per token plus a default foreground", () => {
    // First entry is the scope-less default; the rest carry scopes.
    expect(SENTINEL_THEME.settings[0].scope).toBeUndefined();
    const scoped = SENTINEL_THEME.settings.slice(1);
    expect(scoped).toHaveLength(SYN_TOKENS.length);
    for (const s of scoped) {
      expect(Array.isArray(s.scope)).toBe(true);
      expect((s.scope as string[]).length).toBeGreaterThan(0);
    }
  });

  it("covers the scopes that matter for the repo's own languages", () => {
    const all = SENTINEL_THEME.settings.flatMap((s) => (s.scope as string[]) ?? []);
    for (const scope of [
      "keyword",
      "comment",
      "string",
      "constant.numeric",
      "entity.name.function",
      "entity.name.type",
      "variable",
      "entity.name.tag",
    ]) {
      expect(all).toContain(scope);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$PATH"; pnpm vitest run src/lib/syntax/scopes.test.ts`
Expected: FAIL — `Failed to resolve import "./scopes"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/syntax/scopes.ts
//
// One table drives two things: the Shiki theme we tokenize with, and the
// colour→class lookup that turns its output back into CSS classes.
//
// The theme is a SENTINEL theme: each token gets a unique, otherwise-unused hex
// value rather than a real colour. Shiki hands that value back per token, so a
// lookup recovers which token it was without paying for `includeExplanation`,
// which returns whole scope chains per token. Because the theme and the lookup
// are generated from the same table, they cannot drift.
//
// Colours are never baked into markup: rows get `class="syn-keyword"` and the
// palette lives in CSS, so switching theme mode never re-tokenizes.

/** Palette tokens. Each becomes a `--syn-<token>` variable and a `syn-<token>` class. */
export const SYN_TOKENS = [
  "keyword",
  "string",
  "number",
  "comment",
  "func",
  "type",
  "var",
  "punct",
  "tag",
  "attr",
  "regexp",
  "meta",
] as const;

export type SynToken = (typeof SYN_TOKENS)[number];

export const SYN_CLASS_PREFIX = "syn-";

/**
 * TextMate scopes per token. Order inside a list is irrelevant; Shiki resolves
 * the most specific match. Kept deliberately broad — a scope that no grammar
 * emits is harmless, a missing one shows up as unstyled text.
 */
const SCOPES: Record<SynToken, string[]> = {
  keyword: [
    "keyword",
    "storage.type",
    "storage.modifier",
    "keyword.operator",
    "keyword.control",
  ],
  string: ["string", "string.quoted", "string.template", "constant.character.escape"],
  number: ["constant.numeric", "constant.language"],
  comment: ["comment", "punctuation.definition.comment"],
  func: ["entity.name.function", "support.function", "meta.function-call"],
  type: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  var: ["variable", "variable.other", "variable.parameter", "meta.definition.variable"],
  punct: ["punctuation", "meta.brace", "punctuation.separator"],
  tag: ["entity.name.tag", "punctuation.definition.tag"],
  attr: ["entity.other.attribute-name", "support.type.property-name", "meta.attribute"],
  regexp: ["string.regexp", "constant.regexp"],
  meta: ["meta.preprocessor", "keyword.other.preprocessor", "entity.name.namespace"],
};

/**
 * Sentinel colour for a token: `#0000NN` where NN is its 1-based index. These
 * are never rendered — they exist only to be matched by `classForColor`.
 */
export function sentinelFor(token: SynToken): string {
  const n = SYN_TOKENS.indexOf(token) + 1;
  return `#0000${n.toString(16).padStart(2, "0")}`;
}

/** Anything not scoped by the theme comes back as this, and renders unstyled. */
const DEFAULT_FG = "#0000ff";

export interface SentinelThemeSetting {
  scope?: string[];
  settings: { foreground: string };
}

export const SENTINEL_THEME = {
  name: "pg-sentinel",
  type: "dark" as const,
  colors: { "editor.foreground": DEFAULT_FG },
  settings: [
    { settings: { foreground: DEFAULT_FG } },
    ...SYN_TOKENS.map((t) => ({
      scope: SCOPES[t],
      settings: { foreground: sentinelFor(t) },
    })),
  ] as SentinelThemeSetting[],
};

const BY_COLOR = new Map<string, string>(
  SYN_TOKENS.map((t) => [sentinelFor(t).toLowerCase(), `${SYN_CLASS_PREFIX}${t}`]),
);

/**
 * Sentinel colour → CSS class. Lower-cases first: Shiki returns `#FFFFFF` even
 * when the theme supplied `#ffffff`, so a case-sensitive match silently loses
 * every token.
 */
export function classForColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return BY_COLOR.get(color.toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/syntax/scopes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntax/scopes.ts src/lib/syntax/scopes.test.ts
git commit -m "feat(syntax): scope table and sentinel theme for Shiki tokens"
```

---

### Task 2: Language detection and the lazy grammar map

**Files:**
- Create: `src/lib/syntax/langs.ts`
- Test: `src/lib/syntax/langs.test.ts`
- Reference (do not edit yet): `src/lib/highlight.ts:5-79` — port its extension table and filename rules.

**Interfaces:**
- Consumes: nothing.
- Produces: `langForPath(path: string): ShikiLang | null`, `type ShikiLang`, `LANG_LOADERS: Record<ShikiLang, () => Promise<unknown>>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/syntax/langs.test.ts
import { describe, expect, it } from "vitest";
import { LANG_LOADERS, langForPath } from "./langs";

describe("langForPath", () => {
  it("maps by extension", () => {
    expect(langForPath("src/a.ts")).toBe("typescript");
    expect(langForPath("src/a.tsx")).toBe("tsx");
    expect(langForPath("main.rs")).toBe("rust");
    expect(langForPath("x/y/z.py")).toBe("python");
  });

  it("maps files that have no extension by name", () => {
    expect(langForPath("Dockerfile")).toBe("docker");
    expect(langForPath("deploy/Dockerfile")).toBe("docker");
    expect(langForPath("Makefile")).toBe("make");
  });

  it("is case-insensitive on the basename", () => {
    expect(langForPath("README.MD")).toBe("markdown");
    expect(langForPath("DOCKERFILE")).toBe("docker");
  });

  it("returns null for unknown or extension-less files", () => {
    expect(langForPath("LICENSE")).toBeNull();
    expect(langForPath("a.unknownext")).toBeNull();
    expect(langForPath("")).toBeNull();
  });

  it("has a loader for every language it can return", () => {
    const langs = [
      "typescript", "tsx", "javascript", "jsx", "rust", "python", "go",
      "java", "kotlin", "swift", "c", "cpp", "csharp", "ruby", "php",
      "lua", "sql", "shellscript", "json", "yaml", "toml", "xml", "html",
      "css", "scss", "markdown", "docker", "make", "graphql", "ini", "diff",
    ] as const;
    for (const l of langs) {
      expect(typeof LANG_LOADERS[l]).toBe("function");
    }
  });

  it("never maps a path to a language with no loader", () => {
    for (const p of ["a.ts", "a.tsx", "a.rs", "Dockerfile", "Makefile", "a.toml", "a.sh"]) {
      const l = langForPath(p);
      expect(l).not.toBeNull();
      expect(LANG_LOADERS[l!]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/syntax/langs.test.ts`
Expected: FAIL — cannot resolve `./langs`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/syntax/langs.ts
//
// Path → Shiki language, plus the grammar loaders.
//
// LANG_LOADERS is an EXPLICIT map of static import() calls, not
// `import(\`shiki/langs/${lang}.mjs\`)`. A template-literal specifier is not
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/syntax/langs.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntax/langs.ts src/lib/syntax/langs.test.ts
git commit -m "feat(syntax): path-to-language map with lazy Shiki grammar loaders"
```

---

### Task 3: Add the shiki dependency and the highlighter singleton

**Files:**
- Create: `src/lib/syntax/shiki.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SENTINEL_THEME` (Task 1), `LANG_LOADERS`, `ShikiLang` (Task 2).
- Produces: `getHighlighter(): Promise<HighlighterCore>`, `ensureLanguage(lang: ShikiLang): Promise<boolean>`, `SENTINEL_THEME_NAME = "pg-sentinel"`.

- [ ] **Step 1: Add the dependency**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm add shiki@^4.4.3
```

- [ ] **Step 2: Write the implementation**

This task has no unit test of its own: it is a thin async singleton over a third-party API, and Task 4 covers it with the module mocked. Reviewing it means reading it.

```ts
// src/lib/syntax/shiki.ts
//
// The one Shiki instance. Created lazily on first tokenize so app start pays
// nothing, and shared so grammars register once.
//
// engine-javascript rather than the default WASM Oniguruma engine: it avoids
// shipping and fetching a .wasm asset through the Tauri custom protocol.
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { SENTINEL_THEME } from "./scopes";
import { LANG_LOADERS, type ShikiLang } from "./langs";

export const SENTINEL_THEME_NAME = "pg-sentinel";

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [SENTINEL_THEME],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

const loading = new Map<ShikiLang, Promise<boolean>>();

/**
 * Register a grammar if it isn't already. Resolves false when the grammar fails
 * to load — a missing chunk must degrade to plain text, never break a diff.
 */
export function ensureLanguage(lang: ShikiLang): Promise<boolean> {
  const existing = loading.get(lang);
  if (existing) return existing;
  const p = (async () => {
    try {
      const hl = await getHighlighter();
      if (hl.getLoadedLanguages().includes(lang)) return true;
      const mod = await LANG_LOADERS[lang]();
      await hl.loadLanguage(mod as never);
      return true;
    } catch {
      loading.delete(lang); // let a later attempt retry
      return false;
    }
  })();
  loading.set(lang, p);
  return p;
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm tsc --noEmit`
Expected: no errors. If `loadLanguage`'s parameter type rejects the dynamic module, keep the `as never` cast — the loaders return Shiki's own grammar modules and the cast is documented above.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/syntax/shiki.ts
git commit -m "feat(syntax): add shiki and the highlighter singleton"
```

---

### Task 4: `tokenizeFile` — guards, line-relative ranges, cache

**Files:**
- Create: `src/lib/syntax/tokenize.ts`
- Test: `src/lib/syntax/tokenize.test.ts`

**Interfaces:**
- Consumes: `getHighlighter`, `ensureLanguage`, `SENTINEL_THEME_NAME` (Task 3), `langForPath` (Task 2), `classForColor` (Task 1).
- Produces:
  - `interface SyntaxToken { start: number; end: number; cls: string }`
  - `type SyntaxLine = SyntaxToken[]`
  - `toLineRelative(lines: {content: string; offset: number; color?: string}[][]): SyntaxLine[]`
  - `tokenizeFile(path: string, text: string): Promise<SyntaxLine[] | null>`
  - `MAX_HIGHLIGHT_BYTES = 1_000_000`, `MAX_HIGHLIGHT_LINES = 20_000`
  - `clearSyntaxCache(): void` (tests only)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/syntax/tokenize.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real grammars are slow and asynchronous; this suite is about ranges, guards
// and caching, so the highlighter is faked. The fake mimics the two Shiki
// behaviours that bite: document-absolute offsets and upper-cased colours.
const codeToTokens = vi.fn();
vi.mock("./shiki", () => ({
  SENTINEL_THEME_NAME: "pg-sentinel",
  getHighlighter: async () => ({ codeToTokens }),
  ensureLanguage: async () => true,
}));

import { sentinelFor } from "./scopes";
import {
  MAX_HIGHLIGHT_BYTES,
  MAX_HIGHLIGHT_LINES,
  clearSyntaxCache,
  toLineRelative,
  tokenizeFile,
} from "./tokenize";

const KW = sentinelFor("keyword").toUpperCase();

beforeEach(() => {
  clearSyntaxCache();
  codeToTokens.mockReset();
});

describe("toLineRelative", () => {
  it("rebases document-absolute offsets onto their own line", () => {
    // "ab\ncd" — the second line's token sits at absolute offset 3.
    const out = toLineRelative([
      [{ content: "ab", offset: 0, color: KW }],
      [{ content: "cd", offset: 3, color: KW }],
    ]);
    expect(out[0][0]).toEqual({ start: 0, end: 2, cls: "syn-keyword" });
    expect(out[1][0]).toEqual({ start: 0, end: 2, cls: "syn-keyword" });
  });

  it("drops tokens whose colour is not a sentinel", () => {
    const out = toLineRelative([
      [
        { content: "a", offset: 0, color: KW },
        { content: "b", offset: 1, color: "#0000FF" },
      ],
    ]);
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].cls).toBe("syn-keyword");
  });

  it("keeps an empty line as an empty token array", () => {
    expect(toLineRelative([[], [{ content: "x", offset: 1, color: KW }]])).toEqual([
      [],
      [{ start: 0, end: 1, cls: "syn-keyword" }],
    ]);
  });
});

describe("tokenizeFile", () => {
  it("returns per-line tokens for a known language", async () => {
    codeToTokens.mockReturnValue({
      tokens: [[{ content: "let", offset: 0, color: KW }]],
    });
    const out = await tokenizeFile("a.ts", "let");
    expect(out).toEqual([[{ start: 0, end: 3, cls: "syn-keyword" }]]);
  });

  it("returns null for an unknown language without calling Shiki", async () => {
    expect(await tokenizeFile("LICENSE", "x")).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null past the byte guard", async () => {
    expect(await tokenizeFile("a.ts", "x".repeat(MAX_HIGHLIGHT_BYTES + 1))).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null past the line guard", async () => {
    expect(await tokenizeFile("a.ts", "\n".repeat(MAX_HIGHLIGHT_LINES + 1))).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("returns null when Shiki throws, rather than propagating", async () => {
    codeToTokens.mockImplementation(() => {
      throw new Error("Language `x` not found");
    });
    expect(await tokenizeFile("a.ts", "let")).toBeNull();
  });

  it("caches by path and content", async () => {
    codeToTokens.mockReturnValue({ tokens: [[{ content: "let", offset: 0, color: KW }]] });
    await tokenizeFile("a.ts", "let");
    await tokenizeFile("a.ts", "let");
    expect(codeToTokens).toHaveBeenCalledTimes(1);
  });

  it("re-tokenizes when the content changes", async () => {
    codeToTokens.mockReturnValue({ tokens: [[{ content: "let", offset: 0, color: KW }]] });
    await tokenizeFile("a.ts", "let");
    await tokenizeFile("a.ts", "let x");
    expect(codeToTokens).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/syntax/tokenize.test.ts`
Expected: FAIL — cannot resolve `./tokenize`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/syntax/tokenize.ts
import { classForColor } from "./scopes";
import { langForPath } from "./langs";
import { SENTINEL_THEME_NAME, ensureLanguage, getHighlighter } from "./shiki";

/** A syntax range over ONE line, in that line's own coordinates. */
export interface SyntaxToken {
  start: number;
  end: number;
  cls: string;
}

export type SyntaxLine = SyntaxToken[];

/** Files past either guard render plain — highlighting is a nicety, not a feature. */
export const MAX_HIGHLIGHT_BYTES = 1_000_000;
export const MAX_HIGHLIGHT_LINES = 20_000;

interface RawToken {
  content: string;
  offset: number;
  color?: string;
}

/**
 * Rebase Shiki's DOCUMENT-absolute offsets to line-relative ranges, and resolve
 * sentinel colours to classes.
 *
 * The rebase is the whole point: `WordSpan` from wordDiff.ts is line-relative,
 * and buildLineSpans intersects the two. Leaving absolute offsets in would put
 * every line after the first out of range, silently yielding no spans.
 */
export function toLineRelative(lines: RawToken[][]): SyntaxLine[] {
  return lines.map((tokens) => {
    const base = tokens.length > 0 ? tokens[0].offset : 0;
    const out: SyntaxLine = [];
    for (const t of tokens) {
      const cls = classForColor(t.color);
      if (!cls) continue; // unscoped text renders unstyled
      const start = t.offset - base;
      out.push({ start, end: start + t.content.length, cls });
    }
    return out;
  });
}

/** djb2. Enough to detect content change for a cache key; not a checksum. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CACHE_MAX = 24;
const cache = new Map<string, SyntaxLine[]>();

export function clearSyntaxCache(): void {
  cache.clear();
}

function remember(key: string, value: SyntaxLine[]): SyntaxLine[] {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/**
 * Tokenize a whole file. Resolves null whenever highlighting is not available
 * or not worth it — unknown language, oversized input, or any Shiki failure.
 * Callers treat null as "render plain text".
 */
export async function tokenizeFile(
  path: string,
  text: string,
): Promise<SyntaxLine[] | null> {
  const lang = langForPath(path);
  if (!lang) return null;
  if (text.length > MAX_HIGHLIGHT_BYTES) return null;
  const lineCount = text.split("\n").length;
  if (lineCount > MAX_HIGHLIGHT_LINES) return null;

  const key = `${lang}:${hash(text)}:${text.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!(await ensureLanguage(lang))) return null;
  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(text, {
      lang,
      theme: SENTINEL_THEME_NAME,
    }) as { tokens: RawToken[][] };
    return remember(key, toLineRelative(tokens));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/syntax/tokenize.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntax/tokenize.ts src/lib/syntax/tokenize.test.ts
git commit -m "feat(syntax): tokenizeFile with line-relative ranges, guards and cache"
```

---

### Task 5: `useSyntax` hook

**Files:**
- Create: `src/lib/syntax/useSyntax.ts`, `src/lib/syntax/index.ts`
- Test: `src/lib/syntax/useSyntax.test.tsx`

**Interfaces:**
- Consumes: `tokenizeFile`, `SyntaxLine` (Task 4).
- Produces: `useSyntax(path: string | null, text: string | null): SyntaxLine[] | null`; barrel re-exporting `SyntaxLine`, `SyntaxToken`, `tokenizeFile`, `useSyntax`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/lib/syntax/useSyntax.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const tokenizeFile = vi.fn();
vi.mock("./tokenize", () => ({ tokenizeFile }));

import { useSyntax } from "./useSyntax";

function Probe({ path, text }: { path: string | null; text: string | null }) {
  const syntax = useSyntax(path, text);
  return <div data-testid="out">{syntax ? `lines:${syntax.length}` : "none"}</div>;
}

describe("useSyntax", () => {
  it("renders plain first, then upgrades when tokens resolve", async () => {
    let resolve: (v: unknown) => void = () => {};
    tokenizeFile.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Probe path="a.ts" text="let" />);
    expect(screen.getByTestId("out")).toHaveTextContent("none");
    resolve([[], []]);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:2"));
  });

  it("does not call the tokenizer without a path or text", () => {
    render(<Probe path={null} text="let" />);
    render(<Probe path="a.ts" text={null} />);
    expect(tokenizeFile).not.toHaveBeenCalled();
  });

  it("ignores a stale resolution after the input changed", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    tokenizeFile.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    tokenizeFile.mockResolvedValueOnce([[], [], []]);
    const { rerender } = render(<Probe path="a.ts" text="one" />);
    rerender(<Probe path="a.ts" text="two" />);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:3"));
    resolveFirst([[]]); // first request finishes late
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:3"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/syntax/useSyntax.test.tsx`
Expected: FAIL — cannot resolve `./useSyntax`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/syntax/useSyntax.ts
import React from "react";
import { tokenizeFile } from "./tokenize";
import type { SyntaxLine } from "./tokenize";

/**
 * Tokens for a file, or null while they are pending or unavailable.
 *
 * Deliberately never blocks first paint: the caller renders plain text on the
 * null, and re-renders with spans when this resolves. Span-ification does not
 * change row geometry, so there is no layout shift to hide behind a spinner.
 */
export function useSyntax(
  path: string | null,
  text: string | null,
): SyntaxLine[] | null {
  const [lines, setLines] = React.useState<SyntaxLine[] | null>(null);

  React.useEffect(() => {
    setLines(null);
    if (!path || text == null) return;
    let cancelled = false;
    tokenizeFile(path, text).then((result) => {
      if (!cancelled) setLines(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path, text]);

  return lines;
}
```

```ts
// src/lib/syntax/index.ts
export { tokenizeFile, type SyntaxLine, type SyntaxToken } from "./tokenize";
export { useSyntax } from "./useSyntax";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/syntax/useSyntax.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntax/useSyntax.ts src/lib/syntax/useSyntax.test.tsx src/lib/syntax/index.ts
git commit -m "feat(syntax): useSyntax hook with stale-result guarding"
```

---

### Task 6: `buildLineSpans` — where syntax and word diff meet

**Files:**
- Create: `src/lib/lineSpans.ts`
- Test: `src/lib/lineSpans.test.ts`

**Interfaces:**
- Consumes: `SyntaxToken` (Task 4), `WordSpan` from `@/lib/wordDiff` (`{ start, end, changed }`, already shipped).
- Produces: `interface RenderSpan { start: number; end: number; cls?: string; changed: boolean }`, `buildLineSpans(text, syntax, words): RenderSpan[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/lineSpans.test.ts
import { describe, expect, it } from "vitest";
import { buildLineSpans } from "./lineSpans";
import type { SyntaxToken } from "./syntax";
import type { WordSpan } from "./wordDiff";

const syn = (start: number, end: number, cls: string): SyntaxToken => ({ start, end, cls });
const word = (start: number, end: number, changed: boolean): WordSpan => ({ start, end, changed });

/** Every span concatenated must reproduce the line exactly — the tiling contract. */
function tiles(text: string, spans: { start: number; end: number }[]) {
  return spans.map((s) => text.slice(s.start, s.end)).join("");
}

describe("buildLineSpans", () => {
  it("returns one unstyled span when there is nothing to apply", () => {
    expect(buildLineSpans("abc", null, undefined)).toEqual([
      { start: 0, end: 3, cls: undefined, changed: false },
    ]);
  });

  it("returns an empty array for an empty line", () => {
    expect(buildLineSpans("", null, undefined)).toEqual([]);
  });

  it("carries syntax classes when there is no word diff", () => {
    const out = buildLineSpans("let x", [syn(0, 3, "syn-keyword")], undefined);
    expect(out).toEqual([
      { start: 0, end: 3, cls: "syn-keyword", changed: false },
      { start: 3, end: 5, cls: undefined, changed: false },
    ]);
    expect(tiles("let x", out)).toBe("let x");
  });

  it("carries changed flags when there is no syntax", () => {
    const out = buildLineSpans("ab", null, [word(0, 1, true), word(1, 2, false)]);
    expect(out).toEqual([
      { start: 0, end: 1, cls: undefined, changed: true },
      { start: 1, end: 2, cls: undefined, changed: false },
    ]);
  });

  it("splits at the union of both boundary sets", () => {
    // syntax 0-5 "syn-string"; word change 2-4. Expect 0-2, 2-4, 4-5.
    const out = buildLineSpans("abcde", [syn(0, 5, "syn-string")], [
      word(0, 2, false),
      word(2, 4, true),
      word(4, 5, false),
    ]);
    expect(out).toEqual([
      { start: 0, end: 2, cls: "syn-string", changed: false },
      { start: 2, end: 4, cls: "syn-string", changed: true },
      { start: 4, end: 5, cls: "syn-string", changed: false },
    ]);
    expect(tiles("abcde", out)).toBe("abcde");
  });

  it("tiles gaps between syntax tokens", () => {
    const out = buildLineSpans("a b", [syn(0, 1, "syn-var"), syn(2, 3, "syn-var")], undefined);
    expect(out.map((s) => [s.start, s.end, s.cls])).toEqual([
      [0, 1, "syn-var"],
      [1, 2, undefined],
      [2, 3, "syn-var"],
    ]);
    expect(tiles("a b", out)).toBe("a b");
  });

  it("clamps ranges that overrun the line and drops empty ones", () => {
    const out = buildLineSpans("ab", [syn(0, 99, "syn-type"), syn(5, 5, "syn-var")], undefined);
    expect(out).toEqual([{ start: 0, end: 2, cls: "syn-type", changed: false }]);
  });

  it("never emits a zero-width span", () => {
    const out = buildLineSpans("abc", [syn(1, 1, "syn-var")], [word(0, 0, true)]);
    for (const s of out) expect(s.end).toBeGreaterThan(s.start);
    expect(tiles("abc", out)).toBe("abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/lineSpans.test.ts`
Expected: FAIL — cannot resolve `./lineSpans`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/lineSpans.ts
//
// Syntax tokens and word-diff spans are two independent range sets over one
// line. This is the ONE place they reconcile, so every renderer becomes a flat
// spans.map() with no gap handling and no overlap reasoning.
//
// Output tiles the line: concatenating every span reproduces the text exactly.
// wordDiff.ts already guarantees that property for word spans alone; this keeps
// it once syntax joins in.
import type { SyntaxToken } from "./syntax";
import type { WordSpan } from "./wordDiff";

export interface RenderSpan {
  start: number;
  end: number;
  /** Syntax class, or undefined for text no grammar scoped. */
  cls?: string;
  /** True when the word diff marked this range as changed. */
  changed: boolean;
}

export function buildLineSpans(
  text: string,
  syntax: SyntaxToken[] | null,
  words: WordSpan[] | undefined,
): RenderSpan[] {
  const len = text.length;
  if (len === 0) return [];

  // Boundaries: line ends plus every edge of either input, clamped in range.
  const cuts = new Set<number>([0, len]);
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  for (const t of syntax ?? []) {
    cuts.add(clamp(t.start));
    cuts.add(clamp(t.end));
  }
  for (const w of words ?? []) {
    cuts.add(clamp(w.start));
    cuts.add(clamp(w.end));
  }
  const edges = [...cuts].sort((a, b) => a - b);

  const out: RenderSpan[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end <= start) continue; // duplicate edges collapse; never emit zero width
    // A segment lies wholly inside or wholly outside each input range, because
    // every range edge is a cut, so testing the midpoint is exact.
    const mid = (start + end) / 2;
    const tok = (syntax ?? []).find((t) => t.start <= mid && mid < t.end);
    const w = (words ?? []).find((s) => s.start <= mid && mid < s.end);
    out.push({ start, end, cls: tok?.cls, changed: w?.changed ?? false });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/lineSpans.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lineSpans.ts src/lib/lineSpans.test.ts
git commit -m "feat(diff): tile line spans from syntax tokens and word spans"
```

---

### Task 7: The `--syn-*` palette

**Files:**
- Modify: `src/index.css` (add `--syn-*` next to the other `:root` tokens; delete the `.hljs-*` block at `src/index.css:272` onward)
- Modify: `src/features/settings/useSettingsStore.ts` (`SEMANTIC_TOKENS` is at `:328`, `SELECTION_TOKENS` at `:403`, `applyTheme` at `:417`)
- Test: `src/features/settings/useSettingsStore.test.ts`

**Interfaces:**
- Consumes: `SYN_TOKENS` (Task 1) — the variable names must match `--syn-<token>` for every entry.
- Produces: `--syn-keyword|string|number|comment|func|type|var|punct|tag|attr|regexp|meta` on `:root`, plus `.syn-*` rules that read them.

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/useSettingsStore.test.ts`:

```ts
import { SYN_TOKENS } from "@/lib/syntax/scopes";

describe("syntax palette", () => {
  it("writes every --syn-* token for a dark theme", () => {
    applyTheme({ ...DARK_THEME_FIXTURE, mode: "dark" });
    for (const t of SYN_TOKENS) {
      const v = document.documentElement.style.getPropertyValue(`--syn-${t}`);
      expect(v, `--syn-${t}`).not.toBe("");
    }
  });

  it("writes a different calibration for light mode", () => {
    applyTheme({ ...DARK_THEME_FIXTURE, mode: "dark" });
    const darkKeyword = document.documentElement.style.getPropertyValue("--syn-keyword");
    applyTheme({ ...LIGHT_THEME_FIXTURE, mode: "light" });
    const lightKeyword = document.documentElement.style.getPropertyValue("--syn-keyword");
    expect(lightKeyword).not.toBe(darkKeyword);
  });
});
```

Reuse whatever theme fixtures the file already defines; if it builds themes inline, follow that style instead of inventing `*_FIXTURE` names.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/settings/useSettingsStore.test.ts`
Expected: FAIL — `--syn-keyword` is `""`.

- [ ] **Step 3: Add `SYNTAX_TOKENS` and write them in `applyTheme`**

In `src/features/settings/useSettingsStore.ts`, after `SELECTION_TOKENS`:

```ts
/**
 * Syntax palette, per theme MODE. Light is calibrated on its own rather than
 * inherited: dark-calibrated syntax colours over a light canvas wash out exactly
 * like the diff and graph tokens did (#61 B4).
 *
 * The dark column is byte-identical to the :root defaults in index.css. Edit
 * both or they drift.
 */
const SYNTAX_TOKENS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--syn-keyword": "#ff7b72",
    "--syn-string": "#a5d6ff",
    "--syn-number": "#79c0ff",
    "--syn-comment": "#8b949e",
    "--syn-func": "#d2a8ff",
    "--syn-type": "#7ee787",
    "--syn-var": "#ffa657",
    "--syn-punct": "#c9d1d9",
    "--syn-tag": "#7ee787",
    "--syn-attr": "#79c0ff",
    "--syn-regexp": "#7ee787",
    "--syn-meta": "#d2a8ff",
  },
  light: {
    "--syn-keyword": "#cf222e",
    "--syn-string": "#0a3069",
    "--syn-number": "#0550ae",
    "--syn-comment": "#57606a",
    "--syn-func": "#8250df",
    "--syn-type": "#116329",
    "--syn-var": "#953800",
    "--syn-punct": "#1f2328",
    "--syn-tag": "#116329",
    "--syn-attr": "#0550ae",
    "--syn-regexp": "#116329",
    "--syn-meta": "#8250df",
  },
};
```

In `applyTheme`, next to the existing loops (around `:445`):

```ts
  for (const [token, value] of Object.entries(SYNTAX_TOKENS[mode])) {
    root.style.setProperty(token, value);
  }
```

- [ ] **Step 4: Add the `:root` defaults and `.syn-*` rules to `src/index.css`**

Add beside the other token declarations:

```css
  /* Syntax palette. Pre-hydration defaults only — applyTheme() is the source of
     truth and its `dark` column must stay byte-identical to these. */
  --syn-keyword: #ff7b72;
  --syn-string: #a5d6ff;
  --syn-number: #79c0ff;
  --syn-comment: #8b949e;
  --syn-func: #d2a8ff;
  --syn-type: #7ee787;
  --syn-var: #ffa657;
  --syn-punct: #c9d1d9;
  --syn-tag: #7ee787;
  --syn-attr: #79c0ff;
  --syn-regexp: #7ee787;
  --syn-meta: #d2a8ff;
```

And, replacing the deleted `.hljs-*` block:

```css
.syn-keyword { color: var(--syn-keyword); }
.syn-string { color: var(--syn-string); }
.syn-number { color: var(--syn-number); }
.syn-comment { color: var(--syn-comment); font-style: italic; }
.syn-func { color: var(--syn-func); }
.syn-type { color: var(--syn-type); }
.syn-var { color: var(--syn-var); }
.syn-punct { color: var(--syn-punct); }
.syn-tag { color: var(--syn-tag); }
.syn-attr { color: var(--syn-attr); }
.syn-regexp { color: var(--syn-regexp); }
.syn-meta { color: var(--syn-meta); }
```

Leave the `.hljs-*` deletion until Task 9, when the last consumer goes; deleting it here would strip the preview's colors for two tasks.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/settings/useSettingsStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/features/settings/useSettingsStore.ts src/features/settings/useSettingsStore.test.ts
git commit -m "feat(theme): --syn-* syntax palette written per theme mode"
```

---

### Task 8: Rewrite `DiffText` on `buildLineSpans`

**Files:**
- Modify: `src/design/git-components.tsx` — `DiffLineData` at `:490`, `PGDiffLine` at `:510`, `DiffText` at `:691`, `PGHunk` at `:890`
- Test: `src/design/wordDiffRender.test.tsx` (exists — must pass **unchanged**), plus a new `src/design/syntaxRender.test.tsx`

**Interfaces:**
- Consumes: `buildLineSpans`, `RenderSpan` (Task 6), `SyntaxLine` (Task 4).
- Produces: `DiffLineData.syntax?: SyntaxToken[]` — per-line syntax tokens, set by the owning screen; `PGHunkProps.syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/design/syntaxRender.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGHunk } from "./git-components";
import type { DiffLineData } from "./git-components";

const line = (o: Partial<DiffLineData> & { kind: DiffLineData["kind"] }): DiffLineData => ({
  text: "",
  ...o,
});

describe("syntax spans in diff rows", () => {
  it("wraps scoped ranges in a classed span", () => {
    render(
      <PGHunk
        header="-1 +1"
        lines={[
          line({
            kind: "ctx",
            text: "let x",
            lnL: 1,
            lnR: 1,
            syntax: [{ start: 0, end: 3, cls: "syn-keyword" }],
          }),
        ]}
      />,
    );
    const kw = document.querySelector(".syn-keyword");
    expect(kw).not.toBeNull();
    expect(kw).toHaveTextContent("let");
  });

  it("still renders the full line text when syntax is absent", () => {
    render(<PGHunk header="-1 +1" lines={[line({ kind: "ctx", text: "plain text", lnL: 1 })]} />);
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });

  it("combines a syntax class and a word-change mark on one range", () => {
    // A changed range inside a scoped range must carry both.
    render(
      <PGHunk
        header="-1 +1"
        lines={[
          line({ kind: "rem", text: "let a", lnL: 1 }),
          line({ kind: "add", text: "let b", lnR: 1 }),
        ]}
        syntax={{
          old: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
          new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
        }}
      />,
    );
    expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("word-change").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run both suites to verify the new one fails and the old one passes**

Run: `pnpm vitest run src/design/syntaxRender.test.tsx src/design/wordDiffRender.test.tsx`
Expected: `syntaxRender` FAILS (no `.syn-keyword`); `wordDiffRender` PASSES.

- [ ] **Step 3: Implement**

Add to `DiffLineData` (at `:490`):

```ts
  /**
   * Per-line syntax tokens, line-relative. Set by the owning screen from
   * useSyntax; undefined means "render this line unhighlighted".
   */
  syntax?: SyntaxToken[];
```

Replace `DiffText` (at `:691`) with:

```tsx
/**
 * Render one line as spans, combining syntax classes and word-diff emphasis.
 *
 * Both come from buildLineSpans, which tiles the line — so this maps and never
 * reasons about gaps or overlaps. The changed-span tint stays relative to the
 * existing git tokens so custom and light themes carry through.
 */
function DiffText({
  text,
  spans,
  syntax,
  kind,
}: {
  text: string;
  spans?: WordSpan[];
  syntax?: SyntaxToken[];
  kind: DiffLineKind;
}) {
  const rendered = React.useMemo(
    () => buildLineSpans(text, syntax ?? null, spans),
    [text, syntax, spans],
  );
  // Nothing to mark: emit the bare string so the DOM stays as light as before.
  if (rendered.length <= 1 && !rendered[0]?.cls && !rendered[0]?.changed) {
    return <>{text}</>;
  }
  const tint =
    kind === "add"
      ? "oklch(from var(--git-added) l c h / 0.28)"
      : "oklch(from var(--git-removed) l c h / 0.28)";
  return (
    <>
      {rendered.map((s, i) => (
        <span
          key={i}
          className={s.cls}
          data-testid={s.changed ? "word-change" : undefined}
          style={s.changed ? { background: tint, borderRadius: 2 } : undefined}
        >
          {text.slice(s.start, s.end)}
        </span>
      ))}
    </>
  );
}
```

Thread `syntax` into rows. In `PGHunkProps` add:

```ts
  /**
   * Per-side syntax tokens for the whole file, indexed by line number - 1. A
   * `rem` row reads `old`, `add` and `ctx` rows read `new` — see the spec's
   * side table. Absent or short arrays simply render plain.
   */
  syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
```

In `PGHunk`, extend the existing memo so rows carry their tokens. Keep `withChangedIndices` first — it must number the whole hunk before anything else touches the rows:

```ts
  const chunks = React.useMemo(() => {
    const withTokens = withChangedIndices(lines).map((l) => {
      if (!syntax) return l;
      const side = l.kind === "rem" ? syntax.old : syntax.new;
      const lineNo = l.kind === "rem" ? l.lnL : (l.lnR ?? l.lnL);
      const n = typeof lineNo === "number" ? lineNo : Number(lineNo);
      if (!side || !Number.isFinite(n) || n < 1) return l;
      return { ...l, syntax: side[n - 1] };
    });
    return withWordSpans(chunkDiffLines(withTokens));
  }, [lines, syntax]);
```

Pass `syntax={ln.syntax}` at the `DiffText` call site (`:857`), and add the same prop to standalone `PGDiffLine` so single-row callers can use it.

- [ ] **Step 4: Run both suites to verify they pass**

Run: `pnpm vitest run src/design/syntaxRender.test.tsx src/design/wordDiffRender.test.tsx`
Expected: both PASS. If `wordDiffRender` needed editing to pass, the rewrite changed behavior — revert and fix the implementation instead.

- [ ] **Step 5: Commit**

```bash
git add src/design/git-components.tsx src/design/syntaxRender.test.tsx
git commit -m "feat(diff): render syntax and word-diff spans from one tiling builder"
```

---

### Task 9: Wire the unified diff, Blame, and the preview; drop highlight.js

**Files:**
- Modify: `src/screens/DiffViewer.tsx` (diff fetch effect at `:81-113`)
- Modify: `src/screens/CommitPanel.tsx` (its `PGHunk` render)
- Modify: `src/screens/Blame.tsx:58-70`
- Modify: `src/screens/RepoBrowser.tsx:50` (import), `:1179` (`highlightFile` call), `:1194` (`className="hljs"`)
- Modify: `src/index.css` — delete the `.hljs-*` block (`:272` onward)
- Modify: `package.json` — remove `highlight.js`
- Delete: `src/lib/highlight.ts`
- Test: `src/screens/DiffViewer.syntax.test.tsx`

**Interfaces:**
- Consumes: `useSyntax` (Task 5), `PGHunkProps.syntax` (Task 8), `readFileContent`/`readFileContentAtRev` from `@/lib/tauri`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/DiffViewer.syntax.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { mockInvoke } from "@/test/invokeMock";
import { DiffViewerScreen } from "./DiffViewer";

// A fake tokenizer keeps this about wiring, not grammars: every line gets one
// keyword token covering its first three characters.
vi.mock("@/lib/syntax", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax")>()),
  tokenizeFile: async (_path: string, text: string) =>
    text.split("\n").map(() => [{ start: 0, end: 3, cls: "syn-keyword" }]),
}));

describe("DiffViewer syntax", () => {
  it("reads both sides and highlights diff rows", async () => {
    const revs: string[] = [];
    mockInvoke("get_status", () => [
      { path: "a.ts", index: { kind: "Unmodified" }, worktree: { kind: "Modified" } },
    ]);
    mockInvoke("get_diff", () => ({
      path: "a.ts",
      binary: false,
      additions: 1,
      deletions: 1,
      hunks: [
        {
          header: "@@ -1 +1 @@",
          lines: [
            { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "let a" },
            { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "let b" },
          ],
        },
      ],
    }));
    mockInvoke("read_file_content", () => ({
      path: "a.ts", binary: false, text: "let b", fromHead: false, size: 5,
    }));
    mockInvoke("read_file_content_at_rev", (args: { revspec: string }) => {
      revs.push(args.revspec);
      return { path: "a.ts", binary: false, text: "let a", fromHead: true, size: 5 };
    });

    render(<DiffViewerScreen />);
    await waitFor(() =>
      expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0),
    );
    expect(revs).toContain("HEAD");
  });
});
```

The store may need a repo in state before the screen fetches; follow whatever pattern the existing `src/screens/*.test.tsx` files use to seed `useRepoStore`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/screens/DiffViewer.syntax.test.tsx`
Expected: FAIL — no `.syn-keyword` nodes.

- [ ] **Step 3: Implement DiffViewer**

Alongside the existing diff effect, fetch both texts for the selected path and pass tokens down:

```tsx
  const [sides, setSides] = React.useState<{ old: string | null; new: string | null }>({
    old: null,
    new: null,
  });

  React.useEffect(() => {
    if (!repo || !current || current.embedded) {
      setSides({ old: null, new: null });
      return;
    }
    let cancelled = false;
    // Whole-file text per side, because a hunk is a window: a block comment
    // opening above it would mis-colour everything below.
    Promise.all([
      readFileContentAtRev(repo.id, "HEAD", current.path).catch(() => null),
      readFileContent(repo.id, current.path).catch(() => null),
    ]).then(([o, n]) => {
      if (!cancelled) setSides({ old: o?.text ?? null, new: n?.text ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, current?.path, current?.embedded]);

  const oldSyntax = useSyntax(current?.path ?? null, sides.old);
  const newSyntax = useSyntax(current?.path ?? null, sides.new);
  const syntax = React.useMemo(
    () => ({ old: oldSyntax, new: newSyntax }),
    [oldSyntax, newSyntax],
  );
```

Pass `syntax={syntax}` to each `PGHunk` in the unified branch (`:361`). Leave the split branch alone — PR2 owns it.

- [ ] **Step 4: Implement CommitPanel the same way**

CommitPanel diffs the same worktree-vs-HEAD pair, so the effect and the two `useSyntax` calls are identical; pass `syntax` to its `PGHunk`s. Do not extract a shared hook yet — PR2 adds the third and fourth call sites and that is the moment to.

- [ ] **Step 5: Implement Blame**

Blame already holds the whole file as `lines`. Tokenize once and render spans:

```tsx
  const syntax = useSyntax(path, lines.map((l) => l.content).join("\n"));
```

Render each row's text through `buildLineSpans(l.content, syntax?.[i] ?? null, undefined)`, mapping to `<span className={s.cls}>`.

- [ ] **Step 6: Implement the RepoBrowser preview and delete highlight.js**

Replace the `highlightFile` memo (`:1179`) with `useSyntax(path, text)` and render per-line spans through `buildLineSpans`, dropping `className="hljs"` (`:1194`). Then:

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm remove highlight.js
git rm src/lib/highlight.ts
```

Delete the `.hljs-*` block from `src/index.css:272` onward, and confirm nothing references it:

```bash
grep -rn "hljs\|highlight.js\|lib/highlight" src/ || echo "clean"
```

- [ ] **Step 7: Run the full front-end gate**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm tsc --noEmit
pnpm test
```
Expected: type-check clean; all suites pass, including the untouched `wordDiffRender.test.tsx`.

- [ ] **Step 8: Run the affected e2e specs in Docker**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/history-diff.e2e.ts
```
Expected: PASS. Never run e2e natively.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(diff): highlight unified diff, blame and preview with shiki

Why: retires the highlight.js HTML-string path, which could not compose with
word-diff spans. Whole-file tokens per side, because a hunk is a window into a
file and a construct opening above it would mis-colour the rest."
```

---

## Self-Review

**Spec coverage.** `lib/syntax/` (Tasks 1-5), palette (7), `buildLineSpans` (6), `DiffText` rewrite (8), unified diff + Blame + preview + highlight.js removal (9), verified Shiki contract honored in Tasks 1/3/4 (upper-cased colors, absolute offsets, `ShikiError`, explicit loader map). Deferred to PR2 by design: `pairChangedLines`, split view, `CommitDiffPanel`, merge window. Deferred to PR3: windowing. The spec's side table is implemented in Task 8's memo and asserted in Task 9's test.

**Placeholders.** None: every code step carries the actual code, and the two "follow the existing pattern" notes (theme fixtures in Task 7, repo-store seeding in Task 9) point at named files rather than standing in for logic.

**Type consistency.** `SyntaxToken {start, end, cls}` (Task 4) is what `buildLineSpans` consumes (6), what `DiffLineData.syntax` holds (8), and what the Task 9 mock returns. `SyntaxLine = SyntaxToken[]` is the element type of the `PGHunkProps.syntax.old/new` arrays. `WordSpan {start, end, changed}` matches the shipped `src/lib/wordDiff.ts`. `classForColor` returns `syn-<token>`, which is exactly the class the CSS in Task 7 defines and the tests in Task 8 query.
