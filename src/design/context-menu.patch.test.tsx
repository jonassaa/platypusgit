// "Create patch…" enablement on both commit menus.
//
// A merge has no patch — `git format-patch` skips one SILENTLY — so the entry
// has to refuse it rather than letting the user export a series with a hole in
// it. The flow itself is covered in features/commits/createPatch.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { commitMenuItems, commitMultiMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { CommitInfo } from "@/lib/types";

const A = "a".repeat(40);
const MERGE = "e".repeat(40);
const SIDE = "5".repeat(40);
const C = "c".repeat(40);
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

// A → MERGE(C, SIDE) → SIDE → C → ROOT.
const COMMITS = [
  mk(A, "commit A", [MERGE]),
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

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    headInfo: { branch: "main", headOid: A },
    branches: [],
    loading: false,
  } as never);
});

afterEach(() => vi.restoreAllMocks());

describe("Create patch (one commit)", () => {
  it("is offered for an ordinary commit", () => {
    const item = labeled(commitMenuItems({ sha: C }), /^Create patch/);
    expect(item.disabled).toBeFalsy();
    expect(item.label).toBe("Create patch…");
  });

  it("is offered for the root commit — a first-commit patch is legitimate", () => {
    const item = labeled(commitMenuItems({ sha: ROOT }), /^Create patch/);
    expect(item.disabled).toBeFalsy();
  });

  it("is offered for a commit not on this branch — an export writes nothing", () => {
    const item = labeled(commitMenuItems({ sha: SIDE }), /^Create patch/);
    expect(item.disabled).toBeFalsy();
  });

  it("is refused for a merge commit, and says why", () => {
    const item = labeled(commitMenuItems({ sha: MERGE }), /^Create patch/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/merge commit/);
  });

  it("is refused with no commit", () => {
    const item = labeled(commitMenuItems(null), /^Create patch/);
    expect(item.disabled).toBe(true);
  });
});

describe("Create patches (a selection)", () => {
  it("is offered for a merge-free selection", () => {
    const item = labeled(commitMultiMenuItems([C, SIDE]), /^Create \d+ patches/);
    expect(item.disabled).toBeFalsy();
  });

  it("is refused when the selection contains a merge, and says why", () => {
    const item = labeled(commitMultiMenuItems([MERGE, A]), /^Create \d+ patches/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/contains a merge/);
  });
});
