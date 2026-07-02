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
