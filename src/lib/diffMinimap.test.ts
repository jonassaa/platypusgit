import { describe, expect, it } from "vitest";
import type { DiffRow } from "./diffRows";
import { rowOffset } from "./diffRows";
import {
  MINIMAP_COLS,
  MINIMAP_MIN_BAND_H,
  MINIMAP_ROW_PITCH,
  buildMinimapBands,
  grabDyFor,
  lineColumns,
  minimapGeom,
  minimapMarks,
  minimapY,
  offsetAtMinimapY,
  rowIndexAtOffset,
  scrubScrollTop,
  viewportBand,
  type MinimapMark,
} from "./diffMinimap";

const ROW_H = 18.6;

const lineRow = (kind: "add" | "rem" | "ctx", text: string, h = ROW_H): DiffRow => ({
  kind: "line",
  hunkIndex: 0,
  line: { kind, text },
  h,
});
const fillRow = (text: string, h = ROW_H): DiffRow => ({
  kind: "fill",
  line: { kind: "ctx", text },
  h,
});
const foldRow = (h = 22): DiffRow => ({
  kind: "fold",
  gapIndex: 0,
  hiddenLines: 40,
  fromL: 1,
  fromR: 1,
  h,
});

describe("lineColumns", () => {
  it("excludes leading whitespace so indentation survives", () => {
    expect(lineColumns("abc")).toEqual({ from: 0, to: 3 });
    expect(lineColumns("  abc")).toEqual({ from: 2, to: 5 });
  });

  it("expands tabs to the next stop", () => {
    expect(lineColumns("\tabc")).toEqual({ from: 8, to: 11 });
    expect(lineColumns("\t\tx")).toEqual({ from: 16, to: 17 });
    // A tab after three columns of content advances to 8, not by 8.
    expect(lineColumns("abc\tx")).toEqual({ from: 0, to: 9 });
  });

  it("excludes trailing whitespace — a padded line is not a long line", () => {
    expect(lineColumns("ab    ")).toEqual({ from: 0, to: 2 });
    expect(lineColumns("ab\t")).toEqual({ from: 0, to: 2 });
  });

  it("reports a blank or whitespace-only line as empty", () => {
    expect(lineColumns("")).toEqual({ from: 0, to: 0 });
    expect(lineColumns("     ")).toEqual({ from: 0, to: 0 });
    expect(lineColumns("\t\t")).toEqual({ from: 0, to: 0 });
  });

  it("clamps a long line at the column ceiling", () => {
    expect(lineColumns("x".repeat(500))).toEqual({ from: 0, to: MINIMAP_COLS });
  });
});

describe("minimapMarks", () => {
  it("maps one mark per row, in row order", () => {
    const rows = [lineRow("rem", "  old"), lineRow("add", "  new"), fillRow("ctx"), foldRow()];
    expect(minimapMarks(rows)).toEqual([
      { kind: "rem", from: 2, to: 5 },
      { kind: "add", from: 2, to: 5 },
      { kind: "ctx", from: 0, to: 3 },
      { kind: "fold", from: 0, to: 0 },
    ]);
  });

  it("stays index-aligned with heights", () => {
    const rows = [lineRow("add", "a"), foldRow(), fillRow("b")];
    expect(minimapMarks(rows)).toHaveLength(rows.length);
  });
});

describe("minimapGeom", () => {
  it("compresses a file TALLER than the gutter to fit exactly", () => {
    // 2000 rows × 18.6 = 37 200 content px into a 600px gutter.
    const contentH = 2000 * ROW_H;
    const g = minimapGeom({ contentH, canvasH: 600, rowH: ROW_H });
    expect(g.scale).toBeCloseTo(600 / contentH, 12);
    expect(g.mapH).toBeCloseTo(600, 9);
    expect(g.mapH).toBeLessThanOrEqual(g.canvasH);
  });

  it("keeps the fixed pitch for a file SHORTER than that, leaving the rest empty", () => {
    const contentH = 40 * ROW_H;
    const g = minimapGeom({ contentH, canvasH: 600, rowH: ROW_H });
    expect(g.scale).toBeCloseTo(MINIMAP_ROW_PITCH / ROW_H, 12);
    // 40 rows at 2px pitch.
    expect(g.mapH).toBeCloseTo(80, 9);
    expect(g.mapH).toBeLessThan(g.canvasH);
  });

  it("treats an EMPTY diff as a defined zero state", () => {
    const g = minimapGeom({ contentH: 0, canvasH: 600, rowH: ROW_H });
    expect(g).toEqual({ scale: 0, contentH: 0, mapH: 0, canvasH: 600 });
    expect(minimapY(g, 999)).toBe(0);
    expect(offsetAtMinimapY(g, 999)).toBe(0);
    expect(viewportBand(g, { scrollTop: 10, viewportH: 100 })).toEqual({ top: 0, height: 0 });
    expect(grabDyFor(g, { y: 5, scrollTop: 0, viewportH: 100 })).toBeNull();
    expect(scrubScrollTop(g, [], { y: 5, grabDy: null, viewportH: 100 })).toBe(0);
    expect(buildMinimapBands({ marks: [], heights: [], geom: g, dpr: 2 })).toEqual([]);
  });

  it("treats an UNMEASURED gutter as the same zero state", () => {
    const g = minimapGeom({ contentH: 500, canvasH: 0, rowH: ROW_H });
    expect(g.scale).toBe(0);
    expect(g.mapH).toBe(0);
  });
});

describe("minimapY ⇄ offsetAtMinimapY", () => {
  const contentH = 2000 * ROW_H;
  const compressed = minimapGeom({ contentH, canvasH: 600, rowH: ROW_H });
  const short = minimapGeom({ contentH: 40 * ROW_H, canvasH: 600, rowH: ROW_H });

  it("round-trips across the range in both regimes", () => {
    for (const g of [compressed, short]) {
      for (const frac of [0, 0.001, 0.25, 0.5, 0.7333, 0.999, 1]) {
        const offset = g.contentH * frac;
        expect(offsetAtMinimapY(g, minimapY(g, offset))).toBeCloseTo(offset, 6);
      }
    }
  });

  it("round-trips the endpoints exactly", () => {
    expect(minimapY(compressed, 0)).toBe(0);
    expect(offsetAtMinimapY(compressed, 0)).toBe(0);
    expect(minimapY(compressed, compressed.contentH)).toBeCloseTo(compressed.mapH, 9);
    expect(offsetAtMinimapY(compressed, compressed.mapH)).toBeCloseTo(compressed.contentH, 6);
  });

  it("clamps outside the range instead of extrapolating", () => {
    expect(minimapY(compressed, -100)).toBe(0);
    expect(minimapY(compressed, contentH * 2)).toBeCloseTo(compressed.mapH, 9);
    expect(offsetAtMinimapY(compressed, -50)).toBe(0);
    expect(offsetAtMinimapY(compressed, 5000)).toBeCloseTo(contentH, 6);
  });
});

describe("rowIndexAtOffset", () => {
  const heights = [10, 10, 10];

  it("lands on the row whose [top, top + h) contains the offset", () => {
    expect(rowIndexAtOffset(heights, 0)).toBe(0);
    expect(rowIndexAtOffset(heights, 9.999)).toBe(0);
    expect(rowIndexAtOffset(heights, 10)).toBe(1);
    expect(rowIndexAtOffset(heights, 19.999)).toBe(1);
    expect(rowIndexAtOffset(heights, 20)).toBe(2);
    expect(rowIndexAtOffset(heights, 29.999)).toBe(2);
  });

  it("clamps past the end rather than returning nowhere", () => {
    expect(rowIndexAtOffset(heights, 30)).toBe(2);
    expect(rowIndexAtOffset(heights, 1e9)).toBe(2);
    expect(rowIndexAtOffset(heights, -5)).toBe(0);
  });

  it("has no answer for an empty list", () => {
    expect(rowIndexAtOffset([], 0)).toBe(-1);
  });

  it("copes with mixed row heights (a fold row is taller)", () => {
    const mixed = [18.6, 22, 18.6];
    expect(rowIndexAtOffset(mixed, 18.5)).toBe(0);
    expect(rowIndexAtOffset(mixed, 18.7)).toBe(1);
    expect(rowIndexAtOffset(mixed, 40.5)).toBe(1);
    expect(rowIndexAtOffset(mixed, 40.7)).toBe(2);
  });
});

describe("viewportBand", () => {
  const contentH = 2000 * ROW_H;
  const g = minimapGeom({ contentH, canvasH: 600, rowH: ROW_H });

  it("is the on-screen slice, in minimap space", () => {
    const band = viewportBand(g, { scrollTop: 0, viewportH: 600 });
    expect(band.top).toBe(0);
    expect(band.height).toBeCloseTo(600 * g.scale, 9);
  });

  it("tracks scrollTop through the same scale as the bars", () => {
    const band = viewportBand(g, { scrollTop: contentH / 2, viewportH: 600 });
    expect(band.top).toBeCloseTo(g.mapH / 2, 9);
  });

  it("keeps a grabbable minimum height", () => {
    const tall = minimapGeom({ contentH: 200_000, canvasH: 600, rowH: ROW_H });
    const band = viewportBand(tall, { scrollTop: 0, viewportH: 30 });
    expect(band.height).toBe(MINIMAP_MIN_BAND_H);
  });

  it("never overhangs the miniature it indexes", () => {
    const short = minimapGeom({ contentH: 10 * ROW_H, canvasH: 600, rowH: ROW_H });
    const band = viewportBand(short, { scrollTop: 0, viewportH: 600 });
    // The whole file is on screen: the band covers the whole miniature.
    expect(band.height).toBeCloseTo(short.mapH, 9);
    expect(band.top).toBe(0);
  });

  it("pins at the end instead of sliding past it", () => {
    const band = viewportBand(g, { scrollTop: contentH * 4, viewportH: 600 });
    expect(band.top + band.height).toBeCloseTo(g.mapH, 9);
  });
});

describe("grabDyFor", () => {
  const g = minimapGeom({ contentH: 2000 * ROW_H, canvasH: 600, rowH: ROW_H });
  const at = { scrollTop: 1000, viewportH: 600 };
  const band = viewportBand(g, at);

  it("returns the offset within the band for a press inside it", () => {
    expect(grabDyFor(g, { ...at, y: band.top })).toBeCloseTo(0, 9);
    expect(grabDyFor(g, { ...at, y: band.top + band.height / 2 })).toBeCloseTo(
      band.height / 2,
      9,
    );
  });

  it("returns null for a press outside it", () => {
    expect(grabDyFor(g, { ...at, y: band.top - 1 })).toBeNull();
    expect(grabDyFor(g, { ...at, y: band.top + band.height + 1 })).toBeNull();
  });
});

describe("scrubScrollTop", () => {
  // 500 uniform rows: content 9300px, gutter 600px → compressed.
  const heights = new Array(500).fill(ROW_H);
  const contentH = rowOffset(heights, heights.length);
  const g = minimapGeom({ contentH, canvasH: 600, rowH: ROW_H });
  const viewportH = 400;
  const max = contentH - viewportH;

  const centreOf = (i: number) => rowOffset(heights, i) + heights[i] / 2 - viewportH / 2;

  it("centres the row under the cursor", () => {
    const i = 250;
    const y = minimapY(g, rowOffset(heights, i) + heights[i] / 2);
    expect(scrubScrollTop(g, heights, { y, grabDy: null, viewportH })).toBeCloseTo(
      centreOf(i),
      6,
    );
  });

  it("resolves the same row from anywhere inside it — top, middle and bottom", () => {
    const i = 123;
    const top = rowOffset(heights, i);
    const ys = [
      minimapY(g, top),
      minimapY(g, top + heights[i] / 2),
      minimapY(g, top + heights[i] - 1e-6),
    ];
    for (const y of ys) {
      expect(scrubScrollTop(g, heights, { y, grabDy: null, viewportH })).toBeCloseTo(
        centreOf(i),
        6,
      );
    }
  });

  it("does not spill onto the NEXT row at a row boundary", () => {
    const i = 60;
    // Exactly the boundary: this offset belongs to row i, not row i-1.
    const y = minimapY(g, rowOffset(heights, i));
    const got = scrubScrollTop(g, heights, { y, grabDy: null, viewportH });
    expect(got).toBeCloseTo(centreOf(i), 6);
    expect(got).not.toBeCloseTo(centreOf(i - 1), 6);
  });

  it("clamps at both ends of the file", () => {
    expect(scrubScrollTop(g, heights, { y: -50, grabDy: null, viewportH })).toBe(0);
    expect(scrubScrollTop(g, heights, { y: 0, grabDy: null, viewportH })).toBe(0);
    expect(
      scrubScrollTop(g, heights, { y: g.mapH + 999, grabDy: null, viewportH }),
    ).toBeCloseTo(max, 6);
  });

  it("clamps a scrub near the LAST row rather than scrolling past the end", () => {
    const i = heights.length - 1;
    const y = minimapY(g, rowOffset(heights, i));
    expect(scrubScrollTop(g, heights, { y, grabDy: null, viewportH })).toBeCloseTo(max, 6);
  });

  it("preserves the grab offset exactly in band-drag mode", () => {
    const scrollTop = 3000;
    const band = viewportBand(g, { scrollTop, viewportH });
    const grabDy = band.height / 3;
    // Pressing at band.top + grabDy and not moving must not shift the content.
    expect(
      scrubScrollTop(g, heights, { y: band.top + grabDy, grabDy, viewportH }),
    ).toBeCloseTo(scrollTop, 6);
    // Moving the pointer 40px down moves the content by 40 / scale.
    expect(
      scrubScrollTop(g, heights, { y: band.top + grabDy + 40, grabDy, viewportH }),
    ).toBeCloseTo(scrollTop + 40 / g.scale, 6);
  });

  it("clamps a band drag at both ends", () => {
    expect(scrubScrollTop(g, heights, { y: -100, grabDy: 5, viewportH })).toBe(0);
    expect(
      scrubScrollTop(g, heights, { y: g.mapH + 500, grabDy: 5, viewportH }),
    ).toBeCloseTo(max, 6);
  });

  it("returns 0 for a file that does not scroll at all", () => {
    const tiny = new Array(3).fill(ROW_H);
    const gt = minimapGeom({
      contentH: rowOffset(tiny, tiny.length),
      canvasH: 600,
      rowH: ROW_H,
    });
    expect(scrubScrollTop(gt, tiny, { y: 300, grabDy: null, viewportH: 600 })).toBe(0);
  });
});

describe("buildMinimapBands", () => {
  it("bounds the band count by the gutter, not the file", () => {
    const heights = new Array(20_000).fill(ROW_H);
    const g = minimapGeom({
      contentH: rowOffset(heights, heights.length),
      canvasH: 600,
      rowH: ROW_H,
    });
    const marks = heights.map(() => ({ kind: "ctx" as const, from: 0, to: 40 }));
    const bands = buildMinimapBands({ marks, heights, geom: g, dpr: 2 });
    expect(bands.length).toBe(Math.floor(g.mapH * 2));
    expect(bands.length).toBeLessThanOrEqual(1200);
  });

  it("keeps ONE changed line among 20 000 visible", () => {
    const heights = new Array(20_000).fill(ROW_H);
    const g = minimapGeom({
      contentH: rowOffset(heights, heights.length),
      canvasH: 600,
      rowH: ROW_H,
    });
    const marks: MinimapMark[] = heights.map(() => ({
      kind: "ctx" as const,
      from: 0,
      to: 40,
    }));
    marks[12_345] = { kind: "add", from: 4, to: 30 };
    const bands = buildMinimapBands({ marks, heights, geom: g, dpr: 1 });
    const withChange = bands.filter((b) => b.change !== null);
    expect(withChange).toHaveLength(1);
    expect(withChange[0].change).toMatchObject({ from: 4, to: 30, kind: "add" });
    // And it sits where the line is, not at the top.
    const expected = Math.floor(rowOffset(heights, 12_345) * g.scale);
    expect(bands.findIndex((b) => b.change !== null)).toBeGreaterThanOrEqual(expected - 1);
    expect(bands.findIndex((b) => b.change !== null)).toBeLessThanOrEqual(expected + 1);
  });

  it("registers a changed BLANK line — an added empty line is still a change", () => {
    const heights = [ROW_H];
    const g = minimapGeom({ contentH: ROW_H, canvasH: 600, rowH: ROW_H });
    const bands = buildMinimapBands({
      marks: [{ kind: "add", from: 0, to: 0 }],
      heights,
      geom: g,
      dpr: 1,
    });
    expect(bands.some((b) => b.change?.kind === "add")).toBe(true);
  });

  it("drops a blank CONTEXT line — that is real shape", () => {
    const heights = [ROW_H];
    const g = minimapGeom({ contentH: ROW_H, canvasH: 600, rowH: ROW_H });
    const bands = buildMinimapBands({
      marks: [{ kind: "ctx", from: 0, to: 0 }],
      heights,
      geom: g,
      dpr: 1,
    });
    expect(bands.every((b) => b.ctx === null)).toBe(true);
  });

  it("reports add + rem in one pixel row as mixed", () => {
    const heights = new Array(4000).fill(ROW_H);
    const g = minimapGeom({
      contentH: rowOffset(heights, heights.length),
      canvasH: 60,
      rowH: ROW_H,
    });
    const marks = heights.map((_, i) => ({
      kind: i % 2 === 0 ? ("add" as const) : ("rem" as const),
      from: 0,
      to: 20,
    }));
    const bands = buildMinimapBands({ marks, heights, geom: g, dpr: 1 });
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.every((b) => b.change?.kind === "mixed")).toBe(true);
  });

  it("keeps context under a change rather than replacing it", () => {
    // One add sandwiched in context, uncompressed: distinct pixel rows.
    const heights = new Array(10).fill(ROW_H);
    const g = minimapGeom({ contentH: rowOffset(heights, 10), canvasH: 600, rowH: ROW_H });
    const marks = heights.map((_, i) =>
      i === 5
        ? { kind: "add" as const, from: 2, to: 10 }
        : { kind: "ctx" as const, from: 0, to: 30 },
    );
    const bands = buildMinimapBands({ marks, heights, geom: g, dpr: 2 });
    expect(bands.some((b) => b.ctx !== null && b.change === null)).toBe(true);
    expect(bands.some((b) => b.change !== null)).toBe(true);
  });

  it("marks a fold row's band", () => {
    const heights = [ROW_H, 22, ROW_H];
    const g = minimapGeom({ contentH: rowOffset(heights, 3), canvasH: 600, rowH: ROW_H });
    const bands = buildMinimapBands({
      marks: [
        { kind: "ctx", from: 0, to: 10 },
        { kind: "fold", from: 0, to: 0 },
        { kind: "ctx", from: 0, to: 10 },
      ],
      heights,
      geom: g,
      dpr: 2,
    });
    expect(bands.some((b) => b.fold)).toBe(true);
  });

  it("stays inside the array for the very last row", () => {
    const heights = new Array(37).fill(ROW_H);
    const g = minimapGeom({ contentH: rowOffset(heights, 37), canvasH: 600, rowH: ROW_H });
    const marks = heights.map(() => ({ kind: "add" as const, from: 0, to: 10 }));
    const bands = buildMinimapBands({ marks, heights, geom: g, dpr: 3 });
    expect(bands.length).toBeGreaterThan(0);
    // Every band is a real object — no holes left by an out-of-range write.
    expect(bands.every((b) => b !== undefined)).toBe(true);
    // The last band carries the last row's change.
    expect(bands[bands.length - 1].change).not.toBeNull();
  });
});
