/**
 * @vitest-environment node
 */
// "Every surface a truncated clone distorts says so." (#255)
//
// Same shape and the same reasoning as `diffFindSurfaces.test.ts` next door. A
// shallow clone does not fail: History just has fewer rows, Blame attributes
// everything old to one commit, File history ends early, and Compare's
// ahead/behind is arithmetic over a graph that is missing its merge base. Every
// one of those looks like a repository with a strange past rather than a
// repository that is only partly here — so a surface that forgets the notice is
// a surface that is quietly wrong, which is exactly what no rendering test can
// catch.
//
// The behaviour is pinned by `src/features/repo/shallowNoticeText.test.ts` (the
// sentences) and `src/features/repo/ShallowNotice.test.tsx` (the strip and its
// button). This file only fails the build for a FIFTH surface that skips them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The four surfaces, and the `surface` value each one must pass. The value
 * matters as much as the mount: it is what picks the sentence, and a Blame
 * screen explaining what is wrong with a *log* is a notice nobody reads twice.
 */
const SHALLOW_SURFACES: ReadonlyArray<[file: string, surface: string]> = [
  ["src/screens/History.tsx", "history"],
  ["src/screens/FileHistory.tsx", "fileHistory"],
  ["src/screens/Blame.tsx", "blame"],
  ["src/screens/Compare.tsx", "compare"],
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the shallow notice reaches every surface a truncated clone distorts", () => {
  it.each(SHALLOW_SURFACES)("%s mounts the strip as %s", (file, surface) => {
    expect(read(file)).toContain(`<ShallowNotice surface="${surface}" />`);
  });

  // The union in `shallowNoticeText.ts` is the list; a member with no mount is
  // a sentence nobody can ever see.
  it("has a surface value for every member of the union, and no more", () => {
    const src = read("src/features/repo/shallowNoticeText.ts");
    const union = src
      .match(/export type ShallowSurface =([^;]+);/)?.[1]
      .split("|")
      .map((s) => s.trim().replace(/"/g, ""))
      .filter(Boolean);
    expect(union).toEqual(SHALLOW_SURFACES.map(([, surface]) => surface));
  });

  // The strip's whole point is that the truncation has a remedy attached. A
  // notice with no way to act on it is a sentence, not an affordance.
  it("offers the unshallow action from the one component", () => {
    const strip = read("src/features/repo/ShallowNotice.tsx");
    expect(strip).toContain("s.unshallow");
    expect(strip).toContain("shallow-unshallow");
  });
});
