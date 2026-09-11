// "Check out origin/x as a new local branch", end to end through the store.
//
// The reported bug, in order: the new branch tracked NOTHING, so it showed no
// ahead/behind and had nothing to pull; and when the name was already taken the
// flow called `createBranch` (which reports failure by setting the banner, then
// returns) and checked out anyway — landing the user on a stale same-named
// branch that had never seen the remote, with the banner cleared by the
// checkout's own refresh. Both halves are pinned here.
//
// Tracking itself is the BACKEND's job (`create_branch` off a remote-tracking
// start point) — see `src-tauri/tests/branches_tags.rs`. What this file pins is
// that the frontend asks for it: `from` must be the REMOTE ref, not the commit.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

import { checkoutRemoteAsLocalBranch } from "./checkoutRemote";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { WithDialogs, acceptDialog, resetDialogs, dismissDialog } from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { BranchInfo } from "@/lib/types";

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

const cmds = () => getInvokeCalls().map((c) => c.cmd);
const callsTo = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

/** Pick an answer from the open pgChoose dialog. */
async function choose(id: string) {
  await screen.findByTestId(`dialog-choice-${id}`);
  await act(async () => {
    fireEvent.click(screen.getByTestId(`dialog-choice-${id}`));
  });
}

function setBranches(branches: BranchInfo[]) {
  useRepoStore.setState({ branches } as never);
}

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: [],
    status: [],
    branches: [],
    remotes: [{ name: "origin", url: "git@example.com:o/r.git" }],
    loading: false,
    error: null,
  } as never);
  // checkoutBranch is stash → checkout → pop → refreshAll, so the whole refresh
  // fan-out has to answer or the action throws before checking out.
  mockInvoke("stash_save", () => null);
  mockInvoke("checkout_branch", () => undefined);
  mockInvoke("create_branch", () => undefined);
  mockInvoke("set_upstream", () => undefined);
  mockInvoke("fast_forward_branch", () => ({
    branch: "feature",
    upstream: "origin/feature",
    from: "a".repeat(40),
    to: "b".repeat(40),
    moved: true,
  }));
  mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 3, mergeBase: "c".repeat(40) }));
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
});

afterEach(() => {
  resetDialogs();
  vi.restoreAllMocks();
});

describe("the name is free", () => {
  it("branches off the REMOTE ref — which is what makes the backend track it", async () => {
    setBranches([branch({ name: "main", isHead: true })]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await done;

    expect(callsTo("create_branch")).toHaveLength(1);
    // `from` is the remote-tracking ref, NOT a commit oid: the backend reads it
    // to decide the upstream, and an oid tracks nothing.
    expect(callsTo("create_branch")[0].args).toMatchObject({
      name: "feature",
      from: "origin/feature",
    });
    expect(callsTo("checkout_branch")[0].args).toMatchObject({ name: "feature" });
  });

  it("defaults the name to the branch without its remote prefix", async () => {
    setBranches([]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    void checkoutRemoteAsLocalBranch("origin/feat/nested");
    const input = await screen.findByTestId<HTMLInputElement>("dialog-input");
    expect(input.value).toBe("feat/nested");
    await dismissDialog();
  });

  it("does nothing at all when the prompt is dismissed", async () => {
    setBranches([]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await dismissDialog();
    await done;

    expect(cmds()).not.toContain("create_branch");
    expect(cmds()).not.toContain("checkout_branch");
  });
});

describe("the name is already taken — the silent-fallback regression", () => {
  const takenByStale = () =>
    setBranches([
      branch({ name: "main", isHead: true }),
      branch({ name: "feature", tip: "a".repeat(40) }),
      branch({ name: "origin/feature", isRemote: true, tip: "b".repeat(40) }),
    ]);

  it("asks instead of checking the stale branch out behind the user's back", async () => {
    takenByStale();
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    void checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");

    // The old flow reached checkout_branch here with nothing on screen.
    await screen.findByTestId("dialog-choice-checkout");
    expect(screen.getByTestId("dialog-title")).toHaveTextContent(
      "Check out the existing feature?",
    );
    expect(cmds()).not.toContain("checkout_branch");
    // ...and it never asked the backend to create a branch it knew was taken.
    expect(cmds()).not.toContain("create_branch");

    await dismissDialog();
  });

  it("dismissing the question checks nothing out", async () => {
    takenByStale();
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await screen.findByTestId("dialog-choice-checkout");
    await dismissDialog();
    await done;

    expect(cmds()).not.toContain("checkout_branch");
    expect(cmds()).not.toContain("set_upstream");
  });

  it("'check out as it is' gives the untracked branch the upstream, then switches", async () => {
    takenByStale();
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await choose("checkout");
    await done;

    expect(callsTo("set_upstream")[0].args).toMatchObject({
      branch: "feature",
      upstream: "origin/feature",
    });
    // No ref moved: "as it is" keeps the branch exactly where it was.
    expect(cmds()).not.toContain("fast_forward_branch");
    await waitFor(() => expect(callsTo("checkout_branch")).toHaveLength(1));
    expect(cmds().indexOf("set_upstream")).toBeLessThan(
      cmds().indexOf("checkout_branch"),
    );
  });

  it("leaves an upstream that is already right alone", async () => {
    setBranches([
      branch({ name: "main", isHead: true }),
      branch({ name: "feature", upstream: "origin/feature" }),
      branch({ name: "origin/feature", isRemote: true }),
    ]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await choose("checkout");
    await done;

    expect(cmds()).not.toContain("set_upstream");
    expect(callsTo("checkout_branch")).toHaveLength(1);
  });

  it("'update' tracks, fast-forwards and only THEN checks out", async () => {
    takenByStale();
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await choose("update");
    await done;

    const order = cmds();
    // The ref move happens while the branch is NOT HEAD. Checked out first, a
    // fast-forward would need a working-tree update — `pull`'s job, under the
    // user's own pull mode — and `fastForwardBranch` reroutes it there.
    expect(order.indexOf("set_upstream")).toBeLessThan(
      order.indexOf("fast_forward_branch"),
    );
    expect(order.indexOf("fast_forward_branch")).toBeLessThan(
      order.indexOf("checkout_branch"),
    );
  });

  it("spends no stash cycle when the collision is the branch under HEAD", async () => {
    // You are on `feature`, someone pushes, you right-click `origin/feature`.
    // checkoutBranch there is a no-op that still stashes and pops the user's
    // working tree.
    setBranches([
      branch({ name: "feature", isHead: true }),
      branch({ name: "origin/feature", isRemote: true }),
    ]);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    expect(await screen.findByTestId("dialog-title")).toHaveTextContent(
      "Stay on feature?",
    );
    await choose("checkout");
    await done;

    // The tracking it was missing is still set — that IS the ask.
    expect(callsTo("set_upstream")[0].args).toMatchObject({
      branch: "feature",
      upstream: "origin/feature",
    });
    expect(cmds()).not.toContain("checkout_branch");
    expect(cmds()).not.toContain("stash_save");
  });

  it("'use a different name' re-opens the prompt and takes the new name", async () => {
    takenByStale();
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );

    const done = checkoutRemoteAsLocalBranch("origin/feature");
    await screen.findByTestId("dialog-input");
    await acceptDialog("feature");
    await choose("rename");

    const input = await screen.findByTestId<HTMLInputElement>("dialog-input");
    // Re-opened on what they typed, not on the original suggestion.
    expect(input.value).toBe("feature");
    await acceptDialog("feature-2");
    await done;

    expect(callsTo("create_branch")[0].args).toMatchObject({
      name: "feature-2",
      from: "origin/feature",
    });
  });
});
