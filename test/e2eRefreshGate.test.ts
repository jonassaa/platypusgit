/**
 * @vitest-environment node
 */
// The refresh gate (issue #194).
//
// An `execute()` that lands while a `browser.refresh()` navigation is
// mid-document-swap has its completion handler dropped; the driver then waits
// out the ENTIRE W3C script timeout before erroring. Uncapped on Linux CI that
// is 30 s of pure waiting, and the suite used to pay it 13-23 times per run —
// 70-80% of e2e wall time, with which specs paid moving run to run because it
// is the reload race, not the spec.
//
// The fix is an ordering rule: after a refresh, the next command must be a
// WebDriver FIND, never a script. A rule enforced by comments decays — every
// refresh site in the tree independently fired `armDriverBridge()` (an
// `execute()`) as its first post-refresh command, each one a fresh roll of the
// die — so it is enforced structurally instead:
//
//   1. `browser.refresh()` may be called from exactly one place,
//      `refreshAndSettle` in e2e/support/app.ts, which owns the ordering.
//   2. The gate every caller hands it must START with a WebDriver query. A gate
//      that starts with an in-page poll reinstates the stall while looking like
//      it obeys the rule.
//
// Both are cheap static facts, so they hold at `pnpm test` speed rather than
// after a 10-minute CI run.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = (rel: string) => resolve(process.cwd(), rel);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Source with comments blanked out — prose quoting `browser.refresh()` (this
 *  file's own header, `armDriverBridge`'s doc, the conf's) is not a call site.
 *  Newlines are preserved so line numbers still mean something. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** The argument source of each `refreshAndSettle(...)` CALL, by balanced parens.
 *  The lookbehind skips the helper's own declaration, whose parameter list would
 *  otherwise read as a gate that starts with neither kind of command. */
function gateArguments(src: string): string[] {
  const out: string[] = [];
  const call = /(?<!function )refreshAndSettle\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

const e2eFiles = walk(root("e2e")).map((f) => ({
  path: relative(root("."), f),
  src: stripComments(readFileSync(f, "utf8")),
}));

describe("e2e refresh gate", () => {
  it("keeps browser.refresh() to the single helper that owns the ordering", () => {
    const sites = e2eFiles.flatMap(({ path, src }) =>
      src.includes("browser.refresh(") ? [path] : [],
    );
    expect(sites).toEqual(["e2e/support/app.ts"]);

    const app = e2eFiles.find((f) => f.path === "e2e/support/app.ts")!;
    expect(app.src.match(/browser\.refresh\(/g)).toHaveLength(1);
    // ...and it is inside refreshAndSettle, not some other helper that grew one.
    const helper = app.src.slice(app.src.indexOf("export async function refreshAndSettle"));
    expect(helper.slice(0, helper.indexOf("\n}\n"))).toContain("browser.refresh()");
  });

  it("makes every settle gate start with a WebDriver query, not an in-page script", () => {
    // A find issued mid-swap either matches — the driver's own proof that
    // navigation is done — or misses and is re-polled for pennies. A script
    // issued mid-swap is the 30 s stall.
    const inPage = /browser\.execute\b|executeOnce\(|waitForSelector\(/;
    const webdriver = /\$\(|waitForDisplayed\(|waitForExist\(|isExisting\(|waitRepoLoaded\(/;

    const gates = e2eFiles.flatMap(({ path, src }) =>
      gateArguments(src).map((gate) => ({ path, gate })),
    );
    expect(gates.length).toBeGreaterThan(0);

    for (const { path, gate } of gates) {
      const script = gate.search(inPage);
      const query = gate.search(webdriver);
      expect(
        query >= 0 && (script < 0 || query < script),
        `${path}: refreshAndSettle gate must begin with a WebDriver query — ` +
          `an in-page script here lands mid-document-swap and stalls for the ` +
          `whole script timeout (issue #194):\n${gate.trim()}`,
      ).toBe(true);
    }
  });
});
