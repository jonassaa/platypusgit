// "Go to parent / child commit" — graph navigation from the commit menu.
//
// The interesting cases are the ambiguous ones (a merge has two parents, a
// branch point two children) and the PAGED-LOG one: an absent child means "none
// loaded", which is not the same claim as "none exists", and the label has to
// say which.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { commitMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";
import type { CommitInfo } from "@/lib/types";

const HEAD_SHA = "a".repeat(40); // tip; nothing loaded is its child
const B = "b".repeat(40);
const MERGE = "e".repeat(40);
const SIDE = "5".repeat(40);
const C = "c".repeat(40); // parent of BOTH MERGE and SIDE → two children
const ROOT = "d".repeat(40);

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

// Newest-first: HEAD → B → MERGE(C, SIDE) → SIDE → C → ROOT.
const COMMITS = [
  mk(HEAD_SHA, "commit A", [B]),
  mk(B, "commit B", [MERGE]),
  mk(MERGE, "Merge branch 'side'", [C, SIDE]),
  mk(SIDE, "side work", [C]),
  mk(C, "commit C", [ROOT]),
  mk(ROOT, "commit root", []),
];

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

const labels = (items: ContextMenuItem[]) =>
  items.map((i) => i.label).filter((l): l is string => typeof l === "string");

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    headInfo: { branch: "main", headOid: HEAD_SHA },
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        tip: HEAD_SHA,
        tipTime: 0,
        isDefault: true,
      },
    ],
    loading: false,
  } as never);
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 1, mergeBase: C }));
});

afterEach(() => vi.restoreAllMocks());

describe("Go to parent / child commit", () => {
  it("omits both entries entirely when no onGoTo is supplied", () => {
    // The menu is used outside History, which has no selection to move. A dead
    // entry there is worse than no entry.
    const l = labels(commitMenuItems({ sha: B }));
    expect(l.some((s) => /Go to parent/.test(s))).toBe(false);
    expect(l.some((s) => /Go to child/.test(s))).toBe(false);
  });

  it("goes to the first parent inline", async () => {
    const onGoTo = vi.fn();
    await labeled(commitMenuItems({ sha: B }, { onGoTo }), /^Go to parent commit/).onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(MERGE);
  });

  it("offers a submenu of every parent for a merge", async () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: MERGE }, { onGoTo }), /^Go to parent commit/);
    expect(item.submenu).toHaveLength(2);
    expect(item.submenu?.[0].label).toBe(`${C.slice(0, 7)} — commit C`);
    expect(item.submenu?.[1].label).toBe(`${SIDE.slice(0, 7)} — side work`);
    // And it is the submenu that navigates, not the parent row.
    expect(item.onClick).toBeUndefined();
    await item.submenu?.[1].onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(SIDE);
  });

  it("is refused for the root commit, and says why", () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: ROOT }, { onGoTo }), /^Go to parent commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/root commit/);
  });

  it("goes to the one child inline", async () => {
    const onGoTo = vi.fn();
    await labeled(commitMenuItems({ sha: B }, { onGoTo }), /^Go to child commit/).onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(HEAD_SHA);
  });

  it("offers a submenu when a commit has several children", () => {
    const onGoTo = vi.fn();
    // Both MERGE and SIDE list C as a parent.
    const item = labeled(commitMenuItems({ sha: C }, { onGoTo }), /^Go to child commit/);
    expect(item.submenu).toHaveLength(2);
    expect(item.submenu?.map((s) => s.label)).toEqual([
      `${MERGE.slice(0, 7)} — Merge branch 'side'`,
      `${SIDE.slice(0, 7)} — side work`,
    ]);
  });

  // THE paged-log case. `s.commits` is a prefix of history, so the absence of a
  // child in it is a fact about the LOG, not about the repository.
  it("is refused when no child is in the loaded log, and blames the log", () => {
    const onGoTo = vi.fn();
    const item = labeled(commitMenuItems({ sha: HEAD_SHA }, { onGoTo }), /^Go to child commit/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/none in the loaded log/);
    // It must NOT claim the commit has no children.
    expect(item.label).not.toMatch(/no child exists|has no child/);
  });

  it("keeps a parent outside the loaded window navigable, without a subject", async () => {
    const onGoTo = vi.fn();
    // A log window holding only the tip: its parent is unknown but still a real
    // oid the selection can move to.
    useRepoStore.setState({ commits: [mk(HEAD_SHA, "commit A", [B])] } as never);
    const item = labeled(
      commitMenuItems({ sha: HEAD_SHA }, { onGoTo }),
      /^Go to parent commit/,
    );
    expect(item.disabled).toBeFalsy();
    await item.onClick?.();
    expect(onGoTo).toHaveBeenCalledWith(B);
  });
});
