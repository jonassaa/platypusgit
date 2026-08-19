/**
 * @vitest-environment node
 */
// "No native `<select>` anywhere in `src/`" — issue 146.
//
// WebKitGTK maps a native `<select>` as a GDK popup surface, and GDK's Wayland
// backend refuses to map a popup that would not be the topmost one ("Tried to
// map a popup with a non-top most parent", gtk#5639). `PGSelect` was the one
// producer of that surface, and it was mounted twice on the launch screen and
// once per row on the Rebase screen; it is now an in-page listbox
// (`src/design/primitives.tsx`).
//
// This guard is here because reintroducing one is a two-character mistake with
// no visible consequence on macOS or Windows — the platform this class of bug
// belongs to is the one nobody develops on. Same shape as
// `src-tauri/tests/spawn_no_window.rs`, which forbids `Command::new` outside
// `proc.rs` for the same "invisible on the developer's machine" reason.
//
// Lives at the repo root, not under `src/`, because it reads the SOURCE TEXT of
// the tree rather than rendering anything — a node test, in the `docs` vitest
// project, like `docs.test.ts` beside it.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");

/** SHIPPED source only. Test files and the jsdom harness are excluded because
 *  the guard is about what the webview renders, and a test's own prose names
 *  the very tag it is asserting the absence of. */
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

/** Comments are stripped first, so the prose explaining WHY there is no
 *  `<select>` cannot trip the check that there is none. A `//` inside a string
 *  (a URL) truncates the rest of that line, which can only make this more
 *  lenient — never a false positive. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("no native <select> in the frontend (issue 146)", () => {
  const files = sourceFiles(SRC);

  it("finds source files to check at all", () => {
    // A broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no <select> or <option> JSX element", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/<select[\s/>]/.test(code) || /<option[\s/>]/.test(code)) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still exports the replacement, so this is not passing by deletion", () => {
    const primitives = readFileSync(join(SRC, "design", "primitives.tsx"), "utf8");
    expect(primitives).toContain("export function PGSelect(");
    expect(primitives).toContain('role="combobox"');
    expect(primitives).toContain('role="listbox"');
    expect(primitives).toContain('role="option"');
  });
});
