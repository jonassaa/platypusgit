// Store-level tests for the ref-scoped log (setLogRef) — issue #27.
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

const HEAD_COMMITS = [mkCommit("a".repeat(40), "main work")];
const FEATURE_COMMITS = [
  mkCommit("b".repeat(40), "cherry commit"),
  mkCommit("a".repeat(40), "main work"),
];

const initial = useRepoStore.getState();

describe("useRepoStore.setLogRef", () => {
  beforeEach(() => {
    useRepoStore.setState(initial, true);
    useRepoStore.setState({
      current: { id: "repo-1", path: "/tmp/repo", head: "main" },
      commits: HEAD_COMMITS,
    });
  });

  it("scopes the log to the given refspec and replaces commits", async () => {
    mockInvoke("get_log", (args) =>
      args.refspec === "feature" ? FEATURE_COMMITS : HEAD_COMMITS,
    );

    await useRepoStore.getState().setLogRef("feature");

    const s = useRepoStore.getState();
    expect(s.logRef).toBe("feature");
    expect(s.commits.map((c) => c.summary)).toEqual([
      "cherry commit",
      "main work",
    ]);
    expect(s.loading).toBe(false);
    const call = getInvokeCalls().find((c) => c.cmd === "get_log");
    expect(call?.args.refspec).toBe("feature");
  });

  it("null refspec returns to the HEAD log", async () => {
    mockInvoke("get_log", (args) =>
      args.refspec === "feature" ? FEATURE_COMMITS : HEAD_COMMITS,
    );

    await useRepoStore.getState().setLogRef("feature");
    await useRepoStore.getState().setLogRef(null);

    const s = useRepoStore.getState();
    expect(s.logRef).toBeNull();
    expect(s.commits.map((c) => c.summary)).toEqual(["main work"]);
  });

  it("keeps the previous list and sets the error when the ref is invalid", async () => {
    mockInvoke("get_log", () => {
      throw { kind: "InvalidRef", message: "no-such-ref" };
    });

    await useRepoStore.getState().setLogRef("no-such-ref");

    const s = useRepoStore.getState();
    expect(s.error).toEqual({ kind: "InvalidRef", message: "no-such-ref" });
    expect(s.commits).toEqual(HEAD_COMMITS);
    expect(s.loading).toBe(false);
  });

  it("drops a stale response when a newer scope superseded it", async () => {
    const resolvers = new Map<string, (v: CommitInfo[]) => void>();
    mockInvoke(
      "get_log",
      (args) =>
        new Promise<CommitInfo[]>((res) => {
          resolvers.set(String(args.refspec), res);
        }),
    );

    const first = useRepoStore.getState().setLogRef("feature");
    const second = useRepoStore.getState().setLogRef("other");

    // Resolve in submission order — the first response must be dropped.
    resolvers.get("feature")!(FEATURE_COMMITS);
    await first;
    expect(useRepoStore.getState().commits).toEqual(HEAD_COMMITS);

    resolvers.get("other")!([mkCommit("c".repeat(40), "other tip")]);
    await second;
    const s = useRepoStore.getState();
    expect(s.logRef).toBe("other");
    expect(s.commits.map((c) => c.summary)).toEqual(["other tip"]);
  });

  it("re-runs an active search under the new scope", async () => {
    mockInvoke("get_log", () => FEATURE_COMMITS);
    mockInvoke("get_log_filtered", () => [FEATURE_COMMITS[0]]);
    useRepoStore.setState({ commitFilter: { message: "cherry" } });

    await useRepoStore.getState().setLogRef("feature");
    // searchCommits is fired without awaiting — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    const search = getInvokeCalls().find((c) => c.cmd === "get_log_filtered");
    expect(search?.args.refspec).toBe("feature");
    expect(search?.args.filter).toEqual({ message: "cherry" });
  });
});
