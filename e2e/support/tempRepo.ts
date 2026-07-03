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

export function conflictRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("conflict.txt", "base\n", "feat: base");
  r.git("checkout", "-b", "clash");
  r.commitFile("conflict.txt", "theirs change\n", "feat: clash edit");
  r.git("checkout", "main");
  r.commitFile("conflict.txt", "ours change\n", "feat: main edit");
  return r; // merging clash into main conflicts on conflict.txt
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
