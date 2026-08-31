/**
 * @vitest-environment node
 */
// The error enum's two written promises, made mechanical (#212).
//
// CLAUDE.md states both as prose: "TS `AppError` union stays 1:1 with the Rust
// enum, updated in the same commit", and #212's acceptance criterion "every
// error a user can trigger says what happened and what to do next — no bare
// 'failed', no raw libgit2 text, no `[object Object]`". Neither was checked by
// anything, and both had already been broken by the same variant.
//
// `NoSignature` is what prompted this file. It is a UNIT variant — it carries
// no message — so `appErrorMessage` fell through to its `|| e.kind` fallback
// and rendered the literal string "NoSignature" wherever it was raised: the
// commit panel, but also merge, cherry-pick, revert, rebase, tag and stash,
// every one of which resolves a committer signature. It is also the ONE error a
// brand-new user is guaranteed to hit, because git refuses to record a commit
// until `user.name` and `user.email` are set.
//
// So this reads the Rust enum and asserts, per variant, that the TS union knows
// about it and that a banner would never show the enum's own spelling. What it
// does NOT check is whether the prose is any good — only that somebody wrote
// some.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appErrorMessage } from "../src/lib/errors";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Every variant of Rust's `AppError`, and whether it carries a payload.
 *
 * Text-parsed for the same reason `docs.test.ts` parses `invoke_handler!`: the
 * enum declaration is the single place a variant comes into existence, and
 * reading it needs no cargo run.
 */
function rustVariants(): { name: string; unit: boolean }[] {
  const src = read("src-tauri/src/error.rs");
  const start = src.indexOf("pub enum AppError {");
  expect(start, "pub enum AppError not found in error.rs").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("\n}", start));
  const variants = [...block.matchAll(/^ {4}([A-Z][A-Za-z0-9]*)(\(|,)/gm)].map(
    (m) => ({ name: m[1], unit: m[2] === "," }),
  );
  expect(variants.length, "parsed no AppError variants").toBeGreaterThan(20);
  return variants;
}

/**
 * Unit variants whose kind name may reach `appErrorMessage`'s fallback, each
 * with the reason no user ever reads it.
 *
 * An allow-list with written reasons rather than a softer assertion, in the
 * shape `test/privacy.test.ts` already uses for hard-coded hostnames: adding an
 * entry has to be a decision somebody made on purpose.
 */
const NEVER_RENDERED: Record<string, string> = {
  // Only `CliBackend`'s stubs raise it, and no shipped surface calls that
  // backend — it exists to keep the trait shape exercised. Reaching a user
  // would be a programming error, not a state to explain.
  NotImplemented:
    "raised only by CliBackend stubs, which no shipped surface calls",
  // The outcome the user asked for, not a failure. Every network catch arm
  // suppresses it via `isCancelledError` before anything is rendered — and
  // giving it prose would invite somebody to show it.
  Cancelled: "suppressed by isCancelledError; a banner here is the bug",
  // Benign: the usual cause is another process resetting the bisect, so the UI
  // refreshes rather than alarms.
  NoBisect: "the UI refreshes on it rather than reporting it",
};

describe("AppError stays 1:1 with the frontend union", () => {
  const variants = rustVariants();

  it("names every Rust variant in src/lib/errors.ts", () => {
    const ts = read("src/lib/errors.ts");
    const missing = variants
      .map((v) => v.name)
      .filter((name) => !ts.includes(`kind: "${name}"`));
    expect(
      missing,
      "Rust AppError variants with no case in the TS union. Add each as " +
        '`| { kind: "Name"; message: … }` — the union has to be updated in the ' +
        "same commit as the enum, or `isAppError` narrowing silently stops " +
        "compiling against reality.",
    ).toEqual([]);
  });

  it("never renders a variant as its own enum spelling", () => {
    const leaked = variants
      .filter((v) => v.unit && !(v.name in NEVER_RENDERED))
      // A unit variant carries no payload, which is exactly how it reaches the
      // fallback. Payload variants render their message and cannot.
      .filter((v) => appErrorMessage({ kind: v.name }) === v.name);
    expect(
      leaked,
      "Unit AppError variants whose kind name would land in a banner. Add a " +
        "case to `appErrorDetail` saying what happened and what to do next, or " +
        "— if no user can ever see it — an entry in NEVER_RENDERED with the " +
        "reason why.",
    ).toEqual([]);
  });

  it("renders something for every variant, payload or not", () => {
    // The `[object Object]` half of the promise: `isAppError` only requires a
    // string `kind`, so a variant carrying a STRUCT with no case in
    // `appErrorDetail` used to render as "[object Object]" in a banner and take
    // the screen down in React (#146).
    for (const { name } of variants) {
      const struct = appErrorMessage({
        kind: name,
        message: { some: "struct", nested: { deep: true } },
      });
      expect(struct, `${name} with a struct payload`).not.toContain(
        "[object Object]",
      );
      expect(struct.length, `${name} with a struct payload`).toBeGreaterThan(0);
    }
  });
});
