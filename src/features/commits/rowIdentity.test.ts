// The row cache is what makes React.memo bite on the SEARCH path: layoutGraph
// is memoized on `visible`, so every keystroke rebuilds all 500 row objects
// even where the drawn geometry is identical (#68 G9).
import { describe, expect, it } from "vitest";
import { createRowCache } from "./rowIdentity";
import { layoutGraph } from "./graphLayout";
import type { CommitInfo } from "@/lib/types";

const c = (oid: string, parents: string[] = []): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: oid,
  body: null,
  author: "t",
  email: "t@t",
  timestamp: 0,
  parents,
  refs: [],
});

describe("createRowCache", () => {
  it("reuses row objects when geometry is unchanged", () => {
    const commits = [c("A", ["B"]), c("B", ["C"]), c("C")];
    const cache = createRowCache();
    const first = cache.stabilize(commits, layoutGraph(commits).rows);
    const second = cache.stabilize(commits, layoutGraph(commits).rows);
    expect(second[0]).toBe(first[0]);
    expect(second[1]!.lanes).toBe(first[1]!.lanes);
  });

  it("replaces a row whose geometry changed", () => {
    const cache = createRowCache();
    const linear = [c("A", ["B"]), c("B")];
    const forked = [c("A", ["B", "X"]), c("B"), c("X")];
    const first = cache.stabilize(linear, layoutGraph(linear).rows);
    const second = cache.stabilize(forked, layoutGraph(forked).rows);
    expect(second[0]).not.toBe(first[0]);
  });

  it("notices a HEAD marker appearing on an otherwise identical row", () => {
    // `head` and `primary` change pixels, so they must be in the signature.
    const commits = [c("A", ["B"]), c("B")];
    const cache = createRowCache();
    const plain = cache.stabilize(commits, layoutGraph(commits).rows);
    const headed = cache.stabilize(
      commits,
      layoutGraph(commits, { headOid: "A" }).rows,
    );
    expect(headed[0]).not.toBe(plain[0]);
  });

  it("drops oids that left the list, so the cache cannot grow without bound", () => {
    const cache = createRowCache();
    const big = [c("A", ["B"]), c("B", ["C"]), c("C")];
    cache.stabilize(big, layoutGraph(big).rows);
    const small = [c("C")];
    cache.stabilize(small, layoutGraph(small).rows);
    expect(cache.size()).toBe(1);
  });
});
