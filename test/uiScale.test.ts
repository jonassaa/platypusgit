// A row surface that opts into spacing must opt into text size too.
//
// Every one of these sets `height`, not `min-height`, so a base that does not
// grow with the type CLIPS it: at the largest preset --fs-13's line box is
// 24.5px, taller than the 22px and 24px bases in use. The two vars are one
// decision — `--row-step` is the user's spacing preset, `--row-scale` the
// text one — and a surface that takes the first without the second is a row
// that gets roomier but still cuts its own text in half.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx,css}", { cwd: ROOT })
    .filter((f) => !f.includes(".test."))
    .map((f) => join(ROOT, f));
}

describe("--row-step and --row-scale travel together", () => {
  it("has no row surface that scales with spacing but not with text", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        // `calc(<n>px + var(--row-step)` — a base that never grows with type.
        if (/calc\(\s*\d+px\s*\+\s*var\(--row-step\)/.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  // The other half: a base multiplied by --row-scale but never given the
  // user's spacing step is a row that ignores the Spacing setting entirely.
  it("has no row surface that scales with text but not with spacing", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (
          /var\(--row-scale\)/.test(line) &&
          !/var\(--row-step\)/.test(line) &&
          !/--row-scale:/.test(line)
        ) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
