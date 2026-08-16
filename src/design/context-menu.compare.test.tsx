// The compare entries on a ref's context menu (#131).
//
// The mark pair is what stands in for a two-row selection on the Branches
// screen, so what matters is that it only offers a SECOND ref once one is
// marked, and never offers to compare a ref with itself.

import { describe, it, expect, beforeEach } from "vitest";

import {
  branchMenuItems,
  compareMenuItems,
  remoteBranchMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useCompareStore } from "@/features/compare/useCompareStore";
import { useNavStore } from "@/features/nav/useNavStore";
import type { BranchInfo } from "@/lib/types";

type Item = ContextMenuItem;

const branches: BranchInfo[] = [
  {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "a".repeat(40),
    tipTime: 0,
    isDefault: false,
  },
  {
    name: "feature",
    isHead: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "b".repeat(40),
    tipTime: 0,
    isDefault: false,
  },
];

const labels = (items: Item[]) =>
  items.map((i) => (typeof i.label === "string" ? i.label : "")).filter(Boolean);

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    branches,
  } as never);
  useCompareStore.setState({ marked: null });
  useNavStore.setState({ intent: null });
});

describe("compareMenuItems", () => {
  it("names the current branch and is disabled on it", () => {
    const onOther = compareMenuItems({ name: "feature" });
    const withCurrent = onOther.find((i) => i.label === "Compare with main")!;
    expect(withCurrent).toBeTruthy();
    expect(withCurrent.disabled).toBeFalsy();

    const onSelf = compareMenuItems({ name: "main", isCurrent: true });
    expect(onSelf.find((i) => i.label === "Compare with main")!.disabled).toBe(true);
  });

  it("offers the working tree unconditionally", () => {
    expect(labels(compareMenuItems({ name: "feature" }))).toContain(
      "Compare with working tree",
    );
  });

  it("only offers a marked pair once something is marked, and never itself", () => {
    expect(labels(compareMenuItems({ name: "feature" }))).toEqual([
      "Compare with main",
      "Compare with working tree",
      "Mark for compare",
    ]);

    useCompareStore.getState().mark("release/1.0");
    expect(labels(compareMenuItems({ name: "feature" }))).toContain(
      "Compare with release/1.0",
    );

    // On the marked ref itself there is nothing to pair it with.
    const onMarked = compareMenuItems({ name: "release/1.0" });
    expect(labels(onMarked)).not.toContain("Compare with release/1.0");
    expect(onMarked.find((i) => i.label === "Marked for compare")!.disabled).toBe(
      true,
    );
  });

  it("opening a pair sets both sides and routes to the compare screen", () => {
    const item = compareMenuItems({ name: "feature" }).find(
      (i) => i.label === "Compare with main",
    )!;
    void item.onClick?.();

    expect(useCompareStore.getState().left).toEqual({ kind: "rev", rev: "main" });
    expect(useCompareStore.getState().right).toEqual({
      kind: "rev",
      rev: "feature",
    });
    expect(useNavStore.getState().intent?.kind).toBe("ref-compare");
  });

  it("the working-tree entry puts the ref on the LEFT", () => {
    const item = compareMenuItems({ name: "feature" }).find(
      (i) => i.label === "Compare with working tree",
    )!;
    void item.onClick?.();

    expect(useCompareStore.getState().left).toEqual({
      kind: "rev",
      rev: "feature",
    });
    expect(useCompareStore.getState().right).toEqual({ kind: "workdir" });
  });
});

describe("both branch menus carry them", () => {
  it("local branch menu", () => {
    expect(labels(branchMenuItems({ name: "feature" }))).toContain(
      "Compare with working tree",
    );
  });

  it("remote branch menu", () => {
    expect(labels(remoteBranchMenuItems({ name: "origin/feature" }))).toContain(
      "Compare with working tree",
    );
  });
});
