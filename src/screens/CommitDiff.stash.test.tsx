// The two stash targets in CommitDiff (#133).
//
// The bug being replaced fulfilled a stash-diff intent as
// `diffCommits(stashOid, "HEAD")` — the stash against CURRENT HEAD, backwards,
// mixing the stash with everything landed since. So the sharp assertions here
// are about WHICH command runs and with which arguments.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CommitDiffScreen } from "./CommitDiff";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { FileDiff } from "@/lib/types";

const OID = "a".repeat(40);

const DIFF: FileDiff = {
  path: "src/a.ts",
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [],
  lfs: null,
};

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [],
    branches: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  mockInvoke("stash_diff", () => [DIFF]);
  mockInvoke("diff_ref_to_workdir", () => ({ files: [DIFF], untrackedOmitted: 0 }));
  mockInvoke("diff_commits", () => [DIFF]);
  mockInvoke("diff_commit", () => [DIFF]);
  mockInvoke("read_file_content_at_rev", () => ({ text: "", binary: false }));
  mockInvoke("read_file_content", () => ({ text: "", binary: false }));
});

afterEach(() => vi.restoreAllMocks());

describe("stash-diff — what this stash changed", () => {
  it("calls stash_diff with the full oid, and never diff_commits against HEAD", async () => {
    useNavStore.setState({
      intent: { kind: "stash-diff", oid: OID, label: "stash@{0}", untracked: false },
    });
    render(<CommitDiffScreen />);

    await waitFor(() => expect(calls("stash_diff").length).toBe(1));
    expect(calls("stash_diff")[0].args).toMatchObject({
      oid: OID,
      includeUntracked: true,
    });
    expect(calls("diff_commits").length).toBe(0);
  });

  it("names the stash rather than a truncated oid", async () => {
    useNavStore.setState({
      intent: { kind: "stash-diff", oid: OID, label: "stash@{2}", untracked: false },
    });
    render(<CommitDiffScreen />);

    await waitFor(() => expect(calls("stash_diff").length).toBe(1));
    expect(screen.getAllByText(/stash@\{2\}/).length).toBeGreaterThan(0);
  });

  it("says it included the untracked payload only when there is one", async () => {
    useNavStore.setState({
      intent: { kind: "stash-diff", oid: OID, label: "stash@{0}", untracked: true },
    });
    const { unmount } = render(<CommitDiffScreen />);
    await waitFor(() => expect(calls("stash_diff").length).toBe(1));
    expect(screen.getByTestId("commit-diff-note").textContent).toMatch(/untracked/);
    unmount();

    useNavStore.setState({
      intent: { kind: "stash-diff", oid: OID, label: "stash@{0}", untracked: false },
    });
    render(<CommitDiffScreen />);
    await waitFor(() => expect(calls("stash_diff").length).toBe(2));
    expect(screen.queryByTestId("commit-diff-note")).toBeNull();
  });
});

describe("stash-vs-wt — how it stands against the working tree", () => {
  it("reuses diff_ref_to_workdir with untracked OFF", async () => {
    useNavStore.setState({
      intent: { kind: "stash-vs-wt", oid: OID, label: "stash@{0}", untracked: true },
    });
    render(<CommitDiffScreen />);

    await waitFor(() => expect(calls("diff_ref_to_workdir").length).toBe(1));
    expect(calls("diff_ref_to_workdir")[0].args).toMatchObject({
      revspec: OID,
      includeUntracked: false,
    });
    expect(calls("stash_diff").length).toBe(0);
  });

  it("says untracked files are out on both sides, even for a -u stash", async () => {
    useNavStore.setState({
      intent: { kind: "stash-vs-wt", oid: OID, label: "stash@{0}", untracked: true },
    });
    render(<CommitDiffScreen />);

    await waitFor(() => expect(calls("diff_ref_to_workdir").length).toBe(1));
    expect(screen.getByTestId("commit-diff-note").textContent).toBe(
      "untracked files excluded on both sides",
    );
  });

  it("renders a backend failure in place", async () => {
    mockInvoke("diff_ref_to_workdir", () => {
      throw { kind: "InvalidRef", message: "nope" };
    });
    useNavStore.setState({
      intent: { kind: "stash-vs-wt", oid: OID, label: "stash@{0}", untracked: false },
    });
    render(<CommitDiffScreen />);

    await waitFor(() =>
      expect(screen.getAllByText(/nope|unknown revision/i).length).toBeGreaterThan(0),
    );
  });
});
