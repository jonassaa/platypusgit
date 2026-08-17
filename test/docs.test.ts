/**
 * @vitest-environment node
 */
// CLAUDE.md coverage (#147, #150).
//
// Lives at the repo root rather than under `src/` because it asserts things
// about `src-tauri/`, `CLAUDE.md` and `e2e/` — it is not a frontend test in any
// sense, and `test/` is the home for further doc invariants. `vite.config.ts`
// adds `test/**/*.test.ts` to `test.include` for exactly this directory.
//
// CLAUDE.md is read as authoritative by assistant sessions, so an entry that
// silently stopped existing sends work down the wrong path. It has now drifted
// three times in the same two ways: a whole module landed without reaching the
// file trees, and a command landed without reaching a command list.
//
// Both of those are mechanically checkable from the tree itself, so they are
// checked here instead of by hand. What is NOT checked is whether the prose is
// any GOOD — this only asserts a name is mentioned. Passing means "somebody
// wrote this down", never "the description is current".
//
// Deliberately not extended to `src/screens/` or bare feature-directory names:
// those are ordinary English words (History, Remote, diff, merge, update) that
// occur throughout the prose, so the assertion would pass for the wrong reason
// and never be able to fail. A check that cannot fail is worse than no check.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the project root, and `import.meta.url` is not a file: URL
// once Vite has transformed this module — so resolve against cwd, not the
// module.
const root = (rel: string) => resolve(process.cwd(), rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");

const doc = read("CLAUDE.md");

/**
 * Every id registered in `invoke_handler!`.
 *
 * Text-parsed rather than derived from a build artifact: the registry is the
 * one place a command becomes reachable from the frontend, and reading it
 * needs no cargo run.
 */
function registeredCommands(): string[] {
  const lib = read("src-tauri/src/lib.rs");
  const start = lib.indexOf("generate_handler![");
  expect(start, "generate_handler! not found in lib.rs").toBeGreaterThan(-1);
  const block = lib.slice(start, lib.indexOf("])", start));
  const ids = [...block.matchAll(/commands::[a-z_]+::([a-z_0-9]+)\s*,/g)].map(
    (m) => m[1],
  );
  expect(ids.length, "parsed no command ids").toBeGreaterThan(50);
  return [...new Set(ids)];
}

/**
 * Expand the doc's own compressed notation into the ids it stands for.
 *
 * The command lists write related commands as one group — `stage/unstage/
 * discard_paths`, `worktree_add/remove/lock/unlock/prune`, `accept_ours/theirs`
 * — because five lines of near-identical text read worse than one. That is
 * house style worth keeping, so the checker learns the notation rather than the
 * document being flattened to satisfy it.
 *
 * Both readings are generated (shared prefix from the first segment, shared
 * suffix from the last) at every `_` boundary, and the result is intersected
 * with the real registry. Over-generation is safe: every candidate is built
 * from words actually written in the file, so this can never invent a name for
 * a command nobody documented.
 */
function expandGroup(group: string): string[] {
  const segs = group.split("/");
  const out = new Set(segs);
  const splits = (s: string) =>
    [...s].flatMap((c, i) => (c === "_" ? [i + 1] : []));

  for (const at of splits(segs[0])) {
    const prefix = segs[0].slice(0, at);
    for (const seg of segs.slice(1)) out.add(prefix + seg);
  }
  const last = segs[segs.length - 1];
  for (const at of splits(last)) {
    const suffix = last.slice(at - 1);
    for (const seg of segs.slice(0, -1)) out.add(seg + suffix);
  }
  return [...out];
}

function documentedCommands(): Set<string> {
  const named = new Set(doc.match(/[a-z][a-z_0-9]*/g) ?? []);
  for (const [group] of doc.matchAll(/[a-z][a-z_0-9]*(?:\/[a-z][a-z_0-9]*)+/g)) {
    for (const id of expandGroup(group)) named.add(id);
  }
  return named;
}

describe("CLAUDE.md stays in step with the tree", () => {
  it("names every command registered in invoke_handler!", () => {
    const documented = documentedCommands();
    const missing = registeredCommands().filter((id) => !documented.has(id));

    expect(
      missing,
      `Not mentioned anywhere in CLAUDE.md: ${missing.join(", ")}.\n` +
        "Add each to the relevant `commands/<area>.rs` entry in the backend " +
        "tree — as a real entry saying what it is for, not appended to a bare " +
        "list. Joining a sibling group (`stage/unstage/discard_paths`) counts; " +
        "an irregular group the expander cannot read does not, so spell that " +
        "id out.",
    ).toEqual([]);
  });

  it("names every backend module", () => {
    const walk = (rel: string): string[] =>
      readdirSync(root(rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${rel}${e.name}/`)
          : e.name.endsWith(".rs")
            ? [e.name]
            : [],
      );

    const missing = [...new Set(walk("src-tauri/src/"))]
      .filter((name) => !doc.includes(name))
      .sort();

    expect(
      missing,
      `Backend modules absent from the src-tauri/src/ tree in CLAUDE.md: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("names every frontend feature directory", () => {
    // Requires the qualified `features/<name>` or the tree's `── <name>/`, not
    // the bare word — see the note at the top of this file.
    const missing = readdirSync(root("src/features/"), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !doc.includes(`features/${n}`) && !doc.includes(`── ${n}/`))
      .sort();

    expect(
      missing,
      `Feature directories absent from the features/ tree in CLAUDE.md: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
