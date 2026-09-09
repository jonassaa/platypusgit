import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";

import { contrastRatio, contrastReport } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1 for a colour on itself", () => {
    expect(contrastRatio("#5aa8e8", "#5aa8e8")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1a1d24", "#eef1f5")).toBeCloseTo(
      contrastRatio("#eef1f5", "#1a1d24"),
      5,
    );
  });

  it("matches a known WCAG value", () => {
    // #767676 on white is the canonical 4.54:1 boundary case from the WCAG
    // techniques — if the luminance curve is wrong, this is what shows it.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("accepts short hex and a missing hash", () => {
    expect(contrastRatio("000", "fff")).toBeCloseTo(21, 1);
  });

  it("is NaN when either side cannot be parsed", () => {
    // A half-typed hex is not a finding.
    expect(contrastRatio("#12", "#ffffff")).toBeNaN();
  });
});

describe("contrastReport", () => {
  it("finds nothing to warn about in the built-in themes", () => {
    // A built-in theme that trips our own warning would mean the thresholds are
    // miscalibrated, not that the theme is bad.
    for (const theme of BUILTIN_THEMES) {
      expect(
        contrastReport(theme.colors).filter((f) => f.level === "bad"),
        `${theme.name} trips a hard contrast warning`,
      ).toEqual([]);
    }
  });

  it("reports primary text that cannot be read on the canvas", () => {
    const base = BUILTIN_THEMES[0].colors;
    const report = contrastReport({ ...base, fg0: base.bg0 });
    const finding = report.find((f) => f.a === "fg0" && f.b === "bg0");
    expect(finding?.level).toBe("bad");
    expect(finding?.ratio).toBeCloseTo(1, 3);
  });

  it("reports unreadable ink on the accent", () => {
    const base = BUILTIN_THEMES[0].colors;
    const report = contrastReport({ ...base, accentInk: base.accent });
    expect(report.some((f) => f.a === "accentInk" && f.b === "accent")).toBe(true);
  });

  it("describes a finding in prose, never as a colour-slot key", () => {
    const base = BUILTIN_THEMES[0].colors;
    const finding = contrastReport({ ...base, fg0: base.bg0 })[0];
    expect(finding.what).toMatch(/primary text/i);
    expect(finding.what).not.toMatch(/fg0|bg0/);
  });

  it("separates a merely-low pair from an unreadable one, worst first", () => {
    const base = BUILTIN_THEMES[0].colors;
    // Measured against dark-cool's bg1 (#1e222a): #767d8a is 3.85:1 — under
    // AA's 4.5 for body text but over the 3.0 floor, which is exactly the
    // "low, not bad" band. Guessing at this is how the first version of this
    // test asserted nothing: setting fg2 to fg1 RAISED the contrast.
    const report = contrastReport({
      ...base,
      fg0: base.bg0, // ratio 1 — unreadable
      fg2: "#767d8a", // 3.85 — low
    });
    expect(report).toHaveLength(2);
    expect(report[0]).toMatchObject({ a: "fg0", level: "bad" });
    expect(report[1]).toMatchObject({ a: "fg2", level: "low" });
    expect(report[1].ratio).toBeCloseTo(3.85, 1);
    expect(report[0].ratio).toBeLessThanOrEqual(report[1].ratio);
  });

  it("says nothing about a pair it cannot parse", () => {
    const base = BUILTIN_THEMES[0].colors;
    expect(() => contrastReport({ ...base, fg0: "not-a-colour" })).not.toThrow();
    expect(
      contrastReport({ ...base, fg0: "not-a-colour" }).some((f) => f.a === "fg0"),
    ).toBe(false);
  });
});
