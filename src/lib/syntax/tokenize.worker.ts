/// <reference lib="webworker" />
// Syntax tokenization runs HERE, not on the main thread.
//
// Shiki's codeToTokens is synchronous CPU work. Awaiting it on the main thread —
// which is what this replaces — still ran it to completion there, so selecting a
// file and immediately moving to another janked for the first file's whole cost,
// and the "cancelled" flag only threw the answer away afterwards. Off-thread, the
// UI stays responsive whether or not anyone still wants the result.
//
// Shiki is configured with engine-javascript (no WASM asset to fetch through the
// Tauri custom protocol), so it is pure JS and safe to run here.
import { tokenizeToPacked } from "./tokenizeShiki";
import type { PackedSyntax } from "./tokenizeCore";

export interface TokenizeRequest {
  id: number;
  path: string;
  text: string;
}

export interface TokenizeReply {
  id: number;
  packed: PackedSyntax | null;
}

self.onmessage = async (e: MessageEvent<TokenizeRequest>) => {
  const { id, path, text } = e.data;
  const packed = await tokenizeToPacked(path, text);
  const reply: TokenizeReply = { id, packed };
  // Transfer the buffers rather than copying them across.
  const transfer: Transferable[] = packed
    ? [packed.lineStarts.buffer, packed.data.buffer]
    : [];
  (self as unknown as Worker).postMessage(reply, transfer);
};
