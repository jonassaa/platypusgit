import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
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
