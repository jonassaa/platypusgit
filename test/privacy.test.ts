/**
 * @vitest-environment node
 */
// The frontend half of issue 226: **"no telemetry, no account" is a promise the
// build keeps, not a sentence in the README.**
//
// The README's comparison table (#210) puts three claims in public as the
// reason to pick this app over the alternatives:
//
//   * no telemetry — no analytics SDK, no usage reporting, no crash upload,
//   * no account — nothing to sign in to,
//   * no phoning home except git remotes, the update check, and forge APIs the
//     user configured.
//
// All three are true today, and nothing kept them true. One transitive
// dependency that "just" reports errors, or one well-meant "help us improve"
// toggle, and the README is a lie that a competitor's users would be delighted
// to point out. This repo pins load-bearing promises with guard tests rather
// than prose — `nativeSelect.test.ts` beside it, `spawn_no_window.rs` on the
// backend — and the claim we advertise deserves the same.
//
// If this test fails you are not fighting a lint rule. You are changing what
// the project promises. The README's "How it compares" table is the thing you
// are about to make untrue; change it in the same commit, on purpose.
//
// **Split with the backend half on purpose.** This file guards `src/`,
// `package.json`, `pnpm-lock.yaml` and the README claim itself;
// `src-tauri/tests/no_telemetry.rs` guards the Rust tree, its dependencies, the
// updater endpoint and the webview capabilities. The split is not aesthetic:
// `tests.yml`'s `js` filter does not match `src-tauri/`, and its `rust` filter
// does not match `README.md`, so one test spanning both trees would be skipped
// by exactly the change it polices on one side or the other — the #210 failure
// mode, where the guard shipped without its inputs in the filter and the next
// README-only PR ran no suite at all. Every input this file reads is already in
// the `js` filter (`src/`, `test/`, `package.json`, `pnpm-lock.yaml`,
// `README.md`); keep it that way, or add the file to the filter.
//
// Limits, stated honestly. A denylist is not proof of absence: it catches the
// realistic accident — a package whose name says what it does — not someone who
// reads this file first. The scan reads source text, so a host assembled at
// runtime is invisible to it, which is deliberate: self-hosted forge hosts are
// user-supplied by design (`src-tauri/src/forge/`) and must never be baked in.
// What it does guarantee is that the set of destinations *written into* the
// shipped frontend is the set argued for below.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = (rel: string) => resolve(process.cwd(), rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");
const SRC = root("src");

/** Package-name fragments that mean "this reports usage somewhere".
 *
 *  Matched against the name split on `@ / . _ -`, so `@sentry/browser` and
 *  `posthog-js` both trip on one token; entries containing a `-` are matched as
 *  a substring instead, for names that only read whole (`dd-trace`). Verified
 *  against the current tree — 38 direct and 667 locked packages — with zero
 *  false positives. Kept in step with TELEMETRY_CRATE_TOKENS in
 *  `src-tauri/tests/no_telemetry.rs`; the two ecosystems ship the same vendors.
 */
const TELEMETRY_PACKAGE_TOKENS = [
  "analytics",
  "telemetry",
  "telemetrydeck",
  "tracking",
  "segment",
  "posthog",
  "mixpanel",
  "amplitude",
  "gtag",
  "googletagmanager",
  "google-analytics",
  "hotjar",
  "fullstory",
  "logrocket",
  "smartlook",
  "openreplay",
  "sentry",
  "bugsnag",
  "rollbar",
  "raygun",
  "airbrake",
  "appcenter",
  "datadog",
  "dd-trace",
  "newrelic",
  "instabug",
  "countly",
  "matomo",
  "piwik",
  "plausible",
  "umami",
  "fathom",
  "splitbee",
  "goatcounter",
  "pirsch",
  "aptabase",
  "snowplow",
  "mparticle",
  "statsig",
  "launchdarkly",
  "firebase",
  "crashlytics",
  "opentelemetry",
];

/** Ways a webview can talk to the network or to an analytics global, none of
 *  which the frontend has any business doing: every request this app makes is
 *  made by Rust, through the two call sites pinned in
 *  `src-tauri/tests/no_telemetry.rs`.
 *
 *  Bare `fetch(` is NOT on this list, and cannot be: `useRepoStore.fetch(remote)`
 *  is git fetch, and the store method is spelled exactly the same. The two
 *  shapes that would actually reach the network — the global by name, and any
 *  call carrying a URL literal — are here, and a URL literal is caught a second
 *  time by the hostname allow-list below.
 */
const FORBIDDEN_NETWORK_APIS: Array<[RegExp, string]> = [
  [/\bwindow\.fetch\s*\(/, "window.fetch"],
  [/\bglobalThis\.fetch\s*\(/, "globalThis.fetch"],
  [/\bfetch\s*\(\s*["'`]https?:/, 'fetch("http…")'],
  [/\bsendBeacon\s*\(/, "navigator.sendBeacon"],
  [/\bnew\s+XMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bnew\s+WebSocket\b/, "WebSocket"],
  [/\bnew\s+EventSource\b/, "EventSource"],
  [/\bnavigator\.sendBeacon\b/, "navigator.sendBeacon"],
  [/\bgtag\s*\(/, "gtag (Google Analytics)"],
  [/\bdataLayer\b/, "dataLayer (Google Tag Manager)"],
  [/\b_paq\b/, "_paq (Matomo/Piwik)"],
  [/@tauri-apps\/plugin-http/, "@tauri-apps/plugin-http"],
  [/["'`]plugin:http\|/, "the http plugin over IPC"],
];

/** Every hostname that may appear in shipped frontend code, and why it is not a
 *  violation of the promise. Adding an entry is the review checkpoint: you are
 *  writing down, in public, one more host this app knows about.
 *
 *  It is short, and it should stay short — the frontend makes no requests at
 *  all. The backend's own list lives in `src-tauri/tests/no_telemetry.rs`.
 */
const ALLOWED_HOSTS: Array<[string, string]> = [
  [
    "github.com",
    "Placeholder text in the clone dialog's URL field " +
      "(`https://github.com/org/repo.git`), so the input shows the shape it " +
      "wants. It is rendered, never requested.",
  ],
  [
    "platypusgit.dev",
    "The `$schema` identifier written into an exported theme file and into an " +
      "exported settings file (#254, both in " +
      "`features/settings/useSettingsStore.ts`; `screens/Settings.tsx`). A " +
      "JSON Schema `$schema` is an identifier, not a fetch — nothing in the " +
      "app dereferences it, and no editor does either unless the USER opens " +
      "the file in one. Both exports are local file downloads: the JSON is " +
      "built in the renderer, handed to a blob URL and saved by the webview, " +
      "with no request anywhere.",
  ],
  [
    "www.platypusgit.com",
    "Part of the upgrade command shown to a sideloaded `.deb` install " +
      "(`features/update/packageHint.ts`, #187): the apt one-liner it can run " +
      "to get onto the managed path. It is a STRING IN A COPY BUTTON — the app " +
      "renders it and never requests it, and the download page serves the same " +
      "URL. The only thing that fetches it is the user's own shell, after they " +
      "chose to paste it.",
  ],
];

/** SHIPPED frontend source only. Test files and the jsdom harness are out of
 *  scope: they never reach a user's machine, and a test's own fixtures name the
 *  very things the guard asserts the absence of (`fetch("origin")` is git fetch
 *  with a remote name, and looks exactly like a network call). */
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

/** Comments are stripped so the prose explaining the rule cannot break it.
 *
 *  Unlike `nativeSelect.test.ts`, the `//` of a `scheme://` is preserved: the
 *  naive line-comment strip eats the rest of any line containing a URL, which
 *  for a hostname guard would hide every literal it exists to find. Verified —
 *  the two allow-listed hosts are only visible with this rule in place.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Hostnames literally present in `code`.
 *
 *  Skips two shapes on purpose. A single-label authority (`https://x/y.git`)
 *  cannot be a public DNS name and only shows up in fixtures. A template hole
 *  (`https://${host}/…`) is a host supplied at runtime, which is the
 *  self-hosted forge case the design requires.
 */
function hostsIn(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(
    /\bhttps?:\/\/(?:[^/\s"'`@\\]*@)?([A-Za-z0-9._-]+)/g,
  )) {
    const host = m[1].toLowerCase().replace(/\.$/, "");
    if (host.includes(".")) out.push(host);
  }
  return out;
}

function tokensOf(name: string): string[] {
  return name.toLowerCase().split(/[@/._-]+/).filter(Boolean);
}

function telemetryTokenIn(name: string): string | undefined {
  const lower = name.toLowerCase();
  const parts = tokensOf(name);
  return TELEMETRY_PACKAGE_TOKENS.find((token) =>
    token.includes("-") ? lower.includes(token) : parts.includes(token),
  );
}

describe("no telemetry, no account (issue 226)", () => {
  const files = sourceFiles(SRC);

  it("finds source files to check at all", () => {
    // A broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
  });

  it("can actually fail — the matchers recognise the thing they forbid", () => {
    // A guard that cannot fail is worse than no guard: it reads like coverage.
    expect(telemetryTokenIn("posthog-js")).toBeTruthy();
    expect(telemetryTokenIn("@sentry/browser")).toBeTruthy();
    expect(telemetryTokenIn("@vercel/analytics")).toBeTruthy();
    expect(telemetryTokenIn("mixpanel-browser")).toBeTruthy();
    // …and does not cry wolf on names that merely contain the letters. An
    // exception added to silence a false alarm is an exception added without
    // thought, which is the failure mode this whole file guards.
    expect(telemetryTokenIn("grapheme-segmenter")).toBeFalsy();
    expect(telemetryTokenIn("@codemirror/state")).toBeFalsy();
    expect(telemetryTokenIn("node-diff3")).toBeFalsy();

    const fires = (code: string) =>
      FORBIDDEN_NETWORK_APIS.some(([pattern]) => pattern.test(code));
    expect(fires('await fetch("https://tracker.example.net/collect")')).toBe(true);
    expect(fires("new WebSocket(endpoint)")).toBe(true);
    expect(fires("navigator.sendBeacon(url, body)")).toBe(true);
    // The git-fetch collision, pinned: these must stay legal forever.
    expect(fires("useRepoStore.getState().fetch(remote)")).toBe(false);
    expect(fires('store().fetch("origin")')).toBe(false);

    expect(hostsIn('const u = "https://tracker.example.net/collect";')).toEqual([
      "tracker.example.net",
    ]);
    expect(hostsIn('"https://user:token@api.github.com/repos"')).toEqual([
      "api.github.com",
    ]);
    expect(hostsIn("`https://${host}/api/v3`")).toEqual([]); // runtime host
    expect(hostsIn('"https://x/y.git"')).toEqual([]); // single-label fixture

    // The strip must remove prose without removing URLs — the whole reason it
    // differs from `nativeSelect.test.ts`'s.
    expect(stripComments("// see https://evil.example/why\nconst a = 1;")).not.toContain(
      "evil.example",
    );
    expect(stripComments('const u = "https://ok.example/x";')).toContain("ok.example");
  });

  it("has no analytics or telemetry package in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(declared.length).toBeGreaterThan(20);

    const offenders = declared
      .map((name) => [name, telemetryTokenIn(name)] as const)
      .filter(([, token]) => token)
      .map(([name, token]) => `${name} (matched \`${token}\`)`);
    expect(offenders).toEqual([]);
  });

  it("has no analytics or telemetry package anywhere in the lockfile", () => {
    // Transitive is the arrival that matters: nobody reviews a lockfile diff
    // line by line, which is exactly how an SDK gets in without a decision.
    const lock = read("pnpm-lock.yaml");
    const locked = new Set<string>();
    for (const m of lock.matchAll(/^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@/gm)) {
      locked.add(m[1]);
    }
    expect(locked.size).toBeGreaterThan(100);

    const offenders = [...locked]
      .map((name) => [name, telemetryTokenIn(name)] as const)
      .filter(([, token]) => token)
      .map(([name, token]) => `${name} (matched \`${token}\`)`)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("makes no network call and touches no analytics global in shipped src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const [pattern, label] of FORBIDDEN_NETWORK_APIS) {
        if (pattern.test(code)) {
          offenders.push(`${relative(process.cwd(), file)}: ${label}`);
        }
      }
    }
    // Every request this app makes is made by Rust, in one of the two call
    // sites pinned by `src-tauri/tests/no_telemetry.rs`. A request from the
    // webview routes around that guard, the README's disclosure, and the
    // credential rules in one move.
    //
    // Deduped: `navigator.sendBeacon` matches two patterns on purpose (the
    // property and a destructured bare call), and reporting it twice reads
    // like two problems.
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("bakes in no hostname that has not been argued for", () => {
    const allowed = new Set(ALLOWED_HOSTS.map(([host]) => host));
    const offenders: string[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const host of hostsIn(code)) {
        seen.add(host);
        if (!allowed.has(host)) {
          offenders.push(`${relative(process.cwd(), file)}: ${host}`);
        }
      }
    }

    // Add the host to ALLOWED_HOSTS with a comment saying WHY it is
    // legitimate. That comment is the review checkpoint this test exists to
    // create — a hostname in the frontend is a destination in the shipped app.
    expect([...new Set(offenders)].sort()).toEqual([]);

    // A stale entry is a hole: it lets a host reappear later without anyone
    // arguing for it, because the argument is already sitting here.
    expect(ALLOWED_HOSTS.filter(([host]) => !seen.has(host)).map(([h]) => h)).toEqual(
      [],
    );
  });

  it("still makes the promise it is protecting, and points at both guards", () => {
    // The direction that matters: quietly dropping the claim from the README
    // while leaving the tests in place would make the guards look decorative.
    // Quietly dropping the guards while leaving the claim would be worse — so
    // the README names them, and this asserts it still does.
    const readme = read("README.md");
    expect(readme).toContain("No account, no telemetry");
    expect(readme).toContain("no analytics SDK");
    expect(readme).toContain("test/privacy.test.ts");
    expect(readme).toContain("src-tauri/tests/no_telemetry.rs");
  });
});
