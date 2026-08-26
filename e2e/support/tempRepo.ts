import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export class TempRepo {
  readonly path: string;

  constructor() {
    this.path = mkdtempSync(path.join(tmpdir(), "pg-e2e-"));
    this.git("init", "-b", "main");
    this.git("config", "user.name", "E2E Tester");
    this.git("config", "user.email", "e2e@platypusgit.test");
    this.git("config", "commit.gpgsign", "false");
  }

  git(...args: string[]): string {
    return execFileSync("git", args, { cwd: this.path, encoding: "utf8" });
  }

  write(rel: string, content: string): void {
    const abs = path.join(this.path, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  read(rel: string): string {
    return readFileSync(path.join(this.path, rel), "utf8");
  }

  /**
   * Install an executable git hook (#232).
   *
   * The chmod is the whole point, and it is why this is a helper rather than a
   * `write` call in a spec: **git silently skips a non-executable hook.** A spec
   * that forgot the bit would still go green — the commit succeeds because no
   * hook ran at all, not because the flow under test works.
   */
  writeHook(name: string, body: string): void {
    const abs = path.join(this.path, ".git", "hooks", name);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    chmodSync(abs, 0o755);
  }

  commitFile(rel: string, content: string, msg: string): void {
    this.write(rel, content);
    this.git("add", rel);
    this.git("commit", "-m", msg);
  }

  headSha(): string {
    return this.git("rev-parse", "--short", "HEAD").trim();
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
  }

  hasRef(ref: string): boolean {
    try {
      this.git("rev-parse", "-q", "--verify", ref);
      return true;
    } catch {
      return false;
    }
  }
}

export function makeTempRepo(): TempRepo {
  return new TempRepo();
}

export function basicRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("a.txt", "alpha v1\n", "feat: add a.txt");
  r.commitFile("b.txt", "bravo\n", "feat: add b.txt");
  r.commitFile("a.txt", "alpha v2\n", "fix: update a.txt");
  return r;
}

export function dirtyRepo(): TempRepo {
  const r = basicRepo();
  r.write("a.txt", "alpha v3 dirty\n"); // modified, unstaged
  r.write("new.txt", "untracked\n"); // untracked
  r.write("staged.txt", "staged content\n");
  r.git("add", "staged.txt"); // staged new file
  return r;
}

/**
 * Two modified files under one directory, plus an untouched root file.
 *
 * The tree needs a real folder row to click, which `dirtyRepo` cannot give —
 * all its files sit at the repo root. Both dirty files live directly under
 * `src/` so path compaction (which merges single-child chains) leaves `src` as
 * its own clickable row. `root.txt` stays clean so a folder-scoped stage can be
 * shown NOT to touch it.
 */
export function nestedDirtyRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("src/one.txt", "one\n", "feat: one");
  r.commitFile("src/two.txt", "two\n", "feat: two");
  r.commitFile("root.txt", "root\n", "feat: root");
  r.write("src/one.txt", "one dirty\n");
  r.write("src/two.txt", "two dirty\n");
  return r;
}

/**
 * One tracked file whose CHANGED line is far longer than any diff pane — about
 * 1 100 characters, in space-separated tokens so a soft wrap has somewhere to
 * break.
 *
 * The fixture for the fixed-pitch row invariant. A unified diff row's height IS
 * the window's pitch, so a line that wraps draws over the rows below it, and
 * nothing shorter than the pane can show that: at 548px (the repo browser's diff
 * pane on the e2e window) this line takes 20 line boxes.
 */
export function longLineRepo(): TempRepo {
  const body = (tag: string) =>
    Array.from(
      { length: 24 },
      (_, i) => `segment-${tag}-${i}-of-a-very-long-single-source-line`,
    ).join(" ");
  const r = new TempRepo();
  r.commitFile(
    "long.ts",
    `// header\nexport const value = "${body("old")}";\n// footer\n`,
    "feat: long line",
  );
  r.write("long.ts", `// header\nexport const value = "${body("new")}";\n// footer\n`);
  return r;
}

export function branchyRepo(): TempRepo {
  const r = basicRepo();
  r.git("checkout", "-b", "feature");
  r.commitFile("feature.txt", "feature work\n", "feat: feature work");
  r.git("checkout", "main");
  r.git("merge", "--no-ff", "-m", "merge feature", "feature");
  return r; // 5 commits reachable from main, two lanes in graph
}

/** Many branches and tags — enough refs to overflow the Branches screen
 *  viewport (~700px content area, 28px rows). Regression fixture for the
 *  list-not-scrolling bug: the refs list must scroll internally rather than
 *  grow past the window and shove the toolbar/chrome off-screen.
 *  `git branch`/`git tag` (no checkout) keep setup fast. */
export function manyRefsRepo(): TempRepo {
  const r = basicRepo();
  for (let i = 0; i < 60; i++) {
    r.git("branch", `feature/branch-${String(i).padStart(2, "0")}`);
  }
  for (let i = 0; i < 30; i++) {
    r.git("tag", `v0.${String(i).padStart(2, "0")}.0`);
  }
  return r;
}

export function conflictRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("conflict.txt", "base\n", "feat: base");
  r.git("checkout", "-b", "clash");
  r.commitFile("conflict.txt", "theirs change\n", "feat: clash edit");
  r.git("checkout", "main");
  r.commitFile("conflict.txt", "ours change\n", "feat: main edit");
  return r; // merging clash into main conflicts on conflict.txt
}

export function conflictRepoTwoFiles(): TempRepo {
  const r = new TempRepo();
  r.commitFile("alpha.txt", "base a\n", "feat: base alpha");
  r.commitFile("beta.txt", "base b\n", "feat: base beta");
  r.git("checkout", "-b", "clash");
  r.commitFile("alpha.txt", "theirs a\n", "feat: clash alpha");
  r.commitFile("beta.txt", "theirs b\n", "feat: clash beta");
  r.git("checkout", "main");
  r.commitFile("alpha.txt", "ours a\n", "feat: main alpha");
  r.commitFile("beta.txt", "ours b\n", "feat: main beta");
  return r; // merging clash into main conflicts on both files
}

export function cherryRepo(): TempRepo {
  const r = basicRepo();
  r.git("checkout", "-b", "feature");
  r.commitFile("cherry.txt", "cherry\n", "feat: cherry commit");
  r.git("checkout", "main");
  return r; // feature is one unmerged commit ahead of shared history
}

export function multiCherryRepo(): TempRepo {
  const r = basicRepo();
  r.git("checkout", "-b", "feature");
  // Two unmerged commits adding distinct new files — cleanly cherry-pickable
  // onto main as a set (no overlap with main's tree, so no conflicts).
  r.commitFile("c.txt", "charlie\n", "feat: add c.txt");
  r.commitFile("d.txt", "delta\n", "feat: add d.txt");
  r.git("checkout", "main");
  return r; // feature is two unmerged commits ahead of shared history
}

export function rebaseConflictRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("conflict.txt", "l1\n", "feat: base line");
  r.commitFile("conflict.txt", "l1-mod\n", "feat: first edit");
  r.commitFile("conflict.txt", "l1-mid\n", "feat: middle edit");
  r.commitFile("conflict.txt", "l1-final\n", "feat: second edit");
  return r;
  // dropping "middle edit" makes "second edit" conflict on replay. Note this
  // needs 4 commits, not 3: rebase_start resets HEAD to the parent of the
  // *first surviving (non-Drop) plan step*, so a plan with only two rows
  // (drop the older, pick the newer) always resets straight to the real
  // parent of the surviving pick — conflict-free by construction. The
  // dropped commit must sit strictly BETWEEN two surviving picks for the
  // second pick's cherry-pick (base = dropped commit's tree, ours = first
  // pick's result) to actually diverge.
}

/**
 * A range with a merge commit in the middle:
 *
 *   root ── A ──── C ── M   (main)
 *            \        /
 *             ─── F ──      (feature)
 *
 * F and C touch different files, so M merges cleanly. `main` advances past the
 * branch point before merging, so this is a real merge and not a fast-forward
 * (`--no-ff` is belt-and-braces). Used by the interactive rebase spec: a rebase
 * from A must flatten M away while keeping F's content.
 */
export function mergeRangeRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("root.txt", "root\n", "feat: root");
  r.commitFile("a.txt", "a\n", "feat: a on main");
  r.git("checkout", "-b", "feature");
  r.commitFile("f.txt", "f\n", "feat: f on feature");
  r.git("checkout", "main");
  r.commitFile("c.txt", "c\n", "feat: c on main");
  r.git("merge", "--no-ff", "-m", "Merge branch 'feature'", "feature");
  return r;
}

/**
 * Two branches diverged off a common root — the shape `git rebase -i <newbase>`
 * exists for (186):
 *
 *   root ── A ── D ── E   (main, HEAD)
 *       \
 *        ─ B ── C         (other)
 *
 * Every commit touches its own file, so a replay of main onto `other` is
 * conflict-free. `other`'s tip is NOT on HEAD's ancestry, which is exactly what
 * every other rebase fixture here cannot express — and what disables the old
 * "Interactive rebase from here" item on that row.
 *
 * History's default scope is `--all`, so `other`'s commits are on screen with no
 * ref-selector step.
 */
export function divergedRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("root.txt", "root\n", "feat: root");
  r.git("checkout", "-b", "other");
  r.commitFile("b.txt", "b\n", "feat: b on other");
  r.commitFile("c.txt", "c\n", "feat: c on other");
  r.git("checkout", "main");
  r.commitFile("a.txt", "a\n", "feat: a on main");
  r.commitFile("d.txt", "d\n", "feat: d on main");
  r.commitFile("e.txt", "e\n", "feat: e on main");
  return r;
}

/** A bare repository with real commits, for driving the clone path against
 *  local disk only — no network, no credentials, no flake.
 *
 *  Distinct from `remoteRepo()` below: that pairs a *work* repo with a bare
 *  `origin` for fetch/push/pull coverage. This helper is for tests that only
 *  want something to `clone_repo` FROM — no local remote-tracking wiring, no
 *  work repo left behind.
 *
 *  Pins the bare repo's HEAD to `main` explicitly (`git init --bare -b
 *  main`, mirroring `TempRepo`'s own `git init -b main`). Don't drop `-b
 *  main`: a bare repo's default HEAD branch otherwise comes from whatever
 *  `init.defaultBranch` / system gitconfig happens to be in scope for
 *  whoever runs the suite — this machine's Xcode system gitconfig resolves
 *  `main`, but that's environment-dependent, and a bare repo whose HEAD
 *  points at a branch nothing was ever pushed to is a dangling symref:
 *  libgit2's clone follows it into an empty checkout with no error (the same
 *  trap Task 4's Rust tests hit against a libgit2-inited bare repo, which
 *  defaults to `master`). */
export interface BareRepo {
  readonly path: string;
  dispose: () => void;
}

export function bareSourceRepo(): BareRepo {
  const seed = basicRepo();
  const barePath = mkdtempSync(path.join(tmpdir(), "pg-e2e-bare-src-"));
  execFileSync("git", ["init", "--bare", "-b", "main", barePath]);
  execFileSync("git", ["push", barePath, "HEAD:refs/heads/main"], {
    cwd: seed.path,
  });
  seed.dispose();
  return {
    path: barePath,
    dispose: () => rmSync(barePath, { recursive: true, force: true }),
  };
}

/** Work repo + local bare repo wired as `origin` with upstream set.
 *  No network, no credentials: the backend shells to the system git CLI,
 *  which handles filesystem-path remotes natively. */
export interface RemotePair {
  repo: TempRepo;
  barePath: string;
  bareGit: (...args: string[]) => string;
  dispose: () => void;
}

export function remoteRepo(): RemotePair {
  const repo = basicRepo();
  const barePath = mkdtempSync(path.join(tmpdir(), "pg-e2e-bare-"));
  execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: barePath });
  repo.git("remote", "add", "origin", barePath);
  repo.git("push", "-u", "origin", "main");
  const bareGit = (...args: string[]) =>
    execFileSync("git", args, { cwd: barePath, encoding: "utf8" });
  return {
    repo,
    barePath,
    bareGit,
    dispose: () => {
      repo.dispose();
      rmSync(barePath, { recursive: true, force: true });
    },
  };
}

/** Local is 1 ahead of origin/main. Remote-tracking ref stays accurate. */
export function makeAhead(pair: RemotePair): void {
  pair.repo.commitFile("local.txt", "local\n", "feat: local-only commit");
}

/** Remote is 1 ahead; the app does NOT know yet.
 *  The remote-tracking ref is rewound too, so behind=0 until a real
 *  fetch/pull discovers the remote commit — this is what makes fetch's
 *  effect observable. Do NOT use this variant for force-push tests:
 *  a rewound remote-tracking ref makes --force-with-lease fail with
 *  "stale info" (the lease compares against refs/remotes/origin/main). */
export function makeBehind(pair: RemotePair): void {
  pair.repo.commitFile("remote.txt", "remote\n", "feat: remote-only commit");
  pair.repo.git("push", "origin", "main");
  pair.repo.git("reset", "--hard", "HEAD~1");
  pair.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** Histories diverge: remote has one commit local lacks, local has one
 *  commit remote lacks. Remote-tracking ref stays ACCURATE (no rewind):
 *  ahead=1/behind=1 render immediately, plain push is rejected as
 *  non-fast-forward, and --force-with-lease passes its lease check. */
export function makeDiverged(pair: RemotePair): void {
  pair.repo.commitFile("remote.txt", "remote\n", "feat: remote-only commit");
  pair.repo.git("push", "origin", "main");
  pair.repo.git("reset", "--hard", "HEAD~1");
  pair.repo.commitFile("diverge.txt", "diverge\n", "feat: diverging local commit");
}

// ─── #93 fixtures: submodules, linked worktrees, bisect ───────────────────────

/** An outer repo with a real submodule, plus the inner repo it points at. */
export interface SubmodulePair {
  /** The superproject — this is the repo the app opens. */
  repo: TempRepo;
  /** Worktree-relative path of the submodule. */
  subPath: string;
  dispose: () => void;
}

/**
 * Superproject with a submodule at `vendor/inner`.
 *
 * `protocol.file.allow=always` is mandatory: git ≥ 2.38 refuses the `file`
 * transport for submodules by default (CVE-2022-39253), so every local-path
 * submodule fixture has to opt in — without it `submodule add` fails with
 * "transport 'file' not allowed".
 *
 * `initialized: false` deinitializes it afterwards, which is the state a clone
 * without `--recurse-submodules` leaves behind and the one where Init is the
 * action the user needs.
 */
export function submoduleRepo(
  opts: { initialized?: boolean } = {},
): SubmodulePair {
  const inner = new TempRepo();
  inner.commitFile("lib.txt", "inner v1\n", "feat: inner");
  const repo = basicRepo();
  const subPath = "vendor/inner";
  repo.git(
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    inner.path,
    subPath,
  );
  repo.git("commit", "-m", "feat: add submodule");
  if (opts.initialized === false) {
    repo.git("submodule", "deinit", "-f", subPath);
  }
  return {
    repo,
    subPath,
    dispose: () => {
      repo.dispose();
      inner.dispose();
    },
  };
}

/**
 * An empty directory for linked worktrees to be created UNDER, outside the repo.
 *
 * A worktree must never be created inside the repository under test, and never
 * anywhere near this project's own `.claude/worktrees/` — a `worktree remove`
 * pointed at a live checkout would delete another session's work.
 */
export interface WorktreeParent {
  readonly path: string;
  dispose: () => void;
}

export function worktreeParent(): WorktreeParent {
  const dir = mkdtempSync(path.join(tmpdir(), "pg-e2e-wt-"));
  return { path: dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Nine commits whose `flag.txt` reads "good …" up to `feat: step 4` and "bad …"
 * from `feat: step 5` on, so the bisect has one right answer.
 *
 * Every commit writes DIFFERENT content: repeating a body would leave nothing to
 * commit and `git commit` would fail the fixture.
 */
export function bisectRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("flag.txt", "good 0\n", "feat: base");
  for (let i = 1; i <= 8; i++) {
    r.commitFile("flag.txt", `${i < 5 ? "good" : "bad"} ${i}\n`, `feat: step ${i}`);
  }
  return r;
}
