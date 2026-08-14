// The shapes and pure transforms syntax tokens travel in.
//
// Deliberately free of any Shiki import: this module is what the MAIN thread
// loads eagerly, and pulling Shiki in here would put the whole highlighter in the
// main bundle purely to serve a fallback that normally never runs. The Shiki call
// itself lives in tokenizeShiki.ts, which the worker imports and the main thread
// only imports dynamically if the worker turns out to be unavailable.
//
// Worker-safe by construction: nothing here touches the DOM, React, or Tauri.
import { classForColor } from "./scopes";
import { langForPath } from "./langs";

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

/** One token as Shiki hands it back, before offsets are rebased. */
export interface RawToken {
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

/**
 * Tokens flattened into transferable arrays.
 *
 * Two Int32Arrays plus a small string table, so the payload is transferred
 * zero-copy instead of structured-cloning one object per token. Materializing it
 * back is one tight pass with no per-object allocation from the clone algorithm.
 */
export interface PackedSyntax {
  /** Distinct class names. `data` stores indices into this. */
  classes: string[];
  /** length = lineCount + 1. Token-triple index where each line starts. */
  lineStarts: Int32Array;
  /** Flat [start, end, classId] triples. */
  data: Int32Array;
}

export function packLines(lines: SyntaxLine[]): PackedSyntax {
  const classes: string[] = [];
  const ids = new Map<string, number>();
  let total = 0;
  for (const l of lines) total += l.length;
  const data = new Int32Array(total * 3);
  const lineStarts = new Int32Array(lines.length + 1);
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = t;
    for (const tok of lines[i]) {
      let id = ids.get(tok.cls);
      if (id === undefined) {
        id = classes.length;
        classes.push(tok.cls);
        ids.set(tok.cls, id);
      }
      data[t * 3] = tok.start;
      data[t * 3 + 1] = tok.end;
      data[t * 3 + 2] = id;
      t++;
    }
  }
  lineStarts[lines.length] = t;
  return { classes, lineStarts, data };
}

export function unpackLines(p: PackedSyntax): SyntaxLine[] {
  const out: SyntaxLine[] = [];
  for (let i = 0; i + 1 < p.lineStarts.length; i++) {
    const line: SyntaxLine = [];
    for (let t = p.lineStarts[i]; t < p.lineStarts[i + 1]; t++) {
      line.push({
        start: p.data[t * 3],
        end: p.data[t * 3 + 1],
        cls: p.classes[p.data[t * 3 + 2]],
      });
    }
    out.push(line);
  }
  return out;
}

/** True when the file is one this will not highlight, before any Shiki work. */
export function skipHighlight(path: string, text: string): boolean {
  if (!langForPath(path)) return true;
  if (text.length > MAX_HIGHLIGHT_BYTES) return true;
  return text.split("\n").length > MAX_HIGHLIGHT_LINES;
}
