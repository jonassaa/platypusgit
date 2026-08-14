// The worker client: the path production actually takes.
//
// jsdom has no Worker, so the rest of the suite exercises the main-thread
// fallback. That left the DEFAULT path untested — and a wrong message protocol
// there fails silently, returning null and quietly dropping highlighting
// everywhere. These tests drive the client against a fake Worker.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sentinelFor } from "./scopes";
import { packLines, type SyntaxLine } from "./tokenizeCore";

// Reached only by the fallback; the worker paths must never call it.
const codeToTokens = vi.fn();
vi.mock("./shiki", () => ({
  SENTINEL_THEME_NAME: "pg-sentinel",
  getHighlighter: async () => ({ codeToTokens }),
  ensureLanguage: async () => true,
}));

const KW = sentinelFor("keyword").toUpperCase();
const TOKENS: SyntaxLine[] = [[{ start: 0, end: 3, cls: "syn-keyword" }]];

// The module caches its Worker in module scope, so each test needs a fresh one.
async function freshTokenize() {
  vi.resetModules();
  return await import("./tokenize");
}

interface Req {
  id: number;
  path: string;
  text: string;
}

/** Answers like the real worker: asynchronously, echoing the request id. */
class FakeWorker {
  static requests: Req[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(req: Req) {
    FakeWorker.requests.push(req);
    setTimeout(() => {
      this.onmessage?.({
        data: { id: req.id, packed: packLines(TOKENS) },
      } as MessageEvent);
    }, 0);
  }
  terminate() {}
}

/** Fails the way a worker whose script will not load does. */
class BrokenWorker extends FakeWorker {
  postMessage() {
    setTimeout(() => this.onerror?.(), 0);
  }
}

beforeEach(() => {
  codeToTokens.mockReset();
  codeToTokens.mockReturnValue({
    tokens: [[{ content: "let", offset: 0, color: KW }]],
  });
  FakeWorker.requests = [];
});

describe("tokenize worker client", () => {
  it("returns the worker's tokens without tokenizing on this thread", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { tokenizeFile } = await freshTokenize();
    expect(await tokenizeFile("a.ts", "let")).toEqual(TOKENS);
    // The whole point: the main thread never ran the grammar.
    expect(codeToTokens).not.toHaveBeenCalled();
    expect(FakeWorker.requests).toHaveLength(1);
    expect(FakeWorker.requests[0]).toMatchObject({ path: "a.ts", text: "let" });
  });

  it("gives each request a distinct id so replies cannot be mismatched", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { tokenizeFile } = await freshTokenize();
    await Promise.all([tokenizeFile("a.ts", "let"), tokenizeFile("a.ts", "let x")]);
    const ids = FakeWorker.requests.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves a repeat from the cache instead of the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { tokenizeFile } = await freshTokenize();
    await tokenizeFile("a.ts", "let");
    await tokenizeFile("a.ts", "let");
    expect(FakeWorker.requests).toHaveLength(1);
  });

  it("never asks the worker about a file it would not highlight", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { tokenizeFile } = await freshTokenize();
    expect(await tokenizeFile("LICENSE", "x")).toBeNull();
    expect(FakeWorker.requests).toHaveLength(0);
  });

  it("falls back to this thread when there is no Worker at all", async () => {
    vi.stubGlobal("Worker", undefined);
    const { tokenizeFile } = await freshTokenize();
    expect(await tokenizeFile("a.ts", "let")).toEqual(TOKENS);
    expect(codeToTokens).toHaveBeenCalled();
  });

  // Without this, a crashing worker leaves the promise unresolved and every
  // caller waits forever — a hung diff pane rather than an unhighlighted one.
  it("answers a pending request and falls back when the worker errors", async () => {
    vi.stubGlobal("Worker", BrokenWorker);
    const { tokenizeFile } = await freshTokenize();
    expect(await tokenizeFile("a.ts", "let")).toEqual(TOKENS);
    expect(codeToTokens).toHaveBeenCalled();
  });
});
