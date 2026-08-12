// Store-level tests for the paginated log (#68 G11). History past the first
// page used to be unreachable; these cover appending, the end of history, and
// the guards that stop a stale or duplicate page landing.
import { beforeEach, describe, expect, it } from "vitest";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { CommitInfo } from "@/lib/types";

function mkCommit(oid: string, summary: string): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "test@example.com",
    timestamp: 1_000,
    parents: [],
    refs: [],
  };
}

const PAGE_1 = [mkCommit("a".repeat(40), "one"), mkCommit("b".repeat(40), "two")];
const PAGE_2 = [mkCommit("c".repeat(40), "three")];

const initial = useRepoStore.getState();

describe("useRepoStore.loadMoreCommits", () => {
  beforeEach(() => {
    useRepoStore.setState(initial, true);
    useRepoStore.setState({
      current: { id: "repo-1", path: "/tmp/repo", head: "main" },
      commits: PAGE_1,
      commitCursor: ["cursor-oid"],
    });
  });

  it("appends the next page without disturbing the first", async () => {
    mockInvoke("get_log_page", () => ({ commits: PAGE_2, nextCursor: null }));

    await useRepoStore.getState().loadMoreCommits();

    const { commits } = useRepoStore.getState();
    expect(commits.map((c) => c.summary)).toEqual(["one", "two", "three"]);
  });

  it("passes the stored cursor to the backend", async () => {
    mockInvoke("get_log_page", () => ({ commits: PAGE_2, nextCursor: null }));

    await useRepoStore.getState().loadMoreCommits();

    const call = getInvokeCalls().find((c) => c.cmd === "get_log_page");
    expect(call?.args.cursor).toEqual(["cursor-oid"]);
  });

  it("stops offering more once the walk reports the end of history", async () => {
    mockInvoke("get_log_page", () => ({ commits: PAGE_2, nextCursor: null }));

    await useRepoStore.getState().loadMoreCommits();
    expect(useRepoStore.getState().commitCursor).toBeNull();

    // A further request must not hit the backend at all.
    const before = getInvokeCalls().filter((c) => c.cmd === "get_log_page").length;
    await useRepoStore.getState().loadMoreCommits();
    const after = getInvokeCalls().filter((c) => c.cmd === "get_log_page").length;
    expect(after).toBe(before);
  });

  it("is a no-op with no cursor", async () => {
    useRepoStore.setState({ commitCursor: null });
    mockInvoke("get_log_page", () => ({ commits: PAGE_2, nextCursor: null }));

    await useRepoStore.getState().loadMoreCommits();

    expect(getInvokeCalls().some((c) => c.cmd === "get_log_page")).toBe(false);
    expect(useRepoStore.getState().commits).toHaveLength(2);
  });

  it("does not double-append when called twice concurrently", async () => {
    // History's window can fire this several times before the first resolves.
    mockInvoke("get_log_page", () => ({ commits: PAGE_2, nextCursor: null }));

    await Promise.all([
      useRepoStore.getState().loadMoreCommits(),
      useRepoStore.getState().loadMoreCommits(),
    ]);

    expect(useRepoStore.getState().commits).toHaveLength(3);
  });

  it("extends the search results, not the base log, while a search is active", async () => {
    useRepoStore.setState({
      searchResults: [mkCommit("d".repeat(40), "hit one")],
      searchCursor: ["search-cursor"],
      commitFilter: { message: "hit" },
    });
    mockInvoke("get_log_filtered_page", () => ({
      commits: [mkCommit("e".repeat(40), "hit two")],
      nextCursor: null,
    }));

    await useRepoStore.getState().loadMoreCommits();

    const s = useRepoStore.getState();
    expect(s.searchResults?.map((c) => c.summary)).toEqual(["hit one", "hit two"]);
    // The unfiltered log and its own resume point are untouched.
    expect(s.commits).toHaveLength(2);
    expect(s.commitCursor).toEqual(["cursor-oid"]);
  });

  it("keeps the unfiltered cursor usable after a search is cleared", async () => {
    useRepoStore.setState({
      searchResults: [mkCommit("d".repeat(40), "hit")],
      searchCursor: ["search-cursor"],
      commitFilter: { message: "hit" },
    });

    await useRepoStore.getState().searchCommits({});

    const s = useRepoStore.getState();
    expect(s.searchResults).toBeNull();
    expect(s.searchCursor).toBeNull();
    // This is why there are two cursors rather than one.
    expect(s.commitCursor).toEqual(["cursor-oid"]);
  });
});
