import { describe, expect, it } from "vitest";

import type { PullRequest } from "@/lib/types";
import {
  checksIcon,
  checksTone,
  forgeLabel,
  localBranchFor,
  prAbbrev,
  prNoun,
  prNounPlural,
  prNumberLabel,
  titleFromBranch,
} from "./forgeLabels";

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: "Add a thing",
    author: "someone",
    sourceBranch: "feat/thing",
    targetBranch: "main",
    url: "https://example.com/pull/42",
    draft: false,
    crossRepo: false,
    sha: "abc1234",
    updatedAt: "2026-08-14T00:00:00Z",
    ...over,
  };
}

describe("forge vocabulary", () => {
  it("uses each forge's own word for the thing", () => {
    expect(prNoun("GitHub")).toBe("pull request");
    expect(prNoun("GitLab")).toBe("merge request");
    expect(prNounPlural("GitLab")).toBe("merge requests");
    // Nothing detected yet: fall back to the more widely understood word.
    expect(prNoun(null)).toBe("pull request");
  });

  it("uses each forge's own number sigil", () => {
    // `#12` is an ISSUE on GitLab; a merge request is `!12`.
    expect(prNumberLabel("GitHub", 12)).toBe("#12");
    expect(prNumberLabel("GitLab", 12)).toBe("!12");
    expect(prAbbrev("GitHub")).toBe("PR");
    expect(prAbbrev("GitLab")).toBe("MR");
    expect(forgeLabel("GitLab")).toBe("GitLab");
  });
});

describe("localBranchFor", () => {
  it("keeps a same-repo request's own branch name", () => {
    expect(localBranchFor(pr({ sourceBranch: "feat/thing" }), "GitHub")).toBe(
      "feat/thing",
    );
    expect(localBranchFor(pr({ sourceBranch: "release/2.0" }), "GitLab")).toBe(
      "release/2.0",
    );
  });

  it("numbers a fork request instead of reusing its branch name", () => {
    // A fork's `main` landing on your `main` is the failure this prevents.
    expect(
      localBranchFor(pr({ crossRepo: true, sourceBranch: "main", number: 7 }), "GitHub"),
    ).toBe("pr-7");
    expect(
      localBranchFor(pr({ crossRepo: true, sourceBranch: "main", number: 7 }), "GitLab"),
    ).toBe("mr-7");
  });

  it("never returns a name git would refuse for a fork request", () => {
    const name = localBranchFor(pr({ crossRepo: true, sourceBranch: "-rf" }), "GitHub");
    expect(name.startsWith("-")).toBe(false);
    expect(name).toMatch(/^pr-\d+$/);
  });
});

describe("checks presentation", () => {
  it("maps each verdict to a distinct tone and glyph", () => {
    const tones = (["Success", "Pending", "Failure", "None"] as const).map(checksTone);
    expect(new Set(tones).size).toBe(4);
    expect(checksIcon("Success")).toBe("check");
    expect(checksIcon("Failure")).toBe("error");
    expect(checksIcon("Pending")).toBe("clock");
    expect(checksIcon("None")).toBe("circle");
  });
});

describe("titleFromBranch", () => {
  it("turns a branch name into a sentence-cased title", () => {
    expect(titleFromBranch("feat/forge-integration")).toBe("Forge integration");
    expect(titleFromBranch("fix/head_marks")).toBe("Head marks");
    expect(titleFromBranch("cleanup")).toBe("Cleanup");
    // Deep prefixes: only the last segment is the subject.
    expect(titleFromBranch("team/feat/add-thing")).toBe("Add thing");
  });

  it("falls back to the branch when nothing is left to title", () => {
    expect(titleFromBranch("feat/")).toBe("feat/");
    expect(titleFromBranch("")).toBe("");
  });
});
