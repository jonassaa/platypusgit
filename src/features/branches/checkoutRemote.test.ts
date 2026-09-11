// What "check out origin/x as a local branch" SAYS when the name is taken.
//
// The flow's pure half. The bug this exists for was silence: the create failed
// with "branch already exists", the checkout that unconditionally followed it
// succeeded on the stale same-named branch, and its refresh wiped the banner on
// the way past — so the user landed on a branch that had never seen the remote
// with nothing on screen to say so.
//
// The traps pinned here:
//   - the update offer must NOT appear for a branch with commits of its own
//     (it cannot be fast-forwarded) or one tracking a DIFFERENT remote ref
//     (it would be advanced along a ref this dialog never named);
//   - `ahead`/`behind` read FROM the remote ref TOWARD the local branch, and
//     reversing that pair inverts every sentence silently.

import { describe, it, expect } from "vitest";

import { existingBranchPrompt, withoutRemotePrefix } from "./checkoutRemote";

const ids = (p: { choices: { id: string }[] }) => p.choices.map((c) => c.id);
const rel = (over: Partial<{ ahead: number; behind: number; unrelated: boolean }> = {}) => ({
  ahead: 0,
  behind: 0,
  unrelated: false,
  ...over,
});

describe("withoutRemotePrefix", () => {
  it("strips only the FIRST segment, so a slashed branch name survives", () => {
    expect(withoutRemotePrefix("origin/feat/x")).toBe("feat/x");
    expect(withoutRemotePrefix("origin/main")).toBe("main");
  });

  it("leaves a name with no prefix alone", () => {
    expect(withoutRemotePrefix("main")).toBe("main");
  });
});

describe("existingBranchPrompt", () => {
  it("offers the update when the branch is strictly behind and tracks nothing", () => {
    const p = existingBranchPrompt("feat", "origin/feat", null, rel({ behind: 3 }));
    expect(ids(p)).toEqual(["update", "checkout", "rename"]);
    expect(p.choices[0].label).toBe("Check out and update to origin/feat");
    expect(p.choices[0].primary).toBe(true);
    expect(p.body).toContain("feat is 3 commits behind origin/feat.");
    expect(p.body).toContain("It tracks nothing.");
  });

  it("offers the update when it already tracks the very ref asked for", () => {
    const p = existingBranchPrompt("feat", "origin/feat", "origin/feat", rel({ behind: 1 }));
    expect(ids(p)).toContain("update");
    expect(p.body).toContain("It already tracks origin/feat.");
    // Singular, because "1 commits behind" is how a dialog loses trust.
    expect(p.body).toContain("is 1 commit behind");
  });

  it("withholds the update from a branch tracking a DIFFERENT ref", () => {
    // Fast-forwarding follows `branch.<name>.merge`, so this would advance the
    // branch along `upstream/feat` — a ref the dialog never mentioned.
    const p = existingBranchPrompt("feat", "origin/feat", "upstream/feat", rel({ behind: 3 }));
    expect(ids(p)).toEqual(["checkout", "rename"]);
    expect(p.choices[0].primary).toBe(true);
    expect(p.body).toContain("It tracks upstream/feat.");
  });

  it("withholds the update from a branch with commits of its own", () => {
    const p = existingBranchPrompt("feat", "origin/feat", null, rel({ ahead: 2, behind: 3 }));
    expect(ids(p)).toEqual(["checkout", "rename"]);
    expect(p.body).toContain("feat has 2 commits origin/feat does not, and is 3 behind it.");
  });

  it("withholds the update from a branch that is only ahead", () => {
    const p = existingBranchPrompt("feat", "origin/feat", null, rel({ ahead: 2 }));
    expect(ids(p)).toEqual(["checkout", "rename"]);
    expect(p.body).toContain("feat is 2 commits ahead of origin/feat.");
  });

  it("withholds the update when there is nothing to update to", () => {
    const p = existingBranchPrompt("feat", "origin/feat", null, rel());
    expect(ids(p)).toEqual(["checkout", "rename"]);
    expect(p.body).toContain("feat is already at origin/feat.");
  });

  it("withholds the update for unrelated histories", () => {
    // `behind` is meaningless across unrelated histories — a ref move there is
    // not a fast-forward by any definition.
    const p = existingBranchPrompt("feat", "origin/feat", null, rel({ behind: 9, unrelated: true }));
    expect(ids(p)).toEqual(["checkout", "rename"]);
    expect(p.body).toContain("feat shares no history with origin/feat.");
  });

  it("always offers a way out that is neither branch", () => {
    for (const r of [rel({ behind: 3 }), rel({ ahead: 1 }), rel({ unrelated: true })]) {
      const p = existingBranchPrompt("feat", "origin/feat", null, r);
      expect(ids(p)).toContain("rename");
    }
  });

  it("names the collision in the body — the sentence the flow used to not say", () => {
    const p = existingBranchPrompt("feat", "origin/feat", null, rel({ behind: 3 }));
    expect(p.body).toContain("A local branch named feat already exists.");
    expect(p.title).toBe("Check out the existing feat?");
  });
});
