// "Rebase current onto this — interactive" from the three menus that can name a
// new base (186).
//
// The traps this file pins:
//   - it is a SECOND action, not a re-enable of "Interactive rebase from here".
//     That one makes the clicked commit the oldest replayed commit; this one makes
//     it the new BASE, which is not in the plan. So the two are never both enabled
//     for one commit: the new item is disabled precisely when the old one is not.
//   - the branch items name the branch's `tip`, a FULL oid, so the plan and its
//     counts describe one fixed commit even if a fetch moves the ref. `tip` was
//     once truncated to 7 chars, so nothing here may shorten it.
//   - an unknown branch falls back to the NAME as a revspec rather than emitting
//     a `base: null` the screen would have to special-case.

import { describe, it, expect, beforeEach } from "vitest";

import {
  branchMenuItems,
  commitMenuItems,
  remoteBranchMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import type { BranchInfo, CommitInfo } from "@/lib/types";

const HEAD_OID = "a".repeat(40);
const MID = "b".repeat(40);
const ROOT = "d".repeat(40);
const OFF_BRANCH = "f".repeat(40);

const mk = (oid: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: `commit ${oid.slice(0, 1)}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

const branch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: null,
  tipTime: 0,
  isDefault: false,
  ...over,
});

/**
 * HEAD is `main` at HEAD_OID; OFF_BRANCH is loaded but unreachable from it.
 * MID is on-branch AND has a parent — "Interactive rebase from here" needs one,
 * so a root commit could not stand in for it.
 */
const COMMITS = [
  mk(HEAD_OID, [MID]),
  mk(OFF_BRANCH, [MID]),
  mk(MID, [ROOT]),
  mk(ROOT, []),
];

const OTHER_TIP = "c".repeat(40);

function labeled(items: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items.find((i) => i.label === label);
  expect(found, `no menu item labelled "${label}"`).toBeTruthy();
  return found!;
}

const ONTO_LABEL = "Rebase current onto this — interactive…";

beforeEach(() => {
  useNavStore.setState({ intent: null });
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    branches: [
      branch({ name: "main", isHead: true, tip: HEAD_OID }),
      branch({ name: "other", tip: OTHER_TIP }),
      branch({ name: "origin/other", isRemote: true, tip: OTHER_TIP }),
    ],
    loading: false,
  } as never);
});

describe("commit menu", () => {
  it("names an off-branch commit as the new base", () => {
    const items = commitMenuItems({ sha: OFF_BRANCH, subject: "commit f" });
    const item = labeled(items, "Rebase current branch onto this…");
    expect(item.disabled).toBeFalsy();

    item.onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "rebase-onto",
      base: OFF_BRANCH,
      label: `${OFF_BRANCH.slice(0, 7)} — commit f`,
    });
  });

  it("is disabled — and says why — for a commit already on this branch", () => {
    const items = commitMenuItems({ sha: MID, subject: "commit b" });
    const item = labeled(
      items,
      "Rebase current branch onto this — already on this branch",
    );
    expect(item.disabled).toBe(true);
  });

  it("is the complement of 'Interactive rebase from here', never its twin", () => {
    // On-branch: the old item works, the new one is off.
    const onBranch = commitMenuItems({ sha: MID, subject: "commit b" });
    expect(labeled(onBranch, "Interactive rebase from here").disabled).toBeFalsy();
    // Off-branch: exactly the other way round.
    const offBranch = commitMenuItems({ sha: OFF_BRANCH, subject: "commit f" });
    expect(
      labeled(offBranch, "Interactive rebase from here — not on this branch")
        .disabled,
    ).toBe(true);
    expect(
      labeled(offBranch, "Rebase current branch onto this…").disabled,
    ).toBeFalsy();
  });
});

describe("branch menus", () => {
  it("names a local branch's FULL tip oid, not its name and not a prefix", () => {
    const item = labeled(branchMenuItems({ name: "other" }), ONTO_LABEL);
    expect(item.disabled).toBeFalsy();

    item.onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "rebase-onto",
      base: OTHER_TIP,
      label: "other",
    });
  });

  it("is disabled for the current branch — rebasing onto yourself is a no-op", () => {
    const item = labeled(
      branchMenuItems({ name: "main", current: true }),
      ONTO_LABEL,
    );
    expect(item.disabled).toBe(true);
  });

  it("names a remote branch's tip, and is never disabled", () => {
    const item = labeled(remoteBranchMenuItems({ name: "origin/other" }), ONTO_LABEL);
    expect(item.disabled).toBeFalsy();

    item.onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "rebase-onto",
      base: OTHER_TIP,
      label: "origin/other",
    });
  });

  it("falls back to the branch name when its tip is unknown", () => {
    useRepoStore.setState({ branches: [] } as never);
    labeled(branchMenuItems({ name: "other" }), ONTO_LABEL).onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "rebase-onto",
      base: "other",
      label: "other",
    });
  });
});
