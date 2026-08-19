/**
 * @vitest-environment node
 */
// The `[data-testid="X"]*=text` substring trap (found while landing issue 146).
//
// WebdriverIO compiles `[data-testid="row"]*=text` to
//
//   .//*[contains(@data-testid, "row")
//        and contains(., "text")
//        and not(.//*[contains(@data-testid, "row")])]
//
// Two things in there are load-bearing and neither is obvious: the attribute
// test is a **substring** match, and the `not(...)` clause exists to keep only
// the innermost hit. Together they mean that any OTHER testid in the tree
// containing `row` as a substring — typically a child control named after its
// container, `row-action` — satisfies the container's own condition, flips the
// `not(...)` false, and makes the container match NOTHING.
//
// The failure mode is what makes this worth a test rather than a comment:
//   - no error, no warning. `waitForDisplayed` reports the spec's own timeoutMsg
//     ("plan row missing"), so it reads as a timing flake.
//   - invisible to `pnpm test`: jsdom's `getByTestId` is an exact CSS match.
//   - invisible until the child is MOUNTED. `rebase-row-badge` sat inside
//     `rebase-row` for months without firing, because it only renders on a merge
//     row and no `*=` spec targeted one.
//
// So the check is narrow and exact: only the ids that a spec actually drives with
// `*=` are constrained, and they are constrained against every static testid in
// the tree. It can never fire for unrelated naming.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = (rel: string) => resolve(process.cwd(), rel);

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, keep));
    else if (keep(entry.name)) out.push(p);
  }
  return out;
}

/** Every literal `data-testid` value in the frontend, both JSX spellings. */
function staticTestIds(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk("src", (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map(
    (p) => root(p),
  )) {
    const src = readFileSync(file, "utf8");
    for (const re of [
      /data-testid=["']([A-Za-z0-9_-]+)["']/g,
      /"data-testid":\s*["']([A-Za-z0-9_-]+)["']/g,
    ]) {
      for (const m of src.matchAll(re)) {
        if (!found.has(m[1])) found.set(m[1], relative(process.cwd(), file));
      }
    }
  }
  return found;
}

/** Testids a spec drives with WebdriverIO's partial-text form. */
function textMatchedIds(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk("e2e", (n) => n.endsWith(".ts")).map((p) => root(p))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\[data-testid=["']([A-Za-z0-9_-]+)["']\]\*=/g)) {
      if (!found.has(m[1])) found.set(m[1], relative(process.cwd(), file));
    }
  }
  return found;
}

describe("the [data-testid=X]*=text substring trap", () => {
  const ids = staticTestIds();
  const textMatched = textMatchedIds();

  it("finds both sides to compare", () => {
    // Either walk breaking would make the assertion below vacuous.
    expect(ids.size).toBeGreaterThan(100);
    expect(textMatched.size).toBeGreaterThan(2);
  });

  it("leaves no other testid containing one that a spec text-matches", () => {
    const clashes: string[] = [];
    for (const [outer, spec] of textMatched) {
      for (const [other, file] of ids) {
        if (other !== outer && other.includes(outer)) {
          clashes.push(
            `"${other}" (${file}) contains "${outer}", which ${spec} drives with *=`,
          );
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});
