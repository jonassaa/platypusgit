// The waiver's shape and its lifetime (#396).
//
// The click records a waiver; the surface's ordinary diff fetch carries it. That
// division is the whole design, and it is what the first version got wrong — a
// hook that fetched the waived path itself and spliced it in lost the result to
// the next status refresh, because the refresh re-ran the surface's own fetch
// without the waiver. So what is worth pinning here is exactly two things: which
// paths a click waives, and when the waivers are dropped.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { raisedPathsFor, useDiffAnyway } from "./useDiffAnyway";
import type { FileDiff } from "@/lib/types";

const file = (path: string): FileDiff => ({
  path,
  oldPath: null,
  binary: true,
  additions: 0,
  deletions: 0,
  hunks: [],
  lfs: null,
  oversized: { size: 42_000_000, limit: 5 * 1024 * 1024, raised: false },
  truncated: null,
});

describe("raisedPathsFor", () => {
  it("waives the one path an ordinary delta has", () => {
    expect(raisedPathsFor(file("data.csv"))).toEqual(["data.csv"]);
  });

  it("waives BOTH sides of a rename", () => {
    // The backend turns the list into a pathspec, and a rename is two tree
    // entries — naming only the new side hands `find_similar` half the pair and
    // turns the rename into an add.
    const renamed = { ...file("new.csv"), oldPath: "old.csv" };
    expect(raisedPathsFor(renamed)).toEqual(["new.csv", "old.csv"]);
  });

  it("does not double up when the paths are the same", () => {
    const same = { ...file("data.csv"), oldPath: "data.csv" };
    expect(raisedPathsFor(same)).toEqual(["data.csv"]);
  });
});

describe("useDiffAnyway", () => {
  function setup(resetKey: unknown = "a.txt") {
    return renderHook(({ key }: { key: unknown }) => useDiffAnyway(key), {
      initialProps: { key: resetKey },
    });
  }

  it("starts with nothing waived", () => {
    // The ceiling applies until the user says otherwise — the default is the
    // refusal, and this is what makes it so.
    expect(setup().result.current.raiseFor).toEqual([]);
  });

  it("waives the clicked path, and nothing else", () => {
    const hook = setup();
    act(() => hook.result.current.diffAnyway(file("data.csv")));
    expect(hook.result.current.raiseFor).toEqual(["data.csv"]);
  });

  it("accumulates within one view, without repeats", () => {
    // A commit diff can hold several over-ceiling artifacts, and each is its own
    // decision. The list is a set: re-clicking must not make the pathspec grow.
    const hook = setup("commit-a");
    act(() => hook.result.current.diffAnyway(file("data.csv")));
    act(() => hook.result.current.diffAnyway(file("bundle.min.js")));
    act(() => hook.result.current.diffAnyway(file("data.csv")));
    expect(hook.result.current.raiseFor).toEqual(["data.csv", "bundle.min.js"]);
  });

  it("keeps the waiver while the view stays put", () => {
    // The bug that made this shape necessary: a status refresh re-runs the
    // surface's diff fetch, so the waiver has to survive re-renders that are
    // not navigations — otherwise the diff the user waited seconds for is
    // replaced by the refusal on its own.
    const hook = setup("commit-a");
    act(() => hook.result.current.diffAnyway(file("data.csv")));
    act(() => hook.rerender({ key: "commit-a" }));
    expect(hook.result.current.raiseFor).toEqual(["data.csv"]);
  });

  it("drops every waiver when the view points somewhere else", () => {
    // The "per view, never a setting" half. A waiver that survived a change of
    // file or commit would be a remembered "always diff huge files" by accident
    // — a considered refusal turned into a footgun the user forgot they armed,
    // and here that costs a multi-megabyte read nobody asked for.
    const hook = setup("commit-a");
    act(() => hook.result.current.diffAnyway(file("data.csv")));
    expect(hook.result.current.raiseFor).toEqual(["data.csv"]);

    act(() => hook.rerender({ key: "commit-b" }));
    expect(hook.result.current.raiseFor).toEqual([]);
  });

  it("keeps a stable `diffAnyway` identity across renders", () => {
    // The surfaces hand it to a memoized diff panel; a new function every render
    // would re-render the whole diff pane on every keystroke elsewhere.
    const hook = setup();
    const first = hook.result.current.diffAnyway;
    act(() => hook.rerender({ key: "a.txt" }));
    expect(hook.result.current.diffAnyway).toBe(first);
  });
});
