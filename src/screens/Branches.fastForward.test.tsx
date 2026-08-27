// The bulk "Fast-forward all" action on the Branches toolbar (#246).
//
// One fetch, then every local branch that can fast-forward moves — the Monday
// morning action. What is pinned here is the summary: the branches that did NOT
// move are the half the user has to act on, so they must survive into the toast.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { BranchInfo, BulkFastForward } from "@/lib/types";

const branch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: `origin/${over.name}`,
  ahead: 0,
  behind: 1,
  tip: "a".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...over,
});

function setup(report: BulkFastForward | null) {
  const fastForwardAllBranches = vi.fn().mockResolvedValue(report);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/feat/x" },
    status: [],
    branches: [branch({ name: "main" }), branch({ name: "feat/x", isHead: true })],
    remotes: [{ name: "origin", url: "git@example.com:me/repo.git" }],
    tags: [],
    stashes: [],
    commits: [],
    loading: false,
    activity: {},
    fastForwardAllBranches,
  } as never);
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
  return fastForwardAllBranches;
}

beforeEach(() => {
  resetInvokeMock();
  document.querySelector("[data-pg-flash]")?.remove();
});

describe("Fast-forward all", () => {
  it("is on the toolbar and runs the bulk op", async () => {
    const run = setup({ advanced: [], diverged: [], checkedOut: [] });

    fireEvent.click(screen.getByText("Fast-forward all"));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("summarizes the run, keeping the branches that did not move", async () => {
    setup({
      advanced: [
        {
          branch: "main",
          upstream: "origin/main",
          from: "a".repeat(40),
          to: "b".repeat(40),
          moved: true,
        },
      ],
      diverged: ["feat/y"],
      checkedOut: ["feat/x"],
    });

    fireEvent.click(screen.getByText("Fast-forward all"));

    await waitFor(() =>
      expect(document.querySelector("[data-pg-flash]")?.textContent).toBe(
        "Fast-forwarded main · feat/y has diverged · feat/x is checked out — pull it",
      ),
    );
  });

  it("says nothing when the op failed — the banner already did", async () => {
    const run = setup(null);

    fireEvent.click(screen.getByText("Fast-forward all"));

    // Wait for the op to have actually resolved before concluding "no toast",
    // otherwise the assertion passes before anything could have appeared.
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await run.mock.results[0].value;
    expect(document.querySelector("[data-pg-flash]")).toBeNull();
  });
});
