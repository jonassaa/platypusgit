// Set / clear branch upstream from the Branches inspector (#61 D9).
//
// The empty-vs-null contract matters here: an empty submitted prompt clears
// tracking, a dismissed prompt does nothing at all.

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BranchesScreen } from "./Branches";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import {
  WithDialogs,
  acceptDialog,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import type { BranchInfo } from "@/lib/types";

const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  name: "main",
  isHead: true,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "abc1234",
  tipTime: 0,
  isDefault: false,
  ...over,
});

function setup(over: Partial<BranchInfo> = {}, rowText = "main") {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [],
    branches: [branch(over)],
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("set_upstream", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => [branch(over)]);
  render(
    <WithDialogs>
      <BranchesScreen />
    </WithDialogs>,
  );
  // Select the branch so the inspector renders its actions.
  fireEvent.click(screen.getByText(rowText));
}

const upstreamCall = () =>
  getInvokeCalls().find((c) => c.cmd === "set_upstream");

describe("Branches upstream editing", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
  });

  it("sends the typed upstream", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /set upstream/i }));
    await acceptDialog("origin/main");

    await waitFor(() =>
      expect(upstreamCall()?.args).toMatchObject({
        branch: "main",
        upstream: "origin/main",
      }),
    );
  });

  it("clears tracking on an empty submission", async () => {
    setup({ upstream: "origin/main" });
    fireEvent.click(screen.getByRole("button", { name: /set upstream/i }));
    await acceptDialog("");

    await waitFor(() =>
      expect(upstreamCall()?.args).toMatchObject({
        branch: "main",
        upstream: null,
      }),
    );
  });

  it("does nothing when the prompt is dismissed", async () => {
    setup({ upstream: "origin/main" });
    fireEvent.click(screen.getByRole("button", { name: /set upstream/i }));
    await dismissDialog();

    expect(upstreamCall()).toBeUndefined();
  });

  it("offers no upstream action for a remote branch", () => {
    setup({ name: "origin/main", isRemote: true, isHead: false }, "origin/main");
    expect(
      screen.queryByRole("button", { name: /set upstream/i }),
    ).toBeNull();
  });
});
