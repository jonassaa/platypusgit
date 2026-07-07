import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictScreen } from "./Conflict";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";

vi.mock("@/features/merge/openMergeWindow", () => ({
  openMergeWindow: vi.fn().mockResolvedValue(undefined),
}));
import { openMergeWindow } from "@/features/merge/openMergeWindow";

describe("Conflict screen merge-window launchers", () => {
  beforeEach(() => {
    mockInvoke("conflict_sides", () => ({
      path: "conflict.txt", base: "b\n", ours: "o\n", theirs: "t\n", binary: false,
    }));
    useRepoStore.setState({
      current: { id: "r1", path: "/tmp/r1", name: "r1" } as never,
      repoState: "Merge",
      status: [
        {
          path: "conflict.txt",
          index: { kind: "Conflicted" },
          worktree: { kind: "Conflicted" },
        },
      ] as never,
    });
  });

  it("action-bar button opens the merge window", async () => {
    render(<ConflictScreen />);
    await userEvent.click(await screen.findByTestId("open-merge-editor"));
    expect(openMergeWindow).toHaveBeenCalledWith("r1", "conflict.txt");
  });

  it("double-clicking a conflict row opens the merge window", async () => {
    render(<ConflictScreen />);
    await userEvent.dblClick(await screen.findByTestId("conflict-row"));
    await waitFor(() => expect(openMergeWindow).toHaveBeenCalledWith("r1", "conflict.txt"));
  });
});
