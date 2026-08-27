/**
 * @vitest-environment node
 */
// CONTRIBUTING.md is the newcomer's only path from `git clone` to a running
// window (#211), and it is the one doc nothing was checking. It had already
// drifted in the two ways that matter most to somebody reading it cold:
//
//   * it promised "Three independent layers" of tests when there are four —
//     `test/docs.test.ts` will fail your build over an undocumented command,
//     and e2e was not mentioned at all, so a contributor who tried a native
//     run got a focus-stealing window and concluded the suite was broken;
//   * it linked commands and files by name, and nothing noticed when a script
//     was renamed or a doc moved.
//
// So this pins the mechanically checkable half: the links resolve, the
// commands exist, the layer count matches `docs/dev/testing.md`, and the
// build instruction still carries `--no-sign` for as long as the Tauri config
// makes a bare `pnpm tauri build` a hard error. It does NOT check that the
// prose is any good — passing means "these instructions still refer to things
// that exist", never "a newcomer can follow them".
//
// `CONTRIBUTING.md` is in `tests.yml`'s `js` path filter for this reason: a
// guard whose input can be edited without running it is decorative (#210).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = (rel: string) => resolve(process.cwd(), rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");

const contributing = read("CONTRIBUTING.md");

/** Fenced ``` blocks, contents only. */
const fencedBlocks = (md: string): string[] =>
  [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);

const commandLines = (md: string): string[] =>
  fencedBlocks(md)
    .flatMap((block) => block.split("\n"))
    // Strip trailing `# comment` annotations and line continuations.
    .map((line) => line.replace(/\s+#.*$/, "").replace(/\s*\\$/, "").trim())
    .filter(Boolean);

describe("CONTRIBUTING.md links resolve", () => {
  it("every repo-relative link points at a file that exists", () => {
    const links = [...contributing.matchAll(/\]\((\.\/[^)#]+)\)/g)].map(
      (m) => m[1],
    );

    // Guards the guard: if the link syntax ever changes, an empty match set
    // would make every assertion below vacuous.
    expect(links.length).toBeGreaterThan(5);

    for (const link of links) {
      expect(existsSync(root(link)), `CONTRIBUTING links ${link}`).toBe(true);
    }
  });

  it("names every doc in the docs/dev/ set", () => {
    // A newcomer sent to CLAUDE.md lands in the assistant's brief; docs/dev/
    // is the tour written for humans, and all five are worth finding.
    for (const doc of [
      "architecture.md",
      "frontend.md",
      "backend.md",
      "testing.md",
      "distribution.md",
    ]) {
      expect(contributing, `CONTRIBUTING does not mention ${doc}`).toContain(
        doc,
      );
    }
  });
});

describe("CONTRIBUTING.md commands exist", () => {
  const scripts: Record<string, string> = JSON.parse(
    read("package.json"),
  ).scripts;

  it("every `pnpm <name>` refers to a real script or a known passthrough", () => {
    // `pnpm install`/`exec` are pnpm's own; `tsc`, `vitest` and `tauri` are
    // binaries pnpm resolves from node_modules rather than package.json.
    const builtins = new Set(["install", "exec", "tsc", "vitest", "tauri"]);

    const invoked = commandLines(contributing)
      .filter((line) => line.startsWith("pnpm "))
      .map((line) => line.split(/\s+/)[1]);

    expect(invoked.length).toBeGreaterThan(5);

    for (const name of invoked) {
      expect(
        builtins.has(name) || name in scripts,
        `CONTRIBUTING runs \`pnpm ${name}\`, which is neither a package.json script nor a known binary`,
      ).toBe(true);
    }
  });

  it("names the command for each of the four test layers", () => {
    for (const command of [
      "cargo test --manifest-path src-tauri/Cargo.toml", // Rust integration
      "pnpm test", // vitest: unit + docs projects
      "pnpm test:e2e:docker", // e2e
      "pnpm exec tsc -p e2e/tsconfig.json --noEmit", // the CI-only typecheck
    ]) {
      expect(
        contributing.includes(command),
        `CONTRIBUTING omits \`${command}\``,
      ).toBe(true);
    }
  });

  it("agrees with docs/dev/testing.md that there are four layers", () => {
    const lower = contributing.toLowerCase();
    expect(read("docs/dev/testing.md").toLowerCase()).toContain("four layers");
    expect(
      lower.includes("four independent layers"),
      "CONTRIBUTING does not say there are four independent test layers",
    ).toBe(true);
    // The exact wording it drifted to. Cheap, and names the mistake.
    expect(
      lower.includes("three independent layers"),
      "CONTRIBUTING is back to claiming three test layers",
    ).toBe(false);
  });

  it("keeps e2e pointed at Docker", () => {
    // A native run pops a real window, steals focus and does not predict the
    // CI gate — the single most expensive thing for a newcomer to get wrong.
    expect(
      contributing.includes("Never run e2e natively"),
      "CONTRIBUTING no longer warns against a native e2e run",
    ).toBe(true);
    expect(
      commandLines(contributing).filter((line) => line === "pnpm test:e2e"),
      "CONTRIBUTING tells contributors to run the in-container e2e primitive on the host",
    ).toEqual([]);
  });
});

describe("CONTRIBUTING.md build instructions match the Tauri config", () => {
  it("requires --no-sign while the updater pubkey has no local private key", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    const signingIsMandatory =
      Boolean(conf.bundle?.createUpdaterArtifacts) &&
      Boolean(conf.plugins?.updater?.pubkey);

    // If the config ever stops forcing it, this test should be revisited
    // rather than silently keeping a stale warning in the doc.
    expect(
      signingIsMandatory,
      "tauri.conf.json no longer forces updater signing — revisit CONTRIBUTING's build section",
    ).toBe(true);

    expect(
      contributing.includes("pnpm tauri build --no-sign"),
      "CONTRIBUTING no longer shows the --no-sign build",
    ).toBe(true);
    expect(
      contributing.includes("TAURI_SIGNING_PRIVATE_KEY"),
      "CONTRIBUTING no longer names the signing-key escape hatch",
    ).toBe(true);

    const bareBuild = commandLines(contributing).filter(
      (line) => line === "pnpm tauri build",
    );
    expect(
      bareBuild,
      "CONTRIBUTING tells contributors to run a bare `pnpm tauri build`, which fails hard without the signing key",
    ).toEqual([]);
  });
});
