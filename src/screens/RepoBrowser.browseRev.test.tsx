// RepoBrowser consuming a `browse-rev` intent.
//
// The half that has silently broken before (#133) is exactly this one: a menu
// can set an intent, AppShell can route the screen, and the screen can still
// never read it — with nothing failing. So this asserts the observable
// consequence: the file list came from the AT-REV backend call, not from the
// working tree.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = { id: "repo-1", path: "/tmp/fake-repo", head: "refs/heads/main" };
const REV = "a".repeat(40);

const atRev = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

const revCalls = () => getInvokeCalls().filter((c) => c.cmd === "list_files_at_rev");

beforeEach(() => {
  useRepoStore.setState({
    current: repo,
    status: [],
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
  } as never);
  useNavStore.setState({ intent: null });
  mockInvoke("list_all_files", () => []);
  mockInvoke("list_files_at_rev", () => [atRev("only-at-rev.txt")]);
  mockInvoke("get_diff", (args) => ({
    path: args.path as string,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("read_file_content", (args) => ({
    path: args.path as string,
    text: "content",
    binary: false,
    fromHead: false,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("browse-rev intent", () => {
  it("browses at the revision the intent names", async () => {
    useNavStore.getState().setIntent({
      kind: "browse-rev",
      rev: REV,
      label: "aaaaaaa — commit A",
    });
    render(<RepoBrowserScreen />);

    // The list came from the at-rev call, with the full oid — not a short one,
    // and not the working tree.
    await waitFor(() => expect(revCalls().length).toBeGreaterThan(0));
    expect(revCalls()[0].args).toMatchObject({ repoId: repo.id, revspec: REV });
  });

  it("says on screen which revision is being browsed", async () => {
    useNavStore.getState().setIntent({
      kind: "browse-rev",
      rev: REV,
      label: "aaaaaaa — commit A",
    });
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(revCalls().length).toBeGreaterThan(0));
    // A reader must be able to tell they are NOT looking at the working tree.
    expect(await screen.findByText(/Browsing/)).toBeTruthy();
  });

  it("clears the intent, so a later repo switch is not re-hijacked by it", async () => {
    useNavStore.getState().setIntent({
      kind: "browse-rev",
      rev: REV,
      label: "aaaaaaa — commit A",
    });
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(useNavStore.getState().intent).toBeNull());
  });

  // Controls. Both assert the NEGATIVE, which is the whole claim: the at-rev
  // path is entered only by a browse-rev intent. (The screen opens in "changes"
  // mode, so there is no positive working-tree call to wait on here — asserting
  // one would be asserting the default filter, not this feature.)
  it("does not browse at a revision when there is no intent", async () => {
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(screen.queryByText(/Browsing/)).toBeNull());
    expect(revCalls()).toHaveLength(0);
  });

  it("ignores an intent meant for another screen, and leaves it standing", async () => {
    useNavStore.getState().setIntent({ kind: "blame", path: "a.txt" });
    render(<RepoBrowserScreen />);
    await waitFor(() => expect(screen.queryByText(/Browsing/)).toBeNull());
    expect(revCalls()).toHaveLength(0);
    // Consuming another screen's intent would strand that navigation.
    expect(useNavStore.getState().intent).toMatchObject({ kind: "blame" });
  });
});
