// A row surface that opts into spacing must opt into text size too.
//
// Every one of these sets `height`, not `min-height`, so a base that does not
// grow with the type CLIPS it: at the largest preset --fs-13's line box is
// 24.5px, taller than the 22px and 24px bases in use. The two vars are one
// decision — `--row-step` is the user's spacing preset, `--row-scale` the
// text one — and a surface that takes the first without the second is a row
// that gets roomier but still cuts its own text in half.
//
// Comment lines are excluded before any regex below runs (see isCommentLine):
// no real `calc()` call site lives inside a comment, so skipping them costs
// zero protection, and it is what lets a docstring say `--row-scale` alone —
// genuinely true for a text-only helper like `useTextScale()`, which never
// touches row height — without this test reading that prose as a call site.
//
// One blind spot none of these regexes can see: `densityPadding()` in
// `features/settings/layout/SettingsCard.tsx` builds its string from a
// template literal (`` `${basePx}px` ``), so the literal `\d+px` these
// patterns look for never appears in its source text. Its only safety net is
// the `-e densityPadding -e SETTINGS_ROW_PADDING` grep addendum named in the
// `index.css` row-geometry comment — this file is not exhaustive on its own.
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

/**
 * True for a comment-continuation line in either style this codebase uses —
 * a `//` line comment, or a block comment's ` * ` continuation line. A prose
 * mention of `--row-scale` or `--row-step` in a docstring is not a
 * row-geometry call site, and matching it anyway is exactly what forced a
 * docstring reword the first time this test existed — the fix belongs here,
 * not in the prose.
 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*");
}

describe("--row-step and --row-scale travel together", () => {
  it("has no row surface that scales with spacing but not with text", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (isCommentLine(line)) return;
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
        if (isCommentLine(line)) return;
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

  // A third failure mode the two assertions above cannot see between them: a
  // line multiplied TWICE (`* var(--row-scale) * var(--row-scale)`), from
  // sweeping an already-swept call site or copy-pasting one that was already
  // fixed. The first assertion only fires when the base is immediately
  // followed by `+`, which a doubled multiply never is; the second only fires
  // when `var(--row-step)` is ABSENT, and a doubled line still has it. Only
  // counting occurrences catches a row that would grow twice as fast as every
  // other row under the same Text size setting.
  it("has no row surface that multiplies by --row-scale more than once", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (isCommentLine(line)) return;
        const hits = line.match(/var\(--row-scale\)/g);
        if (hits && hits.length > 1) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
