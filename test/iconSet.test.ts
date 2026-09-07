/**
 * @vitest-environment node
 */
// Guards the two properties that make the icon set swappable and typo-proof.
//
// 1. `lucide-react` is imported by `src/design/icons.tsx` and NOTHING else.
//    That one file is the whole seam: the set behind `PGIcon` was hand-drawn
//    SVG paths before it was lucide, and the swap was a one-file change only
//    because no other surface had reached past `PGIcon` to the library. A
//    direct `import { GitBranch } from "lucide-react"` somewhere in a feature
//    is what quietly ends that.
//
// 2. Every icon name written as a STRING LITERAL at a call site is a member of
//    `IconName`. `PGIconProps.name` is `IconName | string` on purpose — the
//    fallback glyph has to be reachable at runtime for a name that arrives from
//    data — but that widening also means the type checker cannot see a typo in
//    `icon="refhesh"`. It renders a dashed square instead, which is easy to
//    ship without noticing: `Reflog.tsx` shipped `icon="refresh"` against a
//    union that had no `refresh`, and nothing failed.
//
// Lives at the repo root rather than under `src/`, because it reads the SOURCE
// TEXT of the tree instead of rendering anything — a node test in the `docs`
// vitest project, like `nativeSelect.test.ts` and `docs.test.ts` beside it.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");
const ICONS_FILE = join(SRC, "design", "icons.tsx");

/** SHIPPED source only — the same walk `nativeSelect.test.ts` uses. Test files
 *  are excluded because a test may legitimately name a bogus icon to assert the
 *  fallback glyph renders. */
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

/** The members of the `IconName` union, read out of its declaration. */
function declaredIconNames(): Set<string> {
  const src = readFileSync(ICONS_FILE, "utf8");
  const start = src.indexOf("export type IconName =");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(";", start);
  expect(end).toBeGreaterThan(start);
  const union = src.slice(start, end);
  return new Set([...union.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!));
}

describe("the icon set", () => {
  const files = sourceFiles(SRC);
  const names = declaredIconNames();

  it("finds source files and declared names at all", () => {
    // A broken walk or a failed parse would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
    expect(names.size).toBeGreaterThan(60);
  });

  it("imports lucide-react only from src/design/icons.tsx", () => {
    const importers: string[] = [];
    for (const file of files) {
      if (/from\s+["']lucide-react["']/.test(readFileSync(file, "utf8"))) {
        importers.push(relative(SRC, file));
      }
    }
    expect(importers).toEqual(["design/icons.tsx"]);
  });

  it("maps every declared name to a glyph", () => {
    // `Record<IconName, LucideIcon>` already makes a missing entry a type
    // error; this catches the record being emptied or stubbed out wholesale.
    const src = readFileSync(ICONS_FILE, "utf8");
    const body = src.slice(src.indexOf("const ICONS"), src.indexOf("const STROKE_GRID_SCALE"));
    for (const name of names) {
      expect(body, `ICONS is missing "${name}"`).toMatch(
        new RegExp(`\\b${name}:\\s*[A-Z]`),
      );
    }
  });

  it("uses no icon name that IconName does not declare", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      const used = new Set<string>();
      // `icon="…"` — PGIconButton, PGButton, PGEmpty, PGStatusItem, context
      // menu items, settings page `meta`, the nav registry.
      for (const m of code.matchAll(/\bicon="([a-zA-Z]+)"/g)) used.add(m[1]!);
      // `<PGIcon … name="…" />` — PGIcon has no children, so the first `/>`
      // after the tag closes it.
      for (const el of code.matchAll(/<PGIcon\b[\s\S]*?\/>/g)) {
        const m = /\bname="([a-zA-Z]+)"/.exec(el[0]);
        if (m) used.add(m[1]!);
      }
      for (const name of used) {
        if (!names.has(name)) offenders.push(`${relative(SRC, file)}: "${name}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares the pane-placement pair the diff-layout toggle switches between", () => {
    expect(names.has("panelBottom")).toBe(true);
    expect(names.has("panelRight")).toBe(true);
  });
});
