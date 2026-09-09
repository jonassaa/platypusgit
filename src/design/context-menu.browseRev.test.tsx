// "Show repository at this revision" — the commit menu's entry point into the
// repo browser's at-rev mode.
//
// Two halves, and the routing half is the one that has silently broken before
// (#133): the menu sets the intent, AppShell routes it, and RepoBrowser turns it
// into the same `rev` its toolbar picker writes. The unit test here covers the
// menu's half; AppShell.navroutes.test.tsx covers the routing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { commitMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import type { CommitInfo } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);

const mk = (oid: string, summary: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 0,
  parents,
  refs: [],
});

const COMMITS = [mk(A, "commit A", [B]), mk(B, "commit B", [])];

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    headInfo: { branch: "main", headOid: A },
    branches: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
});

afterEach(() => vi.restoreAllMocks());

describe("Show repository at this revision", () => {
  it("fires a browse-rev intent carrying the full oid", async () => {
    await labeled(commitMenuItems({ sha: B, subject: "commit B" }), /^Show repository/)
      .onClick?.();
    expect(useNavStore.getState().intent).toEqual({
      kind: "browse-rev",
      rev: B,
      label: `${B.slice(0, 7)} — commit B`,
    });
  });

  it("is offered for a commit that is not on this branch", () => {
    // Unlike every rewrite entry, browsing a tree reads and changes nothing, so
    // ancestry is irrelevant — a commit from any branch can be browsed.
    const OFF = "f".repeat(40);
    const item = labeled(commitMenuItems({ sha: OFF }), /^Show repository/);
    expect(item.disabled).toBeFalsy();
  });

  it("is disabled with no commit", () => {
    const item = labeled(commitMenuItems(null), /^Show repository/);
    expect(item.disabled).toBe(true);
  });

  it("sets no intent when there is no commit", async () => {
    await labeled(commitMenuItems(null), /^Show repository/).onClick?.();
    expect(useNavStore.getState().intent).toBeNull();
  });
});
