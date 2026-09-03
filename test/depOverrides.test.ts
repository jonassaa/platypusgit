/**
 * @vitest-environment node
 */
// The standing half of issue 346: **the `pnpm.overrides` security block is the
// only thing fixing 20+ advisories, and the routine way it dies is a merge.**
//
// Every npm Dependabot alert this repo gets against the root project is
// `development` scope and transitive-only. Dependabot cannot fix any of them:
// its security updater bumps manifest entries and never writes
// `pnpm.overrides`. So the fix is hand-written in `package.json` — and a
// Dependabot npm PR regenerates the lockfile and **drops the whole block**.
// Merge one of those without restoring it and 20+ advisories come back silently,
// with no test failing and nothing in the diff that looks like a security
// change. That is the exact failure this file exists to make loud.
//
// It guards two things, because the block surviving is not the same as the fix
// surviving:
//
//   1. every security override key is still present in `package.json`, and
//   2. no version actually resolved in `pnpm-lock.yaml` is below the advisory's
//      first patched version — which also catches a block that was kept but a
//      lockfile that was never regenerated against it.
//
// If this test fails, do NOT delete the entry to make it pass. Restore the
// block (`git show origin/main:package.json`), re-run `pnpm install`, and check
// the lockfile diff. The reasoning behind each entry, and the one advisory
// deliberately left open (`extract-zip`, which has no patched version at all),
// are in `docs/dev/testing.md`; the one shipped advisory we cannot fix
// (`glib`) is in `docs/dev/distribution.md`.
//
// One entry in `FLOORS` has NO matching override key, on purpose: `esbuild`.
// `vite` 7.3.6 widened its range to `^0.27.0 || ^0.28.0`, which deduped the
// vulnerable 0.27.7 out of the tree without us overriding anything. That fix
// lives in someone else's version range, so this floor is the only thing
// holding it — a `vite` pin or downgrade would quietly bring 0.27.x back.
//
// **Deliberately NOT a version-drift test.** It asserts a floor, never a
// ceiling, so an ordinary bump past the floor keeps it green. And an unguarded
// MAJOR is allowed through on purpose: the advisory ranges below are
// major-scoped, so a future `ws` 9.x or `undici` 8.x is a new question rather
// than a regression of this one. Widen the table when that happens.
//
// Its inputs (`package.json`, `pnpm-lock.yaml`, `test/`) are all already in
// `tests.yml`'s `js` change-filter — the #210 failure mode is a guard whose
// inputs the filter does not match, which gets skipped by exactly the change it
// polices. Keep it that way.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The advisory floor for each guarded package, keyed by major.
 *
 *  `min` is the advisory's `first_patched_version`, not the version currently
 *  resolved — the point is the floor, so a routine bump does not fail this. */
const FLOORS: Array<{
  name: string;
  major: number;
  min: string;
  why: string;
}> = [
  { name: "@babel/core", major: 7, min: "7.29.6", why: "GHSA-4x5r-pxfx-6jf8 — arbitrary file read via sourceMappingURL" },
  { name: "brace-expansion", major: 1, min: "1.1.16", why: "GHSA-3jxr-9vmj-r5cp — exponential-time expansion DoS" },
  { name: "brace-expansion", major: 2, min: "2.1.2", why: "GHSA-3jxr-9vmj-r5cp — exponential-time expansion DoS" },
  { name: "browserslist", major: 4, min: "4.28.7", why: "GHSA-73wf-gq98-2v4g crash/prototype write in normalizeStats + GHSA-c83g-rgw3-j3cx unbounded cache growth" },
  // The one entry with no override key — see the note at the top of the file.
  { name: "esbuild", major: 0, min: "0.28.1", why: "GHSA-g7r4-m6w7-qqqr — dev-server arbitrary file read; deduped out by vite >= 7.3.6, not by an override" },
  { name: "fast-xml-parser", major: 5, min: "5.10.1", why: "GHSA-8r6m-32jq-jx6q — DOCTYPE resets entity expansion limits" },
  { name: "form-data", major: 4, min: "4.0.6", why: "GHSA-hmw2-7cc7-3qxx — CRLF injection in multipart field names" },
  { name: "ip-address", major: 10, min: "10.3.1", why: "GHSA-mwp4-54f8-5fhr — leading-zero octets decoded as decimal, SSRF bypass" },
  { name: "js-yaml", major: 4, min: "4.3.1", why: "GHSA-5p4m-2wfm-xmqj — quadratic CPU in !!omap resolution" },
  { name: "serialize-javascript", major: 7, min: "7.0.5", why: "GHSA-5c6j-r48x-rmvq + GHSA-qj8w-gfj5-8c6v — RCE and CPU-exhaustion DoS" },
  { name: "undici", major: 6, min: "6.28.0", why: "GHSA-8xcm-r25x-g524 + GHSA-v3r7-h72x-cjcm + GHSA-m8rv-5g2x-5cg5" },
  { name: "undici", major: 7, min: "7.29.0", why: "GHSA-4cwx-7wf7-3272 + GHSA-jr45-8vmc-qm54 and three more" },
  { name: "ws", major: 8, min: "8.21.0", why: "GHSA-96hv-2xvq-fx4p — memory-exhaustion DoS from tiny fragments" },
];

/** The override keys that must exist in `package.json`.
 *
 *  Two majors of one package coexist for `undici` and `brace-expansion`, so
 *  those MUST use the `pkg@major` selector form. A bare `"undici": "^7"` would
 *  drag `webdriver`, which wants 6.x, across a major and break the e2e runner
 *  — so the selector is not cosmetic and the key shape is part of the fix. */
const REQUIRED_KEYS = [
  "@babel/core",
  "brace-expansion@1",
  "brace-expansion@2",
  "browserslist",
  "fast-xml-parser",
  "form-data",
  "ip-address",
  "js-yaml",
  "serialize-javascript",
  "undici@6",
  "undici@7",
  "ws",
];

/** Numeric compare of two dotted versions. Prerelease tags are cut off first:
 *  nothing here is pinned to one, and a prerelease below the floor should fail
 *  rather than parse as NaN and slip through. */
function lte(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return true;
}

describe("the pnpm.overrides security block survives (#346)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  const overrides = pkg.pnpm?.overrides ?? {};

  it("still pins the broken @wdio/tauri-service dep", () => {
    // Not a security entry — it pins a BROKEN dep, and predates #346. It lives
    // in the same block, so a dropped block takes it out too and the e2e runner
    // stops working. See docs/dev/testing.md.
    expect(overrides["@wdio/native-utils"]).toBe("2.5.0");
  });

  it.each(REQUIRED_KEYS)("still overrides %s", (key) => {
    expect(
      overrides[key],
      `pnpm.overrides["${key}"] is gone. A Dependabot npm PR regenerates the ` +
        `lockfile and drops the whole overrides block — restore it from ` +
        `origin/main and re-run pnpm install before merging. See ` +
        `docs/dev/testing.md.`,
    ).toBeTruthy();
  });

  it("uses the pkg@major selector form where two majors coexist", () => {
    // A bare key here would force every major onto one range. That is the
    // difference between fixing an advisory and breaking the e2e runner.
    for (const name of ["undici", "brace-expansion"]) {
      expect(
        overrides[name],
        `pnpm.overrides["${name}"] is a bare key. Two majors of ${name} ` +
          `coexist in this tree; use the ${name}@<major> selector form.`,
      ).toBeUndefined();
    }
  });
});

describe("no resolved version sits below its advisory floor (#346)", () => {
  const lock = read("pnpm-lock.yaml");

  /** Every version of `name` that the lockfile actually resolves. Reads the
   *  `packages:`/`snapshots:` keys, which are the resolved versions — not the
   *  requested ranges, which is what makes this an assertion about what gets
   *  installed rather than about what someone asked for.
   *
   *  The full `major.minor.patch` shape is required, not a bare leading digit:
   *  the lockfile also records the override table itself, where our own
   *  `undici@6` / `brace-expansion@1` SELECTOR keys sit at the same
   *  indentation. A looser pattern reads those selectors as versions and the
   *  floor check then fails against "6". */
  function resolved(name: string): string[] {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+[^:'(]*)`, "gm");
    return [...lock.matchAll(re)].map((m) => m[1].trim());
  }

  it("finds the lockfile it is meant to be reading", () => {
    // Cheap canary: if the lockfile format changes shape, `resolved()` starts
    // returning [] for everything and every assertion below passes vacuously.
    expect(resolved("undici").length).toBeGreaterThan(0);
    expect(resolved("ws").length).toBeGreaterThan(0);
  });

  // A plain loop rather than `it.each`: the `$major` placeholder renders as
  // `undefined` in the test name, which makes a real failure read as
  // "'undici' undefined is at or above '7.29.0'".
  for (const { name, major, min, why } of FLOORS) {
    it(`${name} ${major}.x is at or above ${min}`, () => {
      const offenders = resolved(name)
        .filter((v) => Number.parseInt(v.split(".")[0], 10) === major)
        .filter((v) => !lte(min, v));

      expect(
        offenders,
        `${name}@${offenders.join(", ")} is below ${min} (${why}). The ` +
          `override may still be in package.json while the lockfile was never ` +
          `regenerated against it — re-run pnpm install.`,
      ).toEqual([]);
    });
  }
});
