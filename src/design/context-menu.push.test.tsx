// "Push all up to here…" enablement.
//
// Two gates, and each one prevents a different kind of surprise: pushing a
// commit HEAD cannot reach would publish a foreign branch's history to this
// branch's ref, and with no upstream there is no destination to infer — a
// guessed `origin/<branch>` publishes to a remote nobody chose.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { commitMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { CommitInfo } from "@/lib/types";

const HEAD_SHA = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const OFF_BRANCH = "f".repeat(40);

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

const COMMITS = [
  mk(HEAD_SHA, "commit A", [B]),
  mk(OFF_BRANCH, "on another branch", [C]),
  mk(B, "commit B", [C]),
  mk(C, "commit C", []),
];

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

function tracking(upstream: string | null) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    headInfo: { branch: "main", headOid: HEAD_SHA },
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream,
        ahead: 0,
        behind: 0,
        tip: HEAD_SHA,
        tipTime: 0,
        isDefault: true,
      },
    ],
    remotes: [{ name: "origin", url: null }],
    status: [],
    loading: false,
  } as never);
}

beforeEach(() => tracking("origin/main"));
afterEach(() => vi.restoreAllMocks());

describe("Push all up to here", () => {
  it("is offered for a commit on this branch with an upstream", () => {
    const item = labeled(commitMenuItems({ sha: B }), /^Push all up to here/);
    expect(item.disabled).toBeFalsy();
    expect(item.label).toBe("Push all up to here…");
  });

  it("is refused for a commit not on this branch, and says why", () => {
    const item = labeled(commitMenuItems({ sha: OFF_BRANCH }), /^Push all up to here/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/not on this branch/);
  });

  it("is refused when the branch tracks nothing, and says why", () => {
    tracking(null);
    const item = labeled(commitMenuItems({ sha: B }), /^Push all up to here/);
    expect(item.disabled).toBe(true);
    expect(item.label).toMatch(/tracks nothing/);
  });

  it("is refused with no commit", () => {
    const item = labeled(commitMenuItems(null), /^Push all up to here/);
    expect(item.disabled).toBe(true);
  });

  it("is offered for HEAD itself — pushing the whole branch is a legitimate case", () => {
    const item = labeled(commitMenuItems({ sha: HEAD_SHA }), /^Push all up to here/);
    expect(item.disabled).toBeFalsy();
  });
});
