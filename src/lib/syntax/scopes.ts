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
