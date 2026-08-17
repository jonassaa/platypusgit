// The diff entries on the History commit menus (#158). One commit and several
// commits used to be offered different comparisons: a single commit's only
// diff-shaped item was "Compare with HEAD" (commit vs the working tree), while a
// selection got "View combined diff" (a range). The commit's OWN diff — what
// Enter and the inline panel show — was in no menu at all.

import { describe, it, expect, beforeEach } from "vitest";

import {
  commitMenuItems,
  commitMultiMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import type { CommitInfo } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

const mk = (oid: string, summary: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

// Newest-first, as the log is: A → B → C → D(root).
const COMMITS = [
  mk(A, "commit A", [B]),
  mk(B, "commit B", [C]),
  mk(C, "commit C", [D]),
  mk(D, "commit D", []),
];

function labeled(items: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items.find((i) => i.label === label);
  expect(found, `no menu item labelled "${label}"`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        tip: A,
      },
    ],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
});

describe("one commit's context menu", () => {
  it('"View diff" opens the commit\'s own diff (commit-self), like Enter on the row', () => {
    labeled(commitMenuItems({ sha: B, subject: "commit B" }), "View diff").onClick?.();
    expect(useNavStore.getState().intent).toEqual({ kind: "commit-self", oid: B });
  });

  it('keeps "Compare with HEAD" — a different comparison, not a duplicate', () => {
    const items = commitMenuItems({ sha: B, subject: "commit B" });
    labeled(items, "Compare with HEAD").onClick?.();
    expect(useNavStore.getState().intent).toEqual({ kind: "commit-vs-wt", oid: B });
  });

  it("offers View diff before Compare with HEAD (own diff is the common case)", () => {
    const labels = commitMenuItems({ sha: B, subject: "commit B" })
      .map((i) => i.label)
      .filter((l): l is string => typeof l === "string");
    expect(labels.indexOf("View diff")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("View diff")).toBeLessThan(
      labels.indexOf("Compare with HEAD"),
    );
  });

  it("does nothing without a sha rather than firing a bad intent", () => {
    labeled(commitMenuItems(null), "View diff").onClick?.();
    expect(useNavStore.getState().intent).toBeNull();
  });
});

describe("the label pair", () => {
  // "View diff" / "View combined diff" read as one family, and "combined" then
  // carries information: this one spans a range. Renaming the multi item to
  // "View diff" too would hide exactly the fact the range note surfaces.
  it('a selection keeps "View combined diff", so "combined" marks the difference', () => {
    const items = commitMultiMenuItems([A, B]);
    labeled(items, "View combined diff").onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "commit-vs-commit",
      from: C,
      to: A,
    });
  });
});
