// The Worktrees screen (#93).
//
// The load-bearing case is REMOVE. It deletes a checkout, so it is gated by a
// confirm — and when git refuses because the worktree holds uncommitted work, that
// refusal (`DirtyWorktree`) has to become a SECOND, type-the-name confirm rather
// than either an error the user shrugs at or a silent `--force`. Both halves are
// pinned here, including that a dismissed second gate deletes nothing.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorktreesScreen } from "./Worktrees";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import {
  WithDialogs,
  acceptDialog,
  dialogTitle,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import type { WorktreeInfo } from "@/lib/types";

function wt(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    name: "feature-x",
    path: "/tmp/feature-x",
    branch: "feature/x",
    headOid: "abcdef1234567890",
    locked: false,
    lockReason: null,
    prunable: false,
    isCurrent: false,
    ...over,
  };
}

function wire(items: WorktreeInfo[]) {
  mockInvoke("list_worktrees", () => items);
  mockInvoke("worktree_remove", () => undefined);
  mockInvoke("worktree_lock", () => undefined);
  mockInvoke("worktree_unlock", () => undefined);
  mockInvoke("worktree_prune", () => []);
}

async function setup(items: WorktreeInfo[]) {
  wire(items);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    branches: [],
  } as never);
  useWorktreesStore.setState({ items: [], busy: null, error: null });
  render(
    <WithDialogs>
      <WorktreesScreen />
    </WithDialogs>,
  );
  if (items.length) {
    await waitFor(() =>
      expect(screen.queryAllByTestId("worktree-row").length).toBe(items.length),
    );
  }
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("WorktreesScreen", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    vi.clearAllMocks();
  });

  it("explains what a linked worktree is when there are none", async () => {
    await setup([]);
    await waitFor(() =>
      expect(screen.getByText("No linked worktrees")).toBeInTheDocument(),
    );
  });

  it("lists a worktree with its branch and path", async () => {
    await setup([wt()]);
    const row = screen.getByTestId("worktree-row");
    expect(row.getAttribute("data-name")).toBe("feature-x");
    expect(screen.getByText("feature/x")).toBeInTheDocument();
    expect(screen.getByText(/\/tmp\/feature-x/)).toBeInTheDocument();
  });

  it("marks the worktree the app is open in, and refuses to reopen it", async () => {
    await setup([wt({ isCurrent: true })]);
    expect(
      screen.getByTestId("worktree-row").getAttribute("data-current"),
    ).toBe("1");
    expect(screen.getByText("this window")).toBeInTheDocument();
  });

  it("shows a lock reason and a missing directory", async () => {
    await setup([
      wt({ locked: true, lockReason: "on a USB drive" }),
      wt({ name: "gone", path: "/tmp/gone", prunable: true }),
    ]);
    expect(screen.getByText(/on a USB drive/)).toBeInTheDocument();
    expect(screen.getByText("directory missing")).toBeInTheDocument();
    // Nothing to open once the directory is gone.
    const openButtons = screen.getAllByTestId("worktree-open");
    expect(openButtons[1]).toBeDisabled();
  });

  it("confirms before removing, and does nothing if dismissed", async () => {
    await setup([wt()]);
    fireEvent.click(screen.getByTestId("worktree-remove"));
    await waitFor(() => expect(dialogTitle()).toContain("Remove worktree"));
    await dismissDialog();
    expect(calls("worktree_remove")).toHaveLength(0);
  });

  it("removes without force when the worktree is clean", async () => {
    await setup([wt()]);
    fireEvent.click(screen.getByTestId("worktree-remove"));
    await waitFor(() => expect(dialogTitle()).toContain("Remove worktree"));
    await acceptDialog();
    await waitFor(() => expect(calls("worktree_remove")).toHaveLength(1));
    expect(calls("worktree_remove")[0].args.force).toBe(false);
  });

  it("turns git's dirty refusal into a second, type-the-name gate", async () => {
    await setup([wt()]);
    // First attempt refuses; the forced one succeeds. This is exactly why remove
    // shells out to `git worktree remove` instead of libgit2's check-less prune.
    let attempts = 0;
    mockInvoke("worktree_remove", (args) => {
      attempts += 1;
      if (!args.force) throw { kind: "DirtyWorktree", message: "/tmp/feature-x" };
      return undefined;
    });

    fireEvent.click(screen.getByTestId("worktree-remove"));
    await waitFor(() => expect(dialogTitle()).toContain("Remove worktree"));
    await acceptDialog();

    await waitFor(() =>
      expect(dialogTitle()).toContain("has uncommitted changes"),
    );
    // Typing the name is what enables the primary button.
    await acceptDialog("feature-x");
    await waitFor(() => expect(attempts).toBe(2));
    expect(calls("worktree_remove")[1].args.force).toBe(true);
    expect(useWorktreesStore.getState().error).toBeNull();
  });

  it("leaves the worktree alone when the force gate is dismissed", async () => {
    await setup([wt()]);
    mockInvoke("worktree_remove", (args) => {
      if (!args.force) throw { kind: "DirtyWorktree", message: "/tmp/feature-x" };
      return undefined;
    });
    fireEvent.click(screen.getByTestId("worktree-remove"));
    await waitFor(() => expect(dialogTitle()).toContain("Remove worktree"));
    await acceptDialog();
    await waitFor(() =>
      expect(dialogTitle()).toContain("has uncommitted changes"),
    );
    await dismissDialog();
    await waitFor(() => expect(calls("worktree_remove")).toHaveLength(1));
    // Never forced, and no scary banner either — the user said no.
    expect(calls("worktree_remove").some((c) => c.args.force)).toBe(false);
    expect(useWorktreesStore.getState().error).toBeNull();
  });

  it("offers prune only while something is prunable, and confirms", async () => {
    await setup([wt()]);
    expect(screen.queryByTestId("worktrees-prune")).toBeNull();

    useWorktreesStore.setState({ items: [wt({ prunable: true })] });
    await waitFor(() =>
      expect(screen.getByTestId("worktrees-prune")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("worktrees-prune"));
    await waitFor(() => expect(dialogTitle()).toContain("Prune 1 worktree"));
    await acceptDialog();
    await waitFor(() => expect(calls("worktree_prune")).toHaveLength(1));
  });

  it("unlocks a locked worktree without prompting for a reason", async () => {
    await setup([wt({ locked: true, lockReason: "later" })]);
    fireEvent.click(screen.getByTestId("worktree-lock"));
    await waitFor(() => expect(calls("worktree_unlock")).toHaveLength(1));
    expect(calls("worktree_lock")).toHaveLength(0);
  });

  it("asks for a lock reason, and records an empty one as no reason", async () => {
    await setup([wt()]);
    fireEvent.click(screen.getByTestId("worktree-lock"));
    await waitFor(() => expect(dialogTitle()).toContain("Lock"));
    await acceptDialog("");
    await waitFor(() => expect(calls("worktree_lock")).toHaveLength(1));
    // An empty string is a lock with no reason — distinct from a dismissal.
    expect(calls("worktree_lock")[0].args.reason).toBeNull();
  });
});
