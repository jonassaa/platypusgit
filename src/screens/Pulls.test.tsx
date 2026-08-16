import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PullsScreen } from "./Pulls";
import { useForgeStore } from "@/features/forge/useForgeStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, dialogTitle, dismissDialog } from "@/test/dialog";
import type { BranchInfo, ForgeDetection, PullRequest, RepoHandle } from "@/lib/types";

const REPO: RepoHandle = { id: "r1", path: "/tmp/repo", head: "main" };

const GH: ForgeDetection = {
  remote: "origin",
  host: "github.com",
  owner: "jonassaa",
  name: "platypusgit",
  kind: "GitHub",
};

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 118,
    title: "HEAD indicator becomes six marks",
    author: "jonassaa",
    sourceBranch: "feat/head-marks",
    targetBranch: "main",
    url: "https://github.com/jonassaa/platypusgit/pull/118",
    draft: false,
    crossRepo: false,
    sha: "6d15cfe",
    updatedAt: "2026-08-14T00:00:00Z",
    ...over,
  };
}

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

function seedRepo() {
  useRepoStore.setState({
    current: REPO,
    branches: [branch("main"), branch("feat/head-marks", true)],
  });
}

/**
 * Put the store in a "signed in, list loaded" state AND make the screen's own
 * mount-time `detect()` reproduce it.
 *
 * Seeding state alone is not enough: `PullsScreen` re-detects on every repo
 * change (remotes are per-repo, so a stale detection would list another
 * project's requests), and the default `forge_detect` mock would immediately
 * wipe the seed.
 */
function seedForge(partial: Partial<ReturnType<typeof useForgeStore.getState>>) {
  const state = {
    repoId: "r1",
    detection: GH,
    forge: { host: "github.com", owner: "jonassaa", name: "platypusgit", kind: "GitHub" as const },
    signedIn: true,
    pulls: [] as PullRequest[],
    selected: null as number | null,
    checks: {},
    hostKinds: {},
    logins: {},
    loading: false,
    creating: false,
    checkingOut: false,
    authBusy: false,
    error: null,
    createOpen: false,
    createdUrl: null,
    ...partial,
  };
  useForgeStore.setState(state);
  mockInvoke("forge_detect", () => state.detection);
  mockInvoke("forge_token_status", () => ({
    host: state.detection?.host ?? "github.com",
    signedIn: true,
    login: null,
  }));
  mockInvoke("forge_list_pull_requests", () => state.pulls);
}

/**
 * Render and wait until the screen's own mount-time `detect()` has settled.
 *
 * Without this, a find-then-click races the detect: React re-renders when the
 * store lands and the click hits a detached node, so the handler never runs.
 */
async function renderSettled(ui: React.ReactElement): Promise<void> {
  render(ui);
  await waitFor(() =>
    expect(useForgeStore.getState().loading).toBe(false),
  );
  await waitFor(() =>
    expect(useForgeStore.getState().detection).not.toBeUndefined(),
  );
}

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useNavStore.setState({ intent: null });
  useRepoStore.setState({ current: null, branches: [] });
  useForgeStore.getState().reset();
  // The screen re-detects on mount; keep it a no-op unless a case overrides it.
  mockInvoke("forge_detect", () => null);
  mockInvoke("forge_token_status", () => ({
    host: "github.com",
    signedIn: false,
    login: null,
  }));
});

describe("empty states", () => {
  it("asks for a repository when none is open", async () => {
    render(<PullsScreen />);
    expect(await screen.findByText("No repository open")).toBeInTheDocument();
  });

  it("says no forge — without an error banner — for a non-forge remote", async () => {
    seedRepo();
    render(<PullsScreen />);
    expect(
      await screen.findByText("No GitHub or GitLab remote found"),
    ).toBeInTheDocument();
    // A repository with no forge is a state, not a failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks which forge a self-hosted host is, and routes to Settings", async () => {
    seedRepo();
    mockInvoke("forge_detect", () => ({
      remote: "origin",
      host: "git.example.com",
      owner: "team",
      name: "svc",
      kind: null,
    }));
    render(<PullsScreen />);
    expect(
      await screen.findByText("Which forge is git.example.com?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open Settings/ }));
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "settings",
    });
  });

  it("asks for a token when the host has none, and does not list anything", async () => {
    seedRepo();
    mockInvoke("forge_detect", () => GH);
    render(<PullsScreen />);
    expect(
      await screen.findByText("Add an API token for github.com"),
    ).toBeInTheDocument();
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain(
      "forge_list_pull_requests",
    );
    // The empty state must say the token is NOT the push credential — otherwise
    // it reads like the app lost the credential the user already has.
    expect(
      screen.getByText(/separate credential from the one git pushes with/),
    ).toBeInTheDocument();
  });

  it("says nothing is open when the list comes back empty", async () => {
    seedRepo();
    seedForge({ pulls: [] });
    render(<PullsScreen />);
    expect(await screen.findByText("No open pull requests")).toBeInTheDocument();
  });
});

describe("the list", () => {
  beforeEach(() => {
    seedRepo();
    mockInvoke("forge_pull_request_checks", () => ({
      state: "Success",
      total: 3,
      label: "success",
    }));
  });

  it("renders number, title, author and branches for each request", async () => {
    seedForge({
      pulls: [pr(), pr({ number: 119, title: "Fix a typo", author: "someone" })],
      selected: 118,
    });
    render(<PullsScreen />);
    const rows = await screen.findAllByTestId("pull-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("#118");
    expect(rows[0]).toHaveTextContent("HEAD indicator becomes six marks");
    expect(rows[0]).toHaveTextContent("jonassaa");
    expect(rows[0]).toHaveTextContent("feat/head-marks → main");
  });

  it("labels a draft and a fork request on the row", async () => {
    seedForge({
      pulls: [pr({ number: 119, draft: true, crossRepo: true })],
      selected: 119,
    });
    render(<PullsScreen />);
    const row = await screen.findByTestId("pull-row");
    expect(row).toHaveTextContent("draft");
    // A fork request will NOT be checked out under its own branch name; the row
    // has to say so, not only the detail pane.
    expect(row).toHaveTextContent("fork");
  });

  it("uses GitLab's vocabulary for a GitLab project", async () => {
    seedForge({
      detection: { ...GH, host: "gitlab.com", kind: "GitLab" },
      forge: { host: "gitlab.com", owner: "group", name: "svc", kind: "GitLab" },
      pulls: [pr({ number: 7 })],
      selected: 7,
    });
    render(<PullsScreen />);
    // `#7` is an ISSUE on GitLab; a merge request is `!7`.
    expect((await screen.findByTestId("pull-row")).textContent).toContain("!7");
    expect(screen.getByText(/MERGE REQUESTS/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New merge request/ }),
    ).toBeInTheDocument();
  });

  it("loads the CI verdict for the selected request only", async () => {
    seedForge({ pulls: [pr(), pr({ number: 119, sha: "aaaaaaa" })], selected: 118 });
    render(<PullsScreen />);
    await waitFor(() =>
      expect(
        getInvokeCalls().filter((c) => c.cmd === "forge_pull_request_checks"),
      ).toHaveLength(1),
    );
    const call = getInvokeCalls().find((c) => c.cmd === "forge_pull_request_checks");
    expect(call?.args.sha).toBe("6d15cfe");
  });

  it("selects a row on click", async () => {
    seedForge({ pulls: [pr(), pr({ number: 119 })], selected: 118 });
    await renderSettled(<PullsScreen />);
    const rows = await screen.findAllByTestId("pull-row");
    await userEvent.click(rows[1]);
    expect(useForgeStore.getState().selected).toBe(119);
  });
});

describe("the detail pane", () => {
  beforeEach(seedRepo);

  it("opens the request in the browser through open_url", async () => {
    seedForge({ pulls: [pr()], selected: 118 });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    mockInvoke("open_url", () => null);
    await renderSettled(<PullsScreen />);
    await userEvent.click(await screen.findByTestId("pull-open-browser"));
    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "open_url");
      expect(call?.args.url).toBe(
        "https://github.com/jonassaa/platypusgit/pull/118",
      );
    });
  });

  it("names the local branch a fork request would land on", async () => {
    seedForge({
      pulls: [pr({ number: 7, crossRepo: true, sourceBranch: "main" })],
      selected: 7,
    });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    await renderSettled(<PullsScreen />);
    // NOT "main" — a fork's main must never land on yours.
    expect(await screen.findByTestId("pull-checkout")).toHaveTextContent(
      "Check out pr-7",
    );
  });

  it("checks the request out and refreshes the repository", async () => {
    seedForge({ pulls: [pr()], selected: 118 });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "Success",
      total: 1,
      label: "success",
    }));
    mockInvoke("forge_checkout_pull_request", () => null);
    // refreshAll fans out; answer everything it needs.
    for (const cmd of [
      "get_status",
      "list_branches",
      "list_tags",
      "list_stashes",
      "list_remotes",
    ]) {
      mockInvoke(cmd, () => []);
    }
    mockInvoke("get_log", () => []);
    mockInvoke("get_log_page", () => ({ commits: [], hasMore: false }));
    mockInvoke("repo_state", () => "Clean");

    await renderSettled(
      <WithDialogs>
        <PullsScreen />
      </WithDialogs>,
    );
    await userEvent.click(await screen.findByTestId("pull-checkout"));
    await waitFor(() => {
      const call = getInvokeCalls().find(
        (c) => c.cmd === "forge_checkout_pull_request",
      );
      expect(call?.args.request.localBranch).toBe("feat/head-marks");
      expect(call?.args.request.force).toBe(false);
    });
  });

  it("confirms before overwriting an existing local branch, and honours cancel", async () => {
    seedForge({ pulls: [pr()], selected: 118 });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    mockInvoke("forge_checkout_pull_request", () => {
      throw { kind: "BranchExists", message: "feat/head-marks" };
    });

    await renderSettled(
      <WithDialogs>
        <PullsScreen />
      </WithDialogs>,
    );
    await userEvent.click(await screen.findByTestId("pull-checkout"));
    await waitFor(() =>
      expect(dialogTitle()).toContain("Overwrite the local branch feat/head-marks?"),
    );
    await dismissDialog();
    // Cancel means exactly one attempt — the un-forced one.
    expect(
      getInvokeCalls().filter((c) => c.cmd === "forge_checkout_pull_request"),
    ).toHaveLength(1);
  });

  it("retries with force once the overwrite is confirmed", async () => {
    seedForge({ pulls: [pr()], selected: 118 });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    let attempt = 0;
    mockInvoke("forge_checkout_pull_request", () => {
      attempt += 1;
      if (attempt === 1) throw { kind: "BranchExists", message: "feat/head-marks" };
      return null;
    });
    for (const cmd of [
      "get_status",
      "list_branches",
      "list_tags",
      "list_stashes",
      "list_remotes",
    ]) {
      mockInvoke(cmd, () => []);
    }
    mockInvoke("get_log", () => []);
    mockInvoke("get_log_page", () => ({ commits: [], hasMore: false }));
    mockInvoke("repo_state", () => "Clean");

    await renderSettled(
      <WithDialogs>
        <PullsScreen />
      </WithDialogs>,
    );
    await userEvent.click(await screen.findByTestId("pull-checkout"));
    await waitFor(() => expect(dialogTitle()).toContain("Overwrite"));
    await acceptDialog();
    await waitFor(() => {
      const calls = getInvokeCalls().filter(
        (c) => c.cmd === "forge_checkout_pull_request",
      );
      expect(calls).toHaveLength(2);
      expect(calls[1].args.request.force).toBe(true);
    });
  });
});

describe("toolbar", () => {
  beforeEach(seedRepo);

  it("disables Refresh and New until a forge is ready", async () => {
    mockInvoke("forge_detect", () => GH);
    render(<PullsScreen />);
    await screen.findByText("Add an API token for github.com");
    expect(screen.getByTestId("pulls-refresh")).toBeDisabled();
    expect(screen.getByTestId("pulls-new")).toBeDisabled();
  });

  it("refreshes the list on demand", async () => {
    seedForge({ pulls: [pr()], selected: 118 });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    await renderSettled(<PullsScreen />);
    await screen.findByTestId("pull-row");
    // The mount-time detect already listed once; Refresh must add a second call.
    const before = getInvokeCalls().filter(
      (c) => c.cmd === "forge_list_pull_requests",
    ).length;
    // A later answer proves the click re-read the list rather than re-rendering it.
    mockInvoke("forge_list_pull_requests", () => [pr(), pr({ number: 119 })]);
    await userEvent.click(screen.getByTestId("pulls-refresh"));
    await waitFor(() => {
      expect(
        getInvokeCalls().filter((c) => c.cmd === "forge_list_pull_requests").length,
      ).toBeGreaterThan(before);
      expect(useForgeStore.getState().pulls).toHaveLength(2);
    });
  });

  it("shows the created url after a successful create", async () => {
    seedForge({
      pulls: [pr()],
      selected: 118,
      createdUrl: "https://github.com/jonassaa/platypusgit/pull/121",
    });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "None",
      total: 0,
      label: "no checks",
    }));
    render(<PullsScreen />);
    const banner = await screen.findByTestId("pulls-created");
    expect(banner).toHaveTextContent(
      "https://github.com/jonassaa/platypusgit/pull/121",
    );
  });
});
