#!/usr/bin/env node
// Fixture repositories for the large-repo benchmark (issue 257).
//
// "Slow on big repositories" is the most consistent complaint about every
// established GUI client, and "we are fast" is one of this project's two
// strongest claims. A claim with no number behind it is an adjective, so the
// benchmark needs repositories big enough to hurt — and they have to be the
// SAME repositories on every machine, or the numbers cannot be compared to
// each other, let alone to a previous run.
//
// Hence generated rather than downloaded, for three of the four. A generated
// fixture is deterministic (fixed seed, fixed timestamps, fixed author), costs
// no network, and isolates ONE dimension each:
//
//   * `deep`  — many commits over a small tree. The log walk, and nothing else.
//   * `wide`  — one commit, an enormous tree, every file dirty. `status`, and
//               nothing else.
//   * `refs`  — thousands of branches and tags over a short history. Ref
//               enumeration, and nothing else.
//
// Breadth hurts differently from depth, which is exactly why they are separate
// repositories: a single "big repo" fixture would give one number that cannot
// say which dimension moved when it regresses.
//
// The fourth, `linux`, is a real clone of torvalds/linux and is NOT generated —
// a synthetic repository cannot stand in for 1.4 million real commits, 90k real
// paths and a real pack layout, and that is the repository people actually mean
// when they say a client is slow. It is opt-in (`--linux`) because it is a
// multi-gigabyte download.
//
// Everything is written under `$PGBENCH_HOME` (default
// `~/.cache/platypusgit-bench`), never inside the repository: a fixture is a
// build artifact, it is regenerable, and `wide` alone is 50,000 files.
//
// Determinism, stated precisely. Identical inputs produce byte-identical object
// ids: the content comes from a seeded LCG, every timestamp is derived from a
// fixed epoch, and the author never varies. So `deep`'s HEAD sha is the same on
// your machine as on mine, and a fixture that drifted is visible rather than
// silent — a `<name>.fixture.json` stamp beside each one records the parameters
// and the resulting HEAD, and a shape that no longer matches is regenerated
// rather than reused.

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  renameSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Bumped when a change here would produce different repositories. A fixture
 *  whose recorded version is older is regenerated rather than reused, because
 *  comparing today's numbers against a differently-shaped repository is worse
 *  than having no previous numbers at all. */
export const FIXTURE_VERSION = 1;

/** The shapes, and why each number is the number.
 *
 *  `deep` at 50,000 commits is not arbitrary: it is the size at which
 *  GitKraken's own users report it falling over ("past ~50,000 commits, native
 *  clients beat it"), so it is the threshold the market has already identified.
 *  `wide` at 50,000 files with every one of them modified is the shape of a
 *  generated-code monorepo after a formatter run — the case where `status` is
 *  the whole cost. `refs` at 5,000 branches is a long-lived repository nobody
 *  prunes, which is most of them. */
export const SHAPES = {
  deep: { commits: 50_000, files: 16 },
  wide: { files: 50_000, dirs: 250, untracked: 5_000 },
  refs: { commits: 2_000, branches: 5_000, lightweightTags: 1_500, annotatedTags: 500 },
};

const AUTHOR = "PlatypusGit Bench <bench@platypusgit.invalid>";
/** 2023-11-14T22:13:20Z. Fixed so object ids do not depend on the clock. */
const EPOCH = 1_700_000_000;

export function benchHome() {
  return process.env.PGBENCH_HOME || join(homedir(), ".cache", "platypusgit-bench");
}

/** A tiny LCG. Deterministic across Node versions in a way `Math.random` with a
 *  seed shim is not, and the statistical quality is irrelevant here — this only
 *  has to produce bytes that do not compress to nothing. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s;
  };
}

const WORDS = [
  "handle", "buffer", "commit", "index", "refspec", "packet", "stream", "node",
  "cursor", "window", "lane", "hunk", "blob", "tree", "ref", "oid", "walk",
  "stage", "merge", "rebase", "fetch", "prune", "shard", "lock", "queue",
];

/** Plausible source-ish text. Real-looking lines matter: a file of one repeated
 *  byte deltas and packs unlike anything a user has, which would flatter every
 *  number measured against it. */
function makeLines(rand, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = WORDS[rand() % WORDS.length];
    const b = WORDS[rand() % WORDS.length];
    const c = WORDS[rand() % WORDS.length];
    out.push(`  let ${a}_${i} = ${b}(${c}, ${rand() % 9973});`);
  }
  return out.join("\n") + "\n";
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status ?? r.signal}`);
  }
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status ?? r.signal}: ${r.stderr}`);
  }
  return r.stdout.trim();
}

/** Create the repository and pin every config the numbers could otherwise
 *  depend on. Left at git's DEFAULTS on purpose: `core.untrackedCache` and
 *  `core.fsmonitor` both make `status` dramatically cheaper, and benchmarking
 *  with them on would publish a number almost nobody's repository produces. */
function initRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run("git", ["init", "--quiet", "--initial-branch=main", dir]);
  const cfg = (k, v) => run("git", ["-C", dir, "config", k, v]);
  cfg("user.name", "PlatypusGit Bench");
  cfg("user.email", "bench@platypusgit.invalid");
  cfg("commit.gpgsign", "false");
  cfg("tag.gpgsign", "false");
  cfg("core.autocrlf", "false");
  // No background repack mid-benchmark: a `gc --auto` firing during a timed run
  // is a measurement of gc, attributed to whatever op happened to be running.
  cfg("gc.auto", "0");
  cfg("gc.autoDetach", "false");
}

/** Feed a fast-import stream, respecting backpressure. The streams here reach
 *  tens of megabytes; writing them to a temp file first would double the io for
 *  no benefit, and buffering them in memory is how the wide fixture OOMs. */
function fastImport(dir, produce) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["-C", dir, "fast-import", "--quiet", "--done"],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`fast-import exited ${code}`)),
    );
    // `--done` above makes a truncated stream an ERROR rather than a silent
    // partial import, which costs exactly this one line and is worth it: a
    // fixture that quietly stopped at commit 31,000 would publish a number for
    // a repository nobody can reproduce.
    produce(child.stdin).then(
      () => child.stdin.end("done\n"),
      (e) => {
        child.stdin.destroy();
        reject(e);
      },
    );
  });
}

/** `write` that awaits drain. Without this the wide fixture's 50,000 blobs
 *  queue in Node's heap faster than git reads them. */
function writer(stream) {
  return (chunk) =>
    stream.write(chunk) ? Promise.resolve() : new Promise((r) => stream.once("drain", r));
}

function dataBlock(text) {
  return `data ${Buffer.byteLength(text)}\n${text}\n`;
}

// ---------------------------------------------------------------------------
// deep — 50,000 commits over 16 files.
// ---------------------------------------------------------------------------

async function buildDeep(dir) {
  const { commits, files } = SHAPES.deep;
  initRepo(dir);
  const rand = lcg(0x0dee9);

  await fastImport(dir, async (stdin) => {
    const w = writer(stdin);
    for (let i = 0; i < commits; i++) {
      const path = `src/module_${String(i % files).padStart(2, "0")}.rs`;
      const body = makeLines(rand, 40);
      const when = EPOCH + i * 60;
      await w(`blob\nmark :${i * 2 + 1}\n${dataBlock(body)}`);
      const msg =
        `feat(module ${i % files}): revision ${i}\n\n` +
        `Generated fixture commit ${i} of ${commits}.\n`;
      await w(
        `commit refs/heads/main\nmark :${i * 2 + 2}\n` +
          `author ${AUTHOR} ${when} +0000\n` +
          `committer ${AUTHOR} ${when} +0000\n` +
          dataBlock(msg) +
          (i === 0 ? "" : `from :${i * 2}\n`) +
          `M 100644 :${i * 2 + 1} ${path}\n\n`,
      );
    }
  });

  run("git", ["-C", dir, "reset", "--hard", "main", "--quiet"]);
  run("git", ["-C", dir, "repack", "-adq"]);
}

// ---------------------------------------------------------------------------
// wide — 50,000 files, every one of them modified, plus 5,000 untracked.
// ---------------------------------------------------------------------------

function widePath(i, dirs) {
  const d = i % dirs;
  return `pkg/${String(d).padStart(3, "0")}/gen_${String(i).padStart(6, "0")}.ts`;
}

async function buildWide(dir) {
  const { files, dirs, untracked } = SHAPES.wide;
  initRepo(dir);
  const rand = lcg(0x21de);

  await fastImport(dir, async (stdin) => {
    const w = writer(stdin);
    const marks = [];
    for (let i = 0; i < files; i++) {
      await w(`blob\nmark :${i + 1}\n${dataBlock(makeLines(rand, 12))}`);
      marks.push(i + 1);
    }
    await w(
      `commit refs/heads/main\nmark :${files + 1}\n` +
        `author ${AUTHOR} ${EPOCH} +0000\n` +
        `committer ${AUTHOR} ${EPOCH} +0000\n` +
        dataBlock("chore: the generated tree\n"),
    );
    for (let i = 0; i < files; i++) {
      await w(`M 100644 :${marks[i]} ${widePath(i, dirs)}\n`);
    }
    await w("\n");
  });

  run("git", ["-C", dir, "reset", "--hard", "main", "--quiet"]);
  run("git", ["-C", dir, "repack", "-adq"]);

  // Now dirty it. Appending rather than rewriting so the modification is a real
  // content change with an unchanged size prefix — the shape a formatter run or
  // a codemod leaves, which is the case people describe when they say a client
  // hangs on `status`.
  for (let i = 0; i < files; i++) {
    const p = join(dir, widePath(i, dirs));
    writeFileSync(p, readFileSync(p, "utf8") + "// touched by the fixture\n");
  }
  for (let i = 0; i < untracked; i++) {
    writeFileSync(join(dir, `pkg/${String(i % dirs).padStart(3, "0")}/new_${i}.ts`), "// new\n");
  }
}

// ---------------------------------------------------------------------------
// refs — 5,000 branches and 2,000 tags over 2,000 commits.
// ---------------------------------------------------------------------------

async function buildRefs(dir) {
  const { commits, branches, lightweightTags, annotatedTags } = SHAPES.refs;
  initRepo(dir);
  const rand = lcg(0x4e75);

  await fastImport(dir, async (stdin) => {
    const w = writer(stdin);
    for (let i = 0; i < commits; i++) {
      const when = EPOCH + i * 3600;
      await w(`blob\nmark :${i * 2 + 1}\n${dataBlock(makeLines(rand, 8))}`);
      await w(
        `commit refs/heads/main\nmark :${i * 2 + 2}\n` +
          `author ${AUTHOR} ${when} +0000\n` +
          `committer ${AUTHOR} ${when} +0000\n` +
          dataBlock(`chore: commit ${i}\n`) +
          (i === 0 ? "" : `from :${i * 2}\n`) +
          `M 100644 :${i * 2 + 1} src/file_${i % 32}.txt\n\n`,
      );
    }
    // Spread the refs over the whole history rather than piling them on the
    // tip: a client that enumerates refs has to peel each one, and refs that
    // all point at the same commit is the case where every cache hits.
    const at = (n) => `:${(n % commits) * 2 + 2}`;
    for (let i = 0; i < branches; i++) {
      // Foldered names, because that is what a repository with 5,000 branches
      // really looks like and it is what the branch tree has to group.
      const name = `team-${i % 40}/feature/${String(i).padStart(5, "0")}`;
      await w(`reset refs/heads/${name}\nfrom ${at(i * 7)}\n\n`);
    }
    for (let i = 0; i < lightweightTags; i++) {
      await w(`reset refs/tags/build-${String(i).padStart(5, "0")}\nfrom ${at(i * 3)}\n\n`);
    }
    for (let i = 0; i < annotatedTags; i++) {
      await w(
        `tag v1.${i}.0\nfrom ${at(i * 5)}\n` +
          `tagger ${AUTHOR} ${EPOCH + i * 7200} +0000\n` +
          dataBlock(`Release v1.${i}.0\n`),
      );
    }
  });

  run("git", ["-C", dir, "reset", "--hard", "main", "--quiet"]);
  run("git", ["-C", dir, "repack", "-adq"]);
}

// ---------------------------------------------------------------------------
// linux — the real thing.
// ---------------------------------------------------------------------------

function buildLinux(dir) {
  if (existsSync(join(dir, ".git"))) {
    console.log(`  linux: already present at ${dir}`);
    return;
  }
  const tmp = `${dir}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  console.log("  linux: cloning torvalds/linux (several GB, this takes a while)…");
  // A full clone on purpose. `--filter=blob:none` would make every diff in the
  // benchmark trigger a lazy fetch, so the numbers would be measuring the
  // network.
  run("git", ["clone", "--quiet", "https://github.com/torvalds/linux.git", tmp]);
  run("git", ["-C", tmp, "config", "gc.auto", "0"]);
  run("git", ["-C", tmp, "config", "gc.autoDetach", "false"]);
  run("git", ["-C", tmp, "config", "user.name", "PlatypusGit Bench"]);
  run("git", ["-C", tmp, "config", "user.email", "bench@platypusgit.invalid"]);
  renameSync(tmp, dir);
}

// ---------------------------------------------------------------------------

const BUILDERS = { deep: buildDeep, wide: buildWide, refs: buildRefs };

/** The stamp lives BESIDE the repository, never inside it: `wide` is measured
 *  partly by how many untracked files `status` has to report, and a stray
 *  `fixture.json` in the work tree would be one of them. */
export function stampPath(home, name) {
  return join(home, `${name}.fixture.json`);
}

/** What `bench.sh` compares against to decide whether a fixture is reusable. */
function stamp(name, dir) {
  return {
    name,
    version: FIXTURE_VERSION,
    shape: SHAPES[name] ?? null,
    head: capture("git", ["-C", dir, "rev-parse", "HEAD"]),
    generated: new Date().toISOString(),
  };
}

export function isFresh(name, home) {
  const path = stampPath(home, name);
  if (!existsSync(path)) return false;
  try {
    const have = JSON.parse(readFileSync(path, "utf8"));
    return (
      have.version === FIXTURE_VERSION &&
      JSON.stringify(have.shape) === JSON.stringify(SHAPES[name] ?? null)
    );
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const wanted = args.filter((a) => !a.startsWith("--"));
  const names = wanted.length ? wanted : Object.keys(BUILDERS);
  const home = benchHome();
  mkdirSync(home, { recursive: true });

  for (const name of names) {
    const dir = join(home, name);
    if (name === "linux") {
      buildLinux(dir);
      continue;
    }
    if (!BUILDERS[name]) throw new Error(`unknown fixture: ${name}`);
    if (!force && isFresh(name, home)) {
      console.log(`  ${name}: up to date at ${dir}`);
      continue;
    }
    const started = Date.now();
    console.log(`  ${name}: generating…`);
    await BUILDERS[name](dir);
    writeFileSync(stampPath(home, name), JSON.stringify(stamp(name, dir), null, 2) + "\n");
    console.log(`  ${name}: ready in ${((Date.now() - started) / 1000).toFixed(1)}s (${dir})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
