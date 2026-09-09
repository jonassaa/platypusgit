// Which pill a log row wears is decided by `RefInfo.kind` and nothing else.
//
// The name cannot answer it: a tag and a branch are both just `v1.0` or `main`,
// and a `/` belongs to plenty of names that are not remote-tracking ones. This
// used to be guessed from the string, which got three things wrong at once —
// every tag wore a branch icon, a slashed tag or local branch was split into a
// remote that does not exist, and History's "Local labels" filter (which drops
// whatever carries a `remote`) then hid both.
import { describe, expect, it } from "vitest";

import { mapCommitRefs } from "./derive";
import type { RefInfo } from "./types";

const ref = (name: string, kind: RefInfo["kind"]): RefInfo => ({ name, kind });

describe("mapCommitRefs", () => {
  it("gives a tag the tag glyph, not a branch's", () => {
    expect(mapCommitRefs([ref("v1.0.0", "Tag")], "main")).toEqual([
      { name: "v1.0.0", tone: "amber", icon: "tag", ref: "v1.0.0" },
    ]);
  });

  it("keeps a slashed tag whole rather than reading `release` as a remote", () => {
    const [pill] = mapCommitRefs([ref("release/1.0", "Tag")], "main");
    expect(pill.name).toBe("release/1.0");
    expect(pill.icon).toBe("tag");
    expect(pill.remote).toBeUndefined();
  });

  it("keeps a slashed local branch local", () => {
    // `feat/x` is the shape half this project's own branches have. Carrying a
    // `remote` here is what made them disappear under "Local labels".
    expect(mapCommitRefs([ref("feat/x", "Branch")], "main")).toEqual([
      { name: "feat/x", tone: "green", icon: "branch", ref: "feat/x" },
    ]);
  });

  it("splits a remote-tracking branch into remote and name", () => {
    expect(mapCommitRefs([ref("origin/feat/x", "Remote")], "main")).toEqual([
      {
        name: "feat/x",
        tone: "violet",
        icon: "branch",
        remote: "origin",
        ref: "origin/feat/x",
      },
    ]);
  });

  it("leaves a remote-tracking ref with no branch half readable", () => {
    // `refs/remotes/foo` is hand-made, never something git writes — but
    // splitting it blindly is an empty pill, which reads as nothing at all.
    const [pill] = mapCommitRefs([ref("foo", "Remote")], "main");
    expect(pill.name).toBe("foo");
    expect(pill.remote).toBeUndefined();
  });

  it("marks the branch HEAD points at", () => {
    expect(mapCommitRefs([ref("main", "Branch")], "main")).toEqual([
      { name: "HEAD→main", tone: "accent", icon: "branch", ref: "main" },
    ]);
  });

  it("does not hand the HEAD arrow to a tag that shares the branch's name", () => {
    // `git tag main` is legal and the two live in different namespaces. Only
    // the branch is where HEAD is.
    expect(mapCommitRefs([ref("main", "Tag")], "main")).toEqual([
      { name: "main", tone: "amber", icon: "tag", ref: "main" },
    ]);
  });

  it("names an odd ref as itself instead of dressing it as a branch", () => {
    // `refs/bisect/bad` points at a commit in the walk while a bisect runs.
    const [pill] = mapCommitRefs([ref("bisect/bad", "Other")], "main");
    expect(pill.name).toBe("bisect/bad");
    expect(pill.icon).toBe("link");
    expect(pill.remote).toBeUndefined();
  });

  it("carries git's own name for every kind, which is what an op is named with", () => {
    const names = mapCommitRefs(
      [
        ref("main", "Branch"),
        ref("origin/main", "Remote"),
        ref("v1.0.0", "Tag"),
        ref("bisect/bad", "Other"),
      ],
      "main",
    ).map((p) => p.ref);
    expect(names).toEqual(["main", "origin/main", "v1.0.0", "bisect/bad"]);
  });
});
