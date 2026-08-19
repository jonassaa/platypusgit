// Checking out a commit's OWN branch from the History commit menu (#179).
//
// The menu offered "Check out this commit" (detached HEAD) and "Create branch
// from here…", so a commit that already had a branch on it had no way to check
// THAT branch out — you had to leave for the branch chip, the Branches screen or
// the palette. Checking the branch out is almost always the intent on such a
// commit, so it now sits ABOVE the detached entry, which stays.
//
// The traps this file pins:
//   - `BranchInfo.tip` is a FULL oid. It was once truncated to 7 chars and every
//     comparison against `CommitInfo.oid` failed silently, so the match is on
//     full oids and a 7-char prefix must NOT produce entries.
//   - a remote-only ref must never silently detach — it goes through the
//     create-tracking-branch prompt, `createBranch(local, remote)` then
//     `checkoutBranch(local)`.
//   - the payload stayed `{ sha, subject }`: the branches come from the store,
//     so a caller passing no refs still gets today's menu.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { commitMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { BranchInfo, CommitInfo } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

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

const COMMITS = [mk(A, [B]), mk(B, [C]), mk(C, [])];

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

function setBranches(branches: BranchInfo[]) {
  useRepoStore.setState({ branches } as never);
}

const labels = (items: ContextMenuItem[]) =>
  items.map((i) => (typeof i.label === "string" ? i.label : "")).filter(Boolean);

function labeled(items: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items.find((i) => i.label === label);
  expect(found, `no menu item labelled "${label}"`).toBeTruthy();
  return found!;
}

/** Every call the store's checkoutBranch makes, in order. */
const invokedCmds = () => getInvokeCalls().map((c) => c.cmd);
const checkoutCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "checkout_branch");
const createCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "create_branch");

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: COMMITS,
    status: [],
    branches: [],
    loading: false,
  } as never);
  // checkoutBranch is stash → checkout → pop → refreshAll, so the whole
  // refresh fan-out has to answer or the action throws before checking out.
  mockInvoke("stash_save", () => null);
  mockInvoke("checkout_branch", () => undefined);
  mockInvoke("create_branch", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: COMMITS, nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("no branch on the commit", () => {
  it("leaves the menu exactly as it was — no checkout-branch entry at all", () => {
    setBranches([branch({ name: "main", isHead: true, tip: A })]);
    const items = commitMenuItems({ sha: B, subject: "commit B" });
    expect(labels(items).filter((l) => l.startsWith("Check out"))).toEqual([
      "Check out this commit",
    ]);
  });

  it("degrades with no branches loaded, which is the payload-compat case", () => {
    setBranches([]);
    const items = commitMenuItems({ sha: A, subject: "commit A" });
    expect(labels(items)).toContain("Check out this commit");
    expect(labels(items).some((l) => l.includes('"'))).toBe(false);
  });

  it("offers nothing for a commit with no sha", () => {
    setBranches([branch({ name: "main", tip: A })]);
    expect(labels(commitMenuItems(null)).filter((l) => l.startsWith("Check out"))).toEqual([
      "Check out this commit",
    ]);
  });
});

describe("one branch on the commit", () => {
  it("offers it inline, above the detached-HEAD entry", () => {
    setBranches([
      branch({ name: "main", isHead: true, tip: C }),
      branch({ name: "feature", tip: A }),
    ]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l).toContain('Check out "feature"');
    expect(l.indexOf('Check out "feature"')).toBeLessThan(
      l.indexOf("Check out this commit"),
    );
    // Inline, not wrapped in a submenu.
    expect(l).not.toContain("Check out branch");
  });

  it("checks the branch out through the store's one checkout path", async () => {
    setBranches([
      branch({ name: "main", isHead: true, tip: C }),
      branch({ name: "feature", tip: A }),
    ]);
    await labeled(
      commitMenuItems({ sha: A, subject: "commit A" }),
      'Check out "feature"',
    ).onClick?.();
    await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
    expect(checkoutCalls()[0].args).toMatchObject({ name: "feature" });
    // The auto-stash half of checkoutBranch, i.e. it really is that action and
    // not a second checkout path bolted onto the menu.
    expect(invokedCmds().indexOf("stash_save")).toBeLessThan(
      invokedCmds().indexOf("checkout_branch"),
    );
  });

  it("lists the CURRENT branch disabled rather than hiding it", () => {
    setBranches([branch({ name: "main", isHead: true, tip: A })]);
    const items = commitMenuItems({ sha: A, subject: "commit A" });
    const entry = labeled(items, 'Check out "main" — current branch');
    expect(entry.disabled).toBe(true);
  });

  it("matches on the FULL oid — a 7-char prefix is not a branch tip", () => {
    // The truncation regression: BranchInfo.tip was once 7 chars and every
    // comparison against CommitInfo.oid silently failed.
    setBranches([branch({ name: "feature", tip: A.slice(0, 7) })]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l.filter((x) => x.startsWith("Check out"))).toEqual([
      "Check out this commit",
    ]);
  });

  it("does not match a null tip against a commit", () => {
    setBranches([branch({ name: "unborn", tip: null })]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l.filter((x) => x.startsWith("Check out"))).toEqual([
      "Check out this commit",
    ]);
  });
});

describe("a remote-only ref on the commit", () => {
  it("creates a tracking branch and checks THAT out — it never detaches", async () => {
    setBranches([
      branch({ name: "main", isHead: true, tip: C }),
      branch({ name: "origin/feature", isRemote: true, tip: A }),
    ]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    const entry = labeled(
      commitMenuItems({ sha: A, subject: "commit A" }),
      'Check out "origin/feature" as a new local branch…',
    );
    void entry.onClick?.();

    // The prompt defaults to the ref name WITHOUT its remote prefix.
    const input = (await screen.findByTestId("dialog-input")) as HTMLInputElement;
    expect(input.value).toBe("feature");
    await acceptDialog();
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args).toMatchObject({
      name: "feature",
      from: "origin/feature",
    });
    await waitFor(() => expect(checkoutCalls()).toHaveLength(1));
    expect(checkoutCalls()[0].args).toMatchObject({ name: "feature" });
    // A bare checkout of the remote ref would have detached HEAD.
    expect(invokedCmds()).not.toContain("checkout_ref");
  });

  it("drops a remote whose local counterpart is at the same commit", () => {
    // `main` and `origin/main` on one commit is the everyday case; offering both
    // would make the common commit a two-item submenu whose second entry only
    // ever prompts for a name that is already taken.
    setBranches([
      branch({ name: "main", tip: A }),
      branch({ name: "origin/main", isRemote: true, tip: A }),
    ]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l).toContain('Check out "main"');
    expect(l).not.toContain('Check out "origin/main" as a new local branch…');
    expect(l).not.toContain("Check out branch");
  });

  it("keeps a remote whose local counterpart is somewhere ELSE", () => {
    setBranches([
      branch({ name: "main", isHead: true, tip: C }),
      branch({ name: "origin/main", isRemote: true, tip: A }),
    ]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l).toContain('Check out "origin/main" as a new local branch…');
  });
});

describe("several branches on the commit", () => {
  it("collapses them into one submenu instead of a row each", () => {
    setBranches([
      branch({ name: "main", isHead: true, tip: A }),
      branch({ name: "feature", tip: A }),
      branch({ name: "origin/other", isRemote: true, tip: A }),
    ]);
    const items = commitMenuItems({ sha: A, subject: "commit A" });
    const group = labeled(items, "Check out branch");
    expect(labels(group.submenu ?? [])).toEqual([
      // Locals before remotes, each in the ONE branch ordering (#135) — here
      // equal tipTime, so name ascending.
      'Check out "feature"',
      'Check out "main" — current branch',
      'Check out "origin/other" as a new local branch…',
    ]);
    // No loose duplicates left at the top level.
    expect(labels(items).filter((l) => l.startsWith("Check out"))).toEqual([
      "Check out branch",
      "Check out this commit",
    ]);
  });

  it("puts the group above the detached-HEAD entry too", () => {
    setBranches([
      branch({ name: "one", tip: A }),
      branch({ name: "two", tip: A }),
    ]);
    const l = labels(commitMenuItems({ sha: A, subject: "commit A" }));
    expect(l.indexOf("Check out branch")).toBeGreaterThanOrEqual(0);
    expect(l.indexOf("Check out branch")).toBeLessThan(
      l.indexOf("Check out this commit"),
    );
  });
});
