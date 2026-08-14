// The HEAD row treatment is marks × weight. These tests pin the two things a
// renderer relies on: a mark that is off resolves to a ZERO (never a "draw it
// anyway" default), and weight is monotonic — "intense" is heavier than
// "strong" is heavier than "subtle" on every dimension at once.
import { describe, expect, it } from "vitest";

import {
  HEAD_MARKS,
  HEAD_WEIGHTS,
  NO_HEAD_DECOR,
  migrateHeadIndicator,
  normalizeHeadMarks,
  resolveHeadDecor,
  type HeadMark,
} from "./headMarks";

describe("resolveHeadDecor", () => {
  it("zeroes every dimension when no mark is chosen", () => {
    const d = resolveHeadDecor([], "intense");
    expect(d).toEqual(NO_HEAD_DECOR);
    expect(d.bare).toBe(true);
  });

  it("draws only the mark asked for", () => {
    const bar = resolveHeadDecor(["bar"], "strong");
    expect(bar.barW).toBeGreaterThan(0);
    expect(bar.tintAlpha).toBe(0);
    expect(bar.outlineW).toBe(0);
    expect(bar.badge).toBe(false);
    expect(bar.subjectWeight).toBe(0);
    expect(bar.ringStroke).toBe(0);

    const tint = resolveHeadDecor(["tint"], "strong");
    expect(tint.tintAlpha).toBeGreaterThan(0);
    expect(tint.barW).toBe(0);
  });

  it("is not bare as soon as one mark is on", () => {
    for (const m of HEAD_MARKS) {
      expect(resolveHeadDecor([m], "subtle").bare).toBe(false);
    }
  });

  it("scales every dimension monotonically with weight", () => {
    const all = [...HEAD_MARKS] as HeadMark[];
    const [subtle, strong, intense] = HEAD_WEIGHTS.map((w) =>
      resolveHeadDecor(all, w),
    );
    const dims = [
      "barW",
      "barGlow",
      "tintAlpha",
      "outlineW",
      "outlineAlpha",
      "badgeGlow",
      "subjectWeight",
      "ringStroke",
      "ringGlow",
    ] as const;
    for (const k of dims) {
      expect(strong[k], k).toBeGreaterThanOrEqual(subtle[k] as number);
      expect(intense[k], k).toBeGreaterThanOrEqual(strong[k] as number);
    }
    // …and strictly heavier where it matters most — a weight knob that moved
    // nothing visible on the two headline marks would be a dead control.
    expect(strong.barW).toBeGreaterThan(subtle.barW);
    expect(intense.barW).toBeGreaterThan(strong.barW);
    expect(strong.tintAlpha).toBeGreaterThan(subtle.tintAlpha);
    expect(intense.tintAlpha).toBeGreaterThan(strong.tintAlpha);
  });

  it("keeps the wash under 0.5 so row text stays readable", () => {
    for (const w of HEAD_WEIGHTS) {
      expect(resolveHeadDecor(["tint"], w).tintAlpha).toBeLessThan(0.5);
    }
  });

  it("falls back to the default weight for an unknown one", () => {
    const bogus = resolveHeadDecor(["bar"], "nuclear" as never);
    expect(bogus).toEqual(resolveHeadDecor(["bar"], "strong"));
  });
});

describe("normalizeHeadMarks", () => {
  it("rejects a non-array", () => {
    expect(normalizeHeadMarks("bar")).toBeNull();
    expect(normalizeHeadMarks(undefined)).toBeNull();
    expect(normalizeHeadMarks({ bar: true })).toBeNull();
  });

  it("keeps an empty array — that is a real choice, not a missing value", () => {
    expect(normalizeHeadMarks([])).toEqual([]);
  });

  it("drops unknown entries and dedupes", () => {
    expect(normalizeHeadMarks(["bar", "glitter", "bar", 7])).toEqual(["bar"]);
  });

  it("returns marks in catalog order so the persisted value is stable", () => {
    expect(normalizeHeadMarks(["ring", "tint", "bar"])).toEqual([
      "bar",
      "tint",
      "ring",
    ]);
  });
});

describe("migrateHeadIndicator", () => {
  it("maps every legacy value, always keeping the graph ring", () => {
    expect(migrateHeadIndicator("none")).toEqual(["ring"]);
    expect(migrateHeadIndicator("bar")).toEqual(["bar", "ring"]);
    expect(migrateHeadIndicator("tint")).toEqual(["tint", "ring"]);
    expect(migrateHeadIndicator("both")).toEqual(["bar", "tint", "ring"]);
  });

  it("returns null for anything it does not recognise", () => {
    expect(migrateHeadIndicator("outline")).toBeNull();
    expect(migrateHeadIndicator(undefined)).toBeNull();
    expect(migrateHeadIndicator(3)).toBeNull();
  });
});
