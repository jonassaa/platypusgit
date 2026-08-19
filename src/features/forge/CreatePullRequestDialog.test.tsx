import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreatePullRequestDialog } from "./CreatePullRequestDialog";
import { useForgeStore } from "./useForgeStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { BranchInfo, ForgeKind, PullRequest } from "@/lib/types";
import { pgPickOption, pgSelectValues } from "@/test/select";

function branch(name: string, isHead = false): BranchInfo {
  return {
    name,
    isHead,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "0".repeat(40),
    tipTime: 0,
    isDefault: false,
  };
}

const CREATED: PullRequest = {
  number: 121,
  title: "Forge integration",
  author: "jonassaa",
  sourceBranch: "feat/forge-integration",
  targetBranch: "main",
  url: "https://github.com/jonassaa/platypusgit/pull/121",
  draft: false,
  crossRepo: false,
  sha: "abc1234",
  updatedAt: "2026-08-14T00:00:00Z",
};

function open(kind: ForgeKind = "GitHub") {
  useForgeStore.setState({
    forge: {
      host: kind === "GitLab" ? "gitlab.com" : "github.com",
      owner: "jonassaa",
      name: "platypusgit",
      kind,
    },
    createOpen: true,
    creating: false,
    error: null,
    createdUrl: null,
    pulls: [],
  });
}

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useForgeStore.getState().reset();
  useRepoStore.setState({
    current: { id: "r1", path: "/tmp/repo", head: "feat/forge-integration" },
    branches: [
      branch("main"),
      branch("develop"),
      branch("feat/forge-integration", true),
    ],
  });
});

describe("CreatePullRequestDialog", () => {
  it("renders nothing until the store opens it", () => {
    render(<CreatePullRequestDialog />);
    expect(screen.queryByTestId("create-pr-dialog")).not.toBeInTheDocument();
  });

  it("seeds a title from the current branch and picks main as the target", () => {
    open();
    render(<CreatePullRequestDialog />);
    expect(screen.getByTestId("create-pr-title")).toHaveValue("Forge integration");
    // The head branch is the source and is never offered as a target.
    expect(screen.getByTestId("create-pr-source")).toHaveTextContent(
      "feat/forge-integration",
    );
    expect(screen.getByTestId("create-pr-target")).toHaveValue("main");
    expect(pgSelectValues(screen.getByTestId("create-pr-target"))).toEqual([
      "main",
      "develop",
    ]);
  });

  it("uses GitLab's wording for a GitLab project", () => {
    open("GitLab");
    render(<CreatePullRequestDialog />);
    expect(screen.getByText("New merge request")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create merge request/ }),
    ).toBeInTheDocument();
  });

  it("refuses to submit without a title", async () => {
    open();
    render(<CreatePullRequestDialog />);
    await userEvent.clear(screen.getByTestId("create-pr-title"));
    expect(screen.getByTestId("create-pr-submit")).toBeDisabled();
  });

  it("submits the form as a NewPullRequest and closes", async () => {
    open();
    mockInvoke("forge_create_pull_request", () => CREATED);
    render(<CreatePullRequestDialog />);

    await userEvent.clear(screen.getByTestId("create-pr-title"));
    await userEvent.type(screen.getByTestId("create-pr-title"), "PR / MR integration");
    await userEvent.type(screen.getByTestId("create-pr-body"), "why this change");
    pgPickOption(screen.getByTestId("create-pr-target"), "develop");
    await userEvent.click(screen.getByTestId("create-pr-draft"));
    await userEvent.click(screen.getByTestId("create-pr-submit"));

    await waitFor(() => {
      const call = getInvokeCalls().find(
        (c) => c.cmd === "forge_create_pull_request",
      );
      expect(call?.args.request).toEqual({
        title: "PR / MR integration",
        body: "why this change",
        sourceBranch: "feat/forge-integration",
        targetBranch: "develop",
        draft: true,
      });
    });
    // The created URL is the payoff; the screen shows it after the form closes.
    await waitFor(() => {
      expect(useForgeStore.getState().createOpen).toBe(false);
      expect(useForgeStore.getState().createdUrl).toBe(
        "https://github.com/jonassaa/platypusgit/pull/121",
      );
    });
  });

  it("keeps the form open and shows the forge's own message on failure", async () => {
    open();
    mockInvoke("forge_create_pull_request", () => {
      throw {
        kind: "Forge",
        message: "HTTP 422: A pull request already exists for jonassaa:feat/x",
      };
    });
    render(<CreatePullRequestDialog />);
    await userEvent.click(screen.getByTestId("create-pr-submit"));
    // A validation failure the user can act on must not close the form and lose
    // everything they typed.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A pull request already exists",
    );
    expect(screen.getByTestId("create-pr-dialog")).toBeInTheDocument();
  });

  it("blocks submission on a detached HEAD and says why", () => {
    useRepoStore.setState({ branches: [branch("main"), branch("develop")] });
    open();
    render(<CreatePullRequestDialog />);
    expect(
      screen.getByText("HEAD is detached — check out a branch first."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("create-pr-submit")).toBeDisabled();
  });

  it("cancels without calling the forge", async () => {
    open();
    render(<CreatePullRequestDialog />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useForgeStore.getState().createOpen).toBe(false);
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain(
      "forge_create_pull_request",
    );
  });
});
