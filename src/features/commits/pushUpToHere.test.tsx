// "Push all up to here…" — publish only part of a branch.
//
// The counts in the confirm are the load-bearing part: the entry's own label
// cannot say how much of the branch it covers, and someone who reads "push all
// up to here" as "push everything" has published work they meant to hold back.
// A wrong count is worse than no count, hence the omission case.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { pushTarget, pushUpToHere } from "./pushUpToHere";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { WithDialogs, acceptDialog, dismissDialog, dialogBody, resetDialogs } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const OID = "a".repeat(40);

const pushes = () => getInvokeCalls().filter((c) => c.cmd === "push_commit");

/** Point the store at a branch tracking `upstream`. */
function tracking(upstream: string | null, remotes = [{ name: "origin", url: null }]) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream,
        ahead: 0,
        behind: 0,
        tip: OID,
        tipTime: 0,
        isDefault: true,
      },
    ],
    remotes,
    status: [],
    error: null,
    activity: {},
    loading: false,
  } as never);
}

async function acceptWhenOpen() {
  await screen.findByTestId("dialog-confirm");
  await acceptDialog();
}

beforeEach(() => {
  resetDialogs();
  tracking("origin/main");
  mockInvoke("push_commit", () => undefined);
  // ahead(a=upstream, b=rev) = "on b, not on a" — 3 up to the commit, 7 total.
  mockInvoke("ahead_behind", (args) => ({
    ahead: args.b === "HEAD" ? 7 : 3,
    behind: 0,
    mergeBase: "zzz",
  }));
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  render(
    <WithDialogs>
      <div />
    </WithDialogs>,
  );
});

afterEach(() => vi.restoreAllMocks());

describe("pushTarget", () => {
  it("splits the upstream into remote and branch", () => {
    expect(pushTarget()).toEqual({
      remote: "origin",
      branch: "main",
      upstream: "origin/main",
    });
  });

  it("keeps a slashed branch name whole", () => {
    // Splitting on every "/" would truncate this to "release".
    tracking("origin/release/2026/09");
    expect(pushTarget()?.branch).toBe("release/2026/09");
  });

  it("is null when the branch tracks nothing — there is no destination to infer", () => {
    tracking(null);
    expect(pushTarget()).toBeNull();
  });

  it("is null when the upstream names a remote that is gone", () => {
    tracking("upstream/main", [{ name: "origin", url: null }]);
    expect(pushTarget()).toBeNull();
  });
});

describe("pushUpToHere", () => {
  it("pushes the oid to the upstream's remote and branch", async () => {
    void pushUpToHere(OID);
    await acceptWhenOpen();
    await waitFor(() => expect(pushes().length).toBe(1));
    expect(pushes()[0].args).toMatchObject({
      repoId: "r1",
      remote: "origin",
      oid: OID,
      branch: "main",
    });
  });

  it("names how many commits of how many in the confirm", async () => {
    void pushUpToHere(OID);
    await waitFor(() => expect(dialogBody()).toMatch(/Pushes 3 of your 7 commits/));
    expect(dialogBody()).toMatch(/origin\/main/);
    expect(dialogBody()).toMatch(/rest of your branch stays local/);
  });

  it("says 'all' when the commit IS the branch tip", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 4, behind: 0, mergeBase: "zzz" }));
    void pushUpToHere(OID);
    await waitFor(() => expect(dialogBody()).toMatch(/Pushes all 4 commits/));
  });

  it("omits the numbers rather than inventing them when they cannot be read", async () => {
    mockInvoke("ahead_behind", () => {
      throw { kind: "InvalidRef", message: "no such ref" };
    });
    void pushUpToHere(OID);
    await waitFor(() => expect(dialogBody()).toMatch(/Pushes history up to this commit/));
    expect(dialogBody()).not.toMatch(/\d+ of your/);
  });

  it("pushes nothing when the confirm is declined", async () => {
    void pushUpToHere(OID);
    await screen.findByTestId("dialog-cancel");
    await dismissDialog();
    expect(pushes()).toHaveLength(0);
  });

  it("pushes nothing when the branch tracks nothing", async () => {
    tracking(null);
    await pushUpToHere(OID);
    expect(pushes()).toHaveLength(0);
  });

  it("sends no force flag — this path is fast-forward only", async () => {
    void pushUpToHere(OID);
    await acceptWhenOpen();
    await waitFor(() => expect(pushes().length).toBe(1));
    expect(JSON.stringify(pushes()[0].args)).not.toMatch(/force/i);
  });
});
