// Main-thread entry point for syntax tokens: cache, worker client, fallback.
//
// The heavy work lives in tokenizeCore.ts and normally runs in tokenize.worker.ts.
// This module's job is to keep `tokenizeFile`'s contract unchanged — same
// signature, same "null means render plain" rule — so useSyntax, useDiffSyntax and
// their tests did not have to learn about any of it.
import {
  skipHighlight,
  unpackLines,
  type PackedSyntax,
  type SyntaxLine,
} from "./tokenizeCore";
import { langForPath } from "./langs";
import type { TokenizeReply, TokenizeRequest } from "./tokenize.worker";

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

// undefined = not tried yet, null = unavailable, so fall back to this thread.
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (p: PackedSyntax | null) => void>();

/**
 * Give up on the worker and answer everyone still waiting.
 *
 * Reached by a failed script load or a worker crash. Leaving the pending
 * promises unresolved would hang every caller forever, so they are resolved
 * null — with `worker` now null, `tokenizeFile` retries them on this thread.
 */
function disableWorker(): void {
  worker?.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const resolve of waiting) resolve(null);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL("./tokenize.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<TokenizeReply>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data.packed);
      }
    };
    // Degrading to the main thread means the worst case is the behaviour this
    // replaced, never a diff with no highlighting at all.
    w.onerror = disableWorker;
    w.onmessageerror = disableWorker;
    worker = w;
  } catch {
    // No Worker constructor at all — jsdom in the component tests, and any
    // webview where module workers are unavailable.
    worker = null;
  }
  return worker;
}

/**
 * Tokenize a whole file. Resolves null whenever highlighting is not available
 * or not worth it — callers treat null as "render plain text".
 *
 * Results are cached on THIS thread, so a repeat never crosses the boundary and
 * a re-render never re-tokenizes.
 */
export async function tokenizeFile(
  path: string,
  text: string,
): Promise<SyntaxLine[] | null> {
  const lang = langForPath(path);
  // Guards run here as well as in the core so an oversized or unknown file costs
  // no worker round trip.
  if (!lang || skipHighlight(path, text)) return null;

  const key = `${lang}:${hash(text)}:${text.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = getWorker();
  let packed: PackedSyntax | null = null;
  if (w) {
    const id = nextId++;
    packed = await new Promise<PackedSyntax | null>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, path, text } satisfies TokenizeRequest);
    });
  }
  // Only when there is no worker to ask. Note the asymmetry: `!worker` is true
  // only after disableWorker ran (or construction failed), so a legitimate null —
  // unknown grammar, Shiki failure — is NOT retried on the main thread.
  //
  // Imported dynamically so Shiki stays out of the main bundle on the normal path.
  if (!packed && !worker) {
    const { tokenizeToPacked } = await import("./tokenizeShiki");
    packed = await tokenizeToPacked(path, text);
  }
  if (!packed) return null;
  return remember(key, unpackLines(packed));
}

export {
  toLineRelative,
  packLines,
  unpackLines,
  skipHighlight,
  MAX_HIGHLIGHT_BYTES,
  MAX_HIGHLIGHT_LINES,
  type PackedSyntax,
  type SyntaxLine,
  type SyntaxToken,
} from "./tokenizeCore";
