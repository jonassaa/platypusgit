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

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appErrorMessage,
  errorBannerLabel,
  type AppError,
} from "../src/lib/errors";

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

/**
 * SHIPPED frontend source: every `.ts`/`.tsx` under `src/` that is not a test
 * and not the jsdom harness. Same walk (and the same reason for it) as
 * `test/nativeSelect.test.ts` — the property is about what the webview renders,
 * and a test's own prose names the very thing it asserts the absence of.
 */
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

/** Comments stripped first, so prose explaining the rule cannot break it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// The banner half of the same promise, and the hole the tests above could not
// see (#212 follow-up).
//
// `appErrorMessage` was written so a banner NEVER shows the enum's spelling —
// `docs/dev/backend.md` says so in as many words. Both banners then bolted the
// kind back on in front of it:
//
//     <strong>{error.kind}:</strong><span>{appErrorMessage(error)}</span>
//
// So a fresh machine's first commit read "NoSignature: git needs a name and an
// email address…", a failed push read "Network: …", and a refused merge read
// "Git: …" — the exact defect #212 names, reintroduced one line downstream of
// the function that exists to prevent it. Everything above stayed green because
// it only ever asked `appErrorMessage`, never the surface.
//
// Two assertions close it. The first is over the REAL enum, so a variant added
// tomorrow is covered without anyone remembering this file exists; the second
// forbids the markup that caused it, anywhere in shipped `src/`.
describe("a banner never shows the enum's own spelling", () => {
  const variants = rustVariants();

  it("gives every variant either written prose or no label at all", () => {
    const leaked = variants
      .map((v) => ({
        name: v.name,
        // `as unknown as AppError`: the names come from the Rust file at run
        // time, so they are plain strings as far as the type-checker knows.
        label: errorBannerLabel({
          kind: v.name,
          message: "some prose",
        } as unknown as AppError),
      }))
      // `null` is the deliberate default: the sentence stands on its own and
      // there is nothing bold in front of it. A label is opt-in PROSE, so the
      // one thing it may never be is the discriminant it was written to hide.
      .filter(
        ({ name, label }) =>
          label !== null && (label === name || label.includes(name)),
      );
    expect(
      leaked,
      "AppError variants whose banner label is the enum's own spelling. " +
        "`errorBannerLabel` returns a human category or null — never `e.kind`. " +
        "Write a short label in ERROR_BANNER_LABELS, or leave the variant out " +
        "and let the sentence carry the banner on its own.",
    ).toEqual([]);
  });

  it("has no surface interpolating a kind into JSX text", () => {
    const files = sourceFiles(resolve(process.cwd(), "src"));
    // A broken walk would make the assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (RENDERS_A_KIND.some((re) => re.test(code))) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(
      offenders,
      "Files rendering a `.kind` discriminant as JSX text. Render an " +
        "`AppError` with `PGErrorBanner` from `@/design` — the discriminant is " +
        "for narrowing and for the log file, never for a user.",
    ).toEqual([]);
  });
});

/**
 * The two spellings that actually shipped, as source patterns.
 *
 * Narrow on purpose. `kind` is an ordinary discriminant all over this tree
 * (graph lanes, palette entries, dialog requests), and it is passed as a PROP
 * (`kind={ln.kind}`) and built into keys (`` key={`${b.kind}:${b.name}`} ``)
 * dozens of times — all legitimate, none of it text a user reads. So these
 * match only a JSX *text child*:
 *
 *   `<strong>{error.kind}:</strong>`            — Reflog's banner
 *   `{a ? "…" : b ? "…" : error.kind}`          — AppShell's banner
 *
 * Stated honestly, in the shape `spawn_no_window.rs` uses: this greps, and a
 * determined third spelling (a `const label = error.kind` hoisted out of the
 * JSX) would slip past it. `error-banner.test.tsx` is the assertion that
 * cannot be dodged — it renders the real component for every variant in the
 * real enum. This one exists to stop the CHEAP mistake, which is the one that
 * happened twice.
 */
const RENDERS_A_KIND = [
  />\s*\{\s*[A-Za-z_$][\w$.]*\.kind\s*\}/,
  /\{[^{}]*\?[^{}]*:\s*[A-Za-z_$][\w$.]*\.kind\s*\}/,
];
