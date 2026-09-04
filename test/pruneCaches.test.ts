/**
 * Guards for `scripts/prune-actions-caches.mjs` — the only script in this repo
 * whose job is to DELETE things.
 *
 * The failure that matters is not "it pruned too little"; it is pruning the
 * cache of the release that is building right now, which turns a 6-minute job
 * into an 11-minute one and leaves no trace of why. Two shapes make that easy
 * to get wrong and are pinned here:
 *
 *   1. GitHub reports a tag cache's ref as `refs/heads/refs/tags/v0.6.0` —
 *      `refs/heads/` glued onto an already-qualified ref. Read naively that is
 *      a BRANCH named `refs/tags/v0.6.0`, which exists nowhere, so every rule
 *      that asks "does this branch still exist" condemns the live release.
 *   2. Generation pruning must keep the NEWEST entry. The newest is not the
 *      biggest: measured on this repo, the current generation of
 *      `v0-rust-build-Linux-x64` was 828 MB while the superseded one was
 *      1662 MB, because a fresh entry is written from a partial restore.
 */
import { describe, expect, it } from "vitest";

import {
  classifyRef,
  newestCachedTag,
  planPrune,
  // @ts-expect-error — plain .mjs with JSDoc types, no .d.ts
} from "../scripts/prune-actions-caches.mjs";

type Cache = {
  id: number;
  ref: string;
  key: string;
  size_in_bytes: number;
  created_at: string;
};

let nextId = 1;
const cache = (ref: string, key: string, created_at: string, mb = 100): Cache => ({
  id: nextId++,
  ref,
  key,
  size_in_bytes: mb * 1024 * 1024,
  created_at,
});

const plan = (caches: Cache[], live: string[] = ["main"], prs: string[] = []) =>
  planPrune(caches, {
    liveBranches: new Set(live),
    openPrs: new Set(prs),
  }) as { cache: Cache; reason: string }[];

const deletedKeys = (...args: Parameters<typeof plan>) =>
  plan(...args)
    .map((d) => d.cache.key)
    .sort();

describe("classifyRef", () => {
  it("unwraps the doubled prefix GitHub puts on a tag cache", () => {
    expect(classifyRef("refs/heads/refs/tags/v0.6.0")).toEqual({
      kind: "tag",
      name: "v0.6.0",
    });
  });

  it("reads a branch and a pull ref", () => {
    expect(classifyRef("refs/heads/main")).toEqual({ kind: "branch", name: "main" });
    expect(classifyRef("refs/heads/fix/some-thing")).toEqual({
      kind: "branch",
      name: "fix/some-thing",
    });
    expect(classifyRef("refs/pull/391/merge")).toEqual({ kind: "pr", name: "391" });
  });
});

describe("newestCachedTag", () => {
  it("is the tag that most recently wrote a cache, not the highest version", () => {
    const caches = [
      cache("refs/heads/refs/tags/v0.10.0", "k1", "2026-01-01T00:00:00Z"),
      cache("refs/heads/refs/tags/v0.9.0", "k2", "2026-06-01T00:00:00Z"),
      cache("refs/heads/main", "k3", "2026-07-01T00:00:00Z"),
    ];
    expect(newestCachedTag(caches)).toBe("v0.9.0");
  });

  it("is null when no tag has a cache", () => {
    expect(newestCachedTag([cache("refs/heads/main", "k", "2026-01-01T00:00:00Z")])).toBeNull();
  });
});

describe("planPrune", () => {
  it("keeps the newest tag's caches and drops older tags'", () => {
    const caches = [
      cache("refs/heads/refs/tags/v0.5.0", "v0-rust-linux-Linux-x64-aaa-bbb", "2026-08-01T00:00:00Z"),
      cache("refs/heads/refs/tags/v0.6.0", "v0-rust-linux-Linux-x64-ccc-ddd", "2026-09-01T00:00:00Z"),
    ];
    expect(deletedKeys(caches)).toEqual(["v0-rust-linux-Linux-x64-aaa-bbb"]);
  });

  it("never condemns the live release because its ref is not a branch", () => {
    // The regression this exists for: with `refs/heads/` stripped naively,
    // `refs/tags/v0.6.0` looks like a missing branch.
    const caches = [cache("refs/heads/refs/tags/v0.6.0", "v0-rust-msix-x-1-2", "2026-09-01T00:00:00Z")];
    expect(plan(caches, ["main"])).toEqual([]);
  });

  it("drops caches for a branch that no longer exists, and keeps live ones", () => {
    const caches = [
      cache("refs/heads/gone", "v0-rust-build-Linux-x64-a-b", "2026-09-01T00:00:00Z"),
      cache("refs/heads/alive", "v0-rust-build-Linux-x64-c-d", "2026-09-01T00:00:00Z"),
      cache("refs/heads/main", "v0-rust-build-Linux-x64-e-f", "2026-09-01T00:00:00Z"),
    ];
    expect(deletedKeys(caches, ["main", "alive"])).toEqual(["v0-rust-build-Linux-x64-a-b"]);
  });

  it("drops a closed PR's caches and keeps an open one's", () => {
    const caches = [
      cache("refs/pull/1/merge", "node-cache-Linux-x64-pnpm-a", "2026-09-01T00:00:00Z"),
      cache("refs/pull/2/merge", "node-cache-Linux-x64-pnpm-b", "2026-09-01T00:00:00Z"),
    ];
    expect(deletedKeys(caches, ["main"], ["2"])).toEqual(["node-cache-Linux-x64-pnpm-a"]);
  });

  it("keeps the NEWEST rust generation even when an older one is far larger", () => {
    const caches = [
      cache("refs/heads/main", "v0-rust-build-Linux-x64-old-84d0", "2026-09-01T12:09:35Z", 1662),
      cache("refs/heads/main", "v0-rust-build-Linux-x64-new-84d0", "2026-09-03T13:19:24Z", 828),
    ];
    expect(deletedKeys(caches)).toEqual(["v0-rust-build-Linux-x64-old-84d0"]);
  });

  it("scopes a family by ref, so main's copy and a tag's do not evict each other", () => {
    const caches = [
      cache("refs/heads/main", "v0-rust-linux-Linux-x64-a-b", "2026-09-01T00:00:00Z"),
      cache("refs/heads/refs/tags/v0.6.0", "v0-rust-linux-Linux-x64-c-d", "2026-09-03T00:00:00Z"),
    ];
    expect(plan(caches)).toEqual([]);
  });

  it("keeps two codeql generations and two node generations", () => {
    const codeql = (sha: string, at: string) =>
      cache("refs/heads/main", `codeql-overlay-base-database-1-h-javascript-2.26.4-${sha}-99-1`, at);
    const caches = [
      codeql("aaa", "2026-09-01T00:00:00Z"),
      codeql("bbb", "2026-09-02T00:00:00Z"),
      codeql("ccc", "2026-09-03T00:00:00Z"),
    ];
    // Newest two survive; the oldest goes.
    expect(deletedKeys(caches)).toEqual([
      "codeql-overlay-base-database-1-h-javascript-2.26.4-aaa-99-1",
    ]);
  });

  it("leaves keys it does not recognise entirely alone", () => {
    const caches = [
      cache("refs/heads/main", "some-third-party-cache-1", "2026-09-01T00:00:00Z"),
      cache("refs/heads/main", "some-third-party-cache-2", "2026-09-02T00:00:00Z"),
      cache("refs/heads/main", "some-third-party-cache-3", "2026-09-03T00:00:00Z"),
    ];
    expect(plan(caches)).toEqual([]);
  });

  it("condemns a dead ref's cache once, not twice", () => {
    const caches = [
      cache("refs/heads/gone", "v0-rust-build-Linux-x64-a-b", "2026-09-01T00:00:00Z"),
      cache("refs/heads/gone", "v0-rust-build-Linux-x64-c-d", "2026-09-02T00:00:00Z"),
    ];
    const result = plan(caches, ["main"]);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.reason.startsWith("dead-branch"))).toBe(true);
  });
});
