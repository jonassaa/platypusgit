import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WelcomeScreen } from "./Welcome";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { mockDialogOpen } from "@/test/dialogMock";
import type { RepoHandle } from "@/lib/types";

function resetStores() {
  useRepoStore.setState({
    current: null,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
  });
  useRecentsStore.setState({ recents: [] });
  localStorage.clear();
}

function wireRefreshAllMocks(): void {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
}

describe("WelcomeScreen", () => {
  beforeEach(() => {
    resetStores();
  });

  it("opens the dialog, invokes open_repo with the chosen path, and populates the store", async () => {
    const chosenPath = "/tmp/fake-repo";
    const handle: RepoHandle = {
      id: "repo-1",
      path: chosenPath,
      head: "refs/heads/main",
    };

    mockDialogOpen(chosenPath);
    mockInvoke("open_repo", (args) => {
      expect(args).toEqual({ path: chosenPath });
      return handle;
    });
    wireRefreshAllMocks();

    render(<WelcomeScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: /open repository/i }),
    );

    await waitFor(() => {
      expect(useRepoStore.getState().current).toEqual(handle);
    });

    expect(useRepoStore.getState().loading).toBe(false);
    expect(useRepoStore.getState().error).toBeNull();

    const calls = getInvokeCalls().map((c) => c.cmd);
    expect(calls).toContain("open_repo");
    expect(calls).toContain("get_status");
    expect(calls).toContain("list_branches");

    expect(useRecentsStore.getState().recents[0]?.path).toBe(chosenPath);
  });

  it("shows the PlatypusGit logo in the hero", () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId("pg-welcome-logo")).toBeInTheDocument();
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockDialogOpen(null);

    render(<WelcomeScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: /open repository/i }),
    );

    expect(getInvokeCalls()).toHaveLength(0);
    expect(useRepoStore.getState().current).toBeNull();
  });
});
