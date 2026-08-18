// The one Shiki instance. Created lazily on first tokenize so app start pays
// nothing, and shared so grammars register once.
//
// engine-javascript rather than the default WASM Oniguruma engine: it avoids
// shipping and fetching a .wasm asset through the Tauri custom protocol. The
// RAW variant specifically, because every grammar in langs.ts comes from
// @shikijs/langs-precompiled: the regexes are native JS RegExp already, so the
// per-pattern oniguruma-to-es translation (and its bundle weight) is skipped
// entirely. The raw engine only accepts precompiled grammars — a plain
// shiki/langs grammar must not be loaded through it, which langs.ts guarantees
// by importing exclusively from the precompiled package.
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRawEngine } from "shiki/engine/javascript";
import { SENTINEL_THEME } from "./scopes";
import { LANG_LOADERS, type ShikiLang } from "./langs";

export const SENTINEL_THEME_NAME = "pg-sentinel";

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [SENTINEL_THEME],
    langs: [],
    engine: createJavaScriptRawEngine(),
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
