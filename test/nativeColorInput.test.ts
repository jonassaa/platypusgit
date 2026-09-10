/**
 * @vitest-environment node
 */
// "No native `<input type=\"color\">` anywhere in `src/`."
//
// The theme editor's eighteen slots each had one. A native colour input is not
// a picker so much as a hand-off: the webview shows whatever dialog the host
// platform supplies, which means choosing a dark theme's greys happens in a
// bright, unthemed OS panel, offering hex and the OS's own colour model but
// nothing that helps build the RAMP a theme actually is.
//
// Two further reasons it is worth a guard rather than a code review:
//
//   * It is untestable. The dialog is a host window, so no e2e spec can drive
//     it and no component test can see it — the control could stop working
//     entirely and the whole suite would stay green.
//   * Native controls of this class have a record here. `<a download>` and
//     `<input type="file">` are both SILENTLY inert in WebKitGTK (#435, see
//     `lib/userFile.ts` and `test/fileSave.test.ts`), and the platform that
//     class of bug belongs to is the one nobody develops on. Reintroducing one
//     is a two-character mistake with no visible consequence on macOS.
//
// Same shape and same reasoning as `nativeSelect.test.ts` beside it, and as
// `src-tauri/tests/spawn_no_window.rs`. Lives at the repo root because it reads
// the SOURCE TEXT of the tree rather than rendering anything.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");

/** SHIPPED source only — a test's own prose names the very attribute it is
 *  asserting the absence of. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Comments are stripped first, so the prose explaining WHY there is no native
 *  colour input cannot trip the check that there is none. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("no native colour input in the frontend", () => {
  const files = sourceFiles(SRC);

  it("finds source files to check at all", () => {
    // A broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no type="color" input', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      // Both quote styles, and `type = "color"` with spaces.
      if (/type\s*=\s*["']color["']/.test(code)) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still exports the replacement, so this is not passing by deletion", () => {
    const picker = readFileSync(join(SRC, "design", "color-picker.tsx"), "utf8");
    expect(picker).toContain("export function PGColorSwatch(");
    // The three things that make it a picker rather than a swatch: the wheel,
    // keyboard-reachable channel sliders, and a hex field.
    expect(picker).toContain('role="slider"');
    expect(picker).toContain("paintWheelRgba");
    expect(picker).toContain('aria-label="Hex"');
  });

  it("keeps the picker reachable from the design system's entry point", () => {
    // `@/design` is the only import path the app uses; a component exported
    // from its own file but not from the barrel is one nobody finds.
    const barrel = readFileSync(join(SRC, "design", "index.ts"), "utf8");
    expect(barrel).toContain("./color-picker");
  });
});
