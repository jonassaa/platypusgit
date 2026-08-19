// The launch path, where TWO independent openers run at once (#177).
//
// A `pgit <path>` launch stashes an intent that `useCliLaunch` takes on mount,
// and `AppShell` restores `pg-open-repos` in the very next effect. Neither
// opener reproduces the bug alone — that is the whole point of driving both here
// — so the Probe below mirrors AppShell's effect ORDER rather than testing the
// two stores separately:
//
//   useCliLaunch();                                  // registered first
//   useEffect(() => { restoreSession(); }, []);      // runs second
//
// `open_repo` mints a DISTINCT id per call, exactly as the backend does, so a
// second open is visible as a second `RepoId` — and a `RepoId` nothing closes is
// a `git2::Repository` held for the life of the process.

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useCliLaunch } from "@/features/cli/useCliLaunch";
import { emptySlice } from "./repoSlice";
import { OPEN_REPOS_KEY, repoPathKey } from "./tabs";
import { useRepoStore } from "./useRepoStore";
import { useTabsStore } from "./useTabsStore";

/** Mirrors AppShell: the CLI hook's effect is registered before the restore. */
function Probe() {
  useCliLaunch();
  React.useEffect(() => {
    void useTabsStore.getState().restoreSession();
  }, []);
  return null;
}

let nextId = 0;
/** Gate keyed by the path asked for, so one open can be made to resolve last. */
let gates: Record<string, Promise<void>> = {};

function armBackend() {
  nextId = 0;
  gates = {};
  mockInvoke("open_repo", async (args) => {
    const asked = args.path as string;
    await gates[asked];
    // What the real backend answers: a fresh RepoId every call, and the workdir
    // in ITS spelling — trailing separator stripped (git/mod.rs::repo_path_key).
    return { id: `r-${++nextId}`, path: repoPathKey(asked), head: "main" };
  });
  mockInvoke("close_repo", () => undefined);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("list_all_files", () => []);
}

function seedOpenRepos(paths: string[], active: string) {
  localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify({ paths, active }));
}

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  armBackend();
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
  useRepoStore.setState(emptySlice());
});

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);
const closedIds = () => calls("close_repo").map((c) => c.args.repoId as string);

describe("launch: a CLI path already in the restored open set", () => {
  it("opens the repository ONCE, even spelled with a trailing separator", async () => {
    seedOpenRepos(["/dev/api"], "/dev/api");
    // The spelling `resolve_repo_root` produced before #177: libgit2's
    // `workdir()`, trailing separator and all. Compared raw it matches no tab.
    mockInvoke("take_launch_intent", () => ({ path: "/dev/api/", screen: null }));

    render(<Probe />);
    // Settle: a repository is live and nothing is still loading. Deliberately
    // NOT "the first tab is open" — under a duplicate open the strip passes
    // through states where that is briefly true, and the count below is the
    // assertion that matters.
    await waitFor(() => {
      expect(useRepoStore.getState().current).not.toBeNull();
      expect(useRepoStore.getState().loading).toBe(false);
    });

    expect(calls("open_repo")).toHaveLength(1);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(["/dev/api"]);
    // Nothing to clean up, because nothing was opened twice.
    expect(closedIds()).toEqual([]);
    // And the store points at the repository the tab holds — the symptom was a
    // `current` the backend had already forgotten (`UnknownRepo` per click).
    const live = useRepoStore.getState().current;
    expect(live?.id).toBe(useTabsStore.getState().tabs[0].repoId);
    expect(closedIds()).not.toContain(live?.id);
  });

  it("leaves no orphan when the two openers ask for DIFFERENT repositories", async () => {
    // The restore's open resolves LAST — the ordering that used to leave the
    // store holding a handle the tab layer then evicted.
    let release = () => {};
    gates["/dev/api"] = new Promise<void>((res) => {
      release = res;
    });
    seedOpenRepos(["/dev/api"], "/dev/api");
    mockInvoke("take_launch_intent", () => ({ path: "/dev/web", screen: null }));

    render(<Probe />);
    await waitFor(() => expect(useTabsStore.getState().activePath).toBe("/dev/web"));
    const winner = useRepoStore.getState().current?.id;
    expect(winner).toBeTruthy();

    release();
    await waitFor(() => expect(calls("open_repo")).toHaveLength(2));
    await waitFor(() => expect(closedIds()).toHaveLength(1));

    // The loser is evicted; the winner is untouched and still the live repo.
    expect(useRepoStore.getState().current?.id).toBe(winner);
    expect(closedIds()).not.toContain(winner);
    expect(useTabsStore.getState().activePath).toBe("/dev/web");
  });
});
