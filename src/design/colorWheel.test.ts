// The colour wheel's geometry — PURE arithmetic, no React and no DOM, for the
// same reason `selectPos.ts` and `paneSize.ts` sit beside their components:
// jsdom performs no layout, so a rendered wheel measures 0×0 and every
// assertion a component test could make about where the cursor went would be
// made against zeroes.
//
// Orientation is the thing worth pinning. Hue 0 at the right, increasing
// counter-clockwise, is invisible in code and obvious on screen, and getting it
// wrong mirrors the whole wheel while every round-trip test still passes.

import { describe, expect, it } from "vitest";

import {
  paintWheelRgba,
  sliderFraction,
  sliderValue,
  wheelHueSat,
  wheelHueSatClamped,
  wheelPoint,
} from "./colorWheel";

describe("wheelPoint", () => {
  it("puts hue 0 on the right rim", () => {
    const p = wheelPoint(0, 1, 100);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("runs counter-clockwise, so hue 90 is straight up", () => {
    const p = wheelPoint(90, 1, 100);
    expect(p.x).toBeCloseTo(0, 6);
    // Screen coordinates: up is NEGATIVE y.
    expect(p.y).toBeCloseTo(-100, 6);
  });

  it("collapses every hue to the centre at zero saturation", () => {
    for (const h of [0, 90, 200, 359]) {
      expect(wheelPoint(h, 0, 100)).toEqual({ x: 0, y: 0 });
    }
  });

  it("places saturation linearly along the radius", () => {
    expect(wheelPoint(0, 0.5, 100).x).toBeCloseTo(50, 6);
  });
});

describe("wheelHueSat", () => {
  it("inverts wheelPoint", () => {
    for (const h of [0, 37, 90, 180, 275, 359]) {
      for (const s of [0.15, 0.5, 1]) {
        const p = wheelPoint(h, s, 100);
        const back = wheelHueSat(p.x, p.y, 100)!;
        expect(back.h).toBeCloseTo(h, 4);
        expect(back.s).toBeCloseTo(s, 6);
      }
    }
  });

  it("refuses a point outside the disc", () => {
    expect(wheelHueSat(101, 0, 100)).toBeNull();
    expect(wheelHueSat(80, 80, 100)).toBeNull();
  });
});

describe("wheelHueSatClamped", () => {
  it("pins a drag that left the disc to the rim, keeping its angle", () => {
    // A pointer that runs off the wheel mid-drag must keep picking the hue it
    // is pointing at, not stop dead or jump back to the centre.
    const far = wheelHueSatClamped(400, 0, 100);
    expect(far.s).toBe(1);
    expect(far.h).toBeCloseTo(0, 6);

    const up = wheelHueSatClamped(0, -400, 100);
    expect(up.s).toBe(1);
    expect(up.h).toBeCloseTo(90, 6);
  });

  it("leaves a point inside the disc alone", () => {
    const inside = wheelHueSatClamped(50, 0, 100);
    expect(inside.s).toBeCloseTo(0.5, 6);
  });

  it("answers the centre without dividing by zero", () => {
    const c = wheelHueSatClamped(0, 0, 100);
    expect(c.s).toBe(0);
    expect(Number.isFinite(c.h)).toBe(true);
  });
});

describe("paintWheelRgba", () => {
  const size = 65; // odd, so there is an exact centre pixel
  const paint = () => {
    const data = new Uint8ClampedArray(size * size * 4);
    paintWheelRgba(data, size);
    return data;
  };
  const at = (data: Uint8ClampedArray, x: number, y: number) => {
    const i = (y * size + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  it("paints the centre white — zero saturation at full value", () => {
    const c = (size - 1) / 2;
    const px = at(paint(), c, c);
    expect(px.a).toBe(255);
    expect(px.r).toBeGreaterThan(250);
    expect(px.g).toBeGreaterThan(250);
    expect(px.b).toBeGreaterThan(250);
  });

  it("paints the right rim red, which is what fixes the orientation", () => {
    const c = (size - 1) / 2;
    const px = at(paint(), size - 2, c);
    expect(px.r).toBeGreaterThan(px.g);
    expect(px.r).toBeGreaterThan(px.b);
  });

  it("paints the top green-ish, not blue — counter-clockwise, not clockwise", () => {
    const c = (size - 1) / 2;
    const px = at(paint(), c, 1);
    expect(px.g).toBeGreaterThan(px.b);
  });

  it("leaves the corners transparent", () => {
    const data = paint();
    expect(at(data, 0, 0).a).toBe(0);
    expect(at(data, size - 1, size - 1).a).toBe(0);
  });

  it("feathers the rim instead of stair-stepping it", () => {
    // An alpha of exactly 0 or 255 everywhere means a hard edge, which reads
    // as a cog rather than a circle at this size.
    const data = paint();
    let partial = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0 && data[i] < 255) partial++;
    }
    expect(partial).toBeGreaterThan(0);
  });
});

describe("sliderValue", () => {
  it("maps a position along the track onto the range", () => {
    expect(sliderValue(0, 200, 0, 360)).toBe(0);
    expect(sliderValue(100, 200, 0, 360)).toBe(180);
    expect(sliderValue(200, 200, 0, 360)).toBe(360);
  });

  it("clamps a pointer that ran past either end", () => {
    expect(sliderValue(-40, 200, 0, 360)).toBe(0);
    expect(sliderValue(999, 200, 0, 360)).toBe(360);
  });

  it("answers the minimum for a track with no length", () => {
    // A slider measured before layout: 0 width must not produce NaN, which
    // would poison the colour and blank the whole popover.
    expect(sliderValue(50, 0, 0, 360)).toBe(0);
  });
});

describe("sliderFraction", () => {
  it("reports where the handle belongs, 0 to 1", () => {
    expect(sliderFraction(180, 0, 360)).toBeCloseTo(0.5, 6);
    expect(sliderFraction(0, 0, 360)).toBe(0);
    expect(sliderFraction(360, 0, 360)).toBe(1);
  });

  it("clamps a value from outside the range", () => {
    expect(sliderFraction(-10, 0, 360)).toBe(0);
    expect(sliderFraction(400, 0, 360)).toBe(1);
  });

  it("answers zero for an empty range", () => {
    expect(sliderFraction(5, 3, 3)).toBe(0);
  });
});
