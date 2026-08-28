// How the collapsed loading indicator reads (#296 gap 8).
//
// The summary line is the whole feature for anyone who never clicks it, so its
// wording and — more importantly — WHICH task it names are pinned here rather
// than left to the component test.

import { describe, expect, it } from "vitest";

import { byAge, loadingSummary, primaryTask, type LoadingTask } from "./loadingTasks";

const task = (id: string, startedAt: number, label = id): LoadingTask => ({
  id,
  label,
  startedAt,
});

describe("which task gets named", () => {
  it("names nothing when nothing is running", () => {
    expect(primaryTask([])).toBeNull();
    expect(loadingSummary([])).toBeNull();
  });

  it("names the longest-running one, not the first or last registered", () => {
    // This is the point of the feature. As the nine fast reads drop off, the
    // label settles onto the one actually holding the refresh up — which is the
    // question a user staring at a nine-second launch is asking.
    const tasks = [
      task("status", 1_000),
      task("remotes", 500),
      task("tags", 1_200),
    ];
    expect(primaryTask(tasks)?.id).toBe("remotes");
  });

  it("breaks a tie on id so the label cannot flap", () => {
    // Ten reads fired from one `Promise.all` can share a millisecond. Without a
    // stable tiebreak the named task would change on every re-render.
    const a = [task("branches", 900), task("almanac", 900)];
    const b = [task("almanac", 900), task("branches", 900)];
    expect(primaryTask(a)?.id).toBe("almanac");
    expect(primaryTask(b)?.id).toBe("almanac");
  });
});

describe("the summary line", () => {
  it("names the task alone when it is the only one", () => {
    expect(loadingSummary([task("remotes", 1, "fetching remotes")])).toBe(
      "Loading: fetching remotes",
    );
  });

  it("counts the rest when there are more", () => {
    const tasks = [
      task("remotes", 1, "fetching remotes"),
      ...Array.from({ length: 5 }, (_, i) => task(`t${i}`, 2 + i)),
    ];
    expect(loadingSummary(tasks)).toBe("Loading: fetching remotes + 5 others");
  });

  it("says 'other' for exactly one", () => {
    expect(
      loadingSummary([task("remotes", 1, "fetching remotes"), task("tags", 2)]),
    ).toBe("Loading: fetching remotes + 1 other");
  });
});

describe("the expanded order", () => {
  it("puts the longest-running first", () => {
    const ordered = byAge([task("c", 300), task("a", 100), task("b", 200)]);
    expect(ordered.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const tasks = [task("c", 300), task("a", 100)];
    byAge(tasks);
    expect(tasks.map((t) => t.id)).toEqual(["c", "a"]);
  });
});
