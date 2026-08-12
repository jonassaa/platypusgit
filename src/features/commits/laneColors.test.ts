// Lane colour choice, isolated from commit layout (#68 G4). Two failures being
// fixed: the 8th concurrent lane silently reused --graph-1 with no adjacency
// check, and colour was a function of birth ORDER, so any filter repainted the
// whole graph.
import { describe, expect, it } from "vitest";
import { PALETTE, createLaneColorer, fnv1a } from "./laneColors";

describe("fnv1a", () => {
  it("is deterministic for the same input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  it("separates similar keys", () => {
    expect(fnv1a("commit-a")).not.toBe(fnv1a("commit-b"));
  });

  it("stays an unsigned 32-bit integer", () => {
    const h = fnv1a("a".repeat(64));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("createLaneColorer", () => {
  const none = new Set<string>();

  it("gives the same key the same colour, independent of call order", () => {
    const a = createLaneColorer();
    const b = createLaneColorer();
    // b burns three unrelated picks first: birth ORDER must not matter.
    b.pick("x", none);
    b.pick("y", none);
    b.pick("z", none);
    expect(b.pick("stable-key", none)).toBe(a.pick("stable-key", none));
  });

  it("returns the hashed preference when it is free", () => {
    const c = createLaneColorer();
    const expected = PALETTE[fnv1a("k") % PALETTE.length]!;
    expect(c.pick("k", none)).toBe(expected);
  });

  it("never hands out a colour already active, below full concurrency", () => {
    const c = createLaneColorer();
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    const got = c.pick("k", new Set([preferred]));
    expect(got).not.toBe(preferred);
    expect(PALETTE).toContain(got);
  });

  it("breaks a collision toward the least-recently-used free entry", () => {
    const c = createLaneColorer();
    // Burn every palette entry so lastUsed is populated and ordered.
    for (const entry of PALETTE) {
      c.pick(`seed:${entry}`, new Set(PALETTE.filter((p) => p !== entry)));
    }
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    // Only two entries free; the colorer must choose between them by lastUsed,
    // never outside them.
    const free = [PALETTE[0]!, PALETTE[1]!].filter((p) => p !== preferred);
    const active = new Set(PALETTE.filter((p) => !free.includes(p)));
    const got = c.pick("k", active);
    expect(free).toContain(got);
  });

  it("repeats only when every palette entry is genuinely active", () => {
    const c = createLaneColorer();
    const got = c.pick("k", new Set(PALETTE));
    // An unavoidable repeat — but still a defined, palette-member choice.
    expect(PALETTE).toContain(got);
  });

  it("prefers a never-used entry over a previously-used one when breaking ties", () => {
    const c = createLaneColorer();
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    const used = PALETTE.find((p) => p !== preferred)!;
    c.pick(`force:${used}`, new Set(PALETTE.filter((p) => p !== used)));
    // preferred + used are active; every other entry is untouched, so an
    // untouched one (lastUsed = never) must win.
    const got = c.pick("k", new Set([preferred, used]));
    expect(got).not.toBe(preferred);
    expect(got).not.toBe(used);
  });
});
