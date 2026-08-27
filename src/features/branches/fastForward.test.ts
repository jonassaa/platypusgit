import { describe, expect, it } from "vitest";

import type { BulkFastForward, FastForward } from "@/lib/types";
import {
  describeFastForward,
  remoteOfUpstream,
  summarizeFastForward,
} from "./fastForward";

const remotes = (...names: string[]) => names.map((name) => ({ name }));

describe("remoteOfUpstream", () => {
  it("names the remote an upstream lives on", () => {
    expect(remoteOfUpstream("origin/main", remotes("origin"))).toBe("origin");
  });

  it("keeps a remote name that contains a slash whole", () => {
    // The `upstream.split('/')[0]` shorthand answers "team" here, and a fetch
    // from a remote called "team" fails or, worse, fetches the wrong repo.
    expect(remoteOfUpstream("team/fork/main", remotes("team/fork"))).toBe(
      "team/fork",
    );
  });

  it("prefers the longest matching remote name", () => {
    expect(
      remoteOfUpstream("team/fork/main", remotes("team", "team/fork")),
    ).toBe("team/fork");
  });

  it("does not match a remote that is merely a name prefix", () => {
    // "orig" is not "origin": the boundary has to be a whole segment.
    expect(remoteOfUpstream("origin/main", remotes("orig"))).toBeNull();
  });

  it("answers null for a branch that tracks nothing", () => {
    expect(remoteOfUpstream(null, remotes("origin"))).toBeNull();
  });

  it("answers null when no configured remote matches", () => {
    expect(remoteOfUpstream("upstream/main", remotes("origin"))).toBeNull();
  });
});

const advanced = (branch: string): FastForward => ({
  branch,
  upstream: `origin/${branch}`,
  from: "a".repeat(40),
  to: "b".repeat(40),
  moved: true,
});

const report = (r: Partial<BulkFastForward>): BulkFastForward => ({
  advanced: [],
  diverged: [],
  checkedOut: [],
  ...r,
});

describe("summarizeFastForward", () => {
  it("says so when there was nothing to do", () => {
    expect(summarizeFastForward(report({}))).toBe("All branches are up to date");
  });

  it("names a single advanced branch", () => {
    expect(summarizeFastForward(report({ advanced: [advanced("main")] }))).toBe(
      "Fast-forwarded main",
    );
  });

  it("counts several advanced branches", () => {
    expect(
      summarizeFastForward(
        report({ advanced: [advanced("main"), advanced("dev")] }),
      ),
    ).toBe("Fast-forwarded 2 branches");
  });

  it("reports the diverged ones, which are the actionable half", () => {
    expect(
      summarizeFastForward(
        report({ advanced: [advanced("main")], diverged: ["feat/x"] }),
      ),
    ).toBe("Fast-forwarded main · feat/x has diverged");
  });

  it("counts several diverged branches rather than listing them all", () => {
    expect(summarizeFastForward(report({ diverged: ["a", "b", "c"] }))).toBe(
      "3 branches have diverged",
    );
  });

  it("tells the user to pull the branch they are standing on", () => {
    expect(summarizeFastForward(report({ checkedOut: ["main"] }))).toBe(
      "main is checked out — pull it",
    );
  });

  it("combines all three", () => {
    expect(
      summarizeFastForward(
        report({
          advanced: [advanced("dev")],
          diverged: ["feat/x"],
          checkedOut: ["main"],
        }),
      ),
    ).toBe("Fast-forwarded dev · feat/x has diverged · main is checked out — pull it");
  });
});

describe("describeFastForward", () => {
  it("names the branch and where it landed", () => {
    expect(describeFastForward(advanced("main"))).toBe(
      "Fast-forwarded main to origin/main",
    );
  });

  it("says nothing happened rather than staying silent", () => {
    // The action fetched first, so "no change" is information the row cannot
    // give the user by itself.
    expect(describeFastForward({ ...advanced("main"), moved: false })).toBe(
      "main is already up to date",
    );
  });
});
