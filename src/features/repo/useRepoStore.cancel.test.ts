// Cancelling a running fetch / pull / push (#234).
//
// Two invariants, and both are the kind that only a test catches:
//
//   1. `netOps[kind]` is published while the op runs and GONE afterwards. An id
//      left behind offers a Stop button that would signal a pid the OS has since
//      handed to another process.
//   2. `AppError::Cancelled` never reaches the error banner. The user pressed
//      Stop; a red banner saying so is the app arguing with them, and it looks
//      exactly like the failures that do need attention.
import { beforeEach, describe, expect, it } from "vitest";

import { emptySlice } from "./repoSlice";
import { useRepoStore } from "./useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { RepoHandle } from "@/lib/types";

const REPO: RepoHandle = { id: "r-1", path: "/dev/api", head: "refs/heads/main" };
const CANCELLED = { kind: "Cancelled" };

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

/** Everything `refreshAll` fans out to, so an op can reach its own outcome. */
function wireRefresh() {
  for (const cmd of [
    "get_status",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
    "list_all_files",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("head_info", () => null);
  mockInvoke("bisect_status", () => null);
  mockInvoke("cancel_operation", () => true);
}

beforeEach(() => {
  resetInvokeMock();
  wireRefresh();
  useRepoStore.setState({ ...emptySlice(), current: REPO } as never);
});

describe("a cancellable op publishes its id while it runs", () => {
  it("hands the same id to the backend and to netOps, then clears it", async () => {
    let seen: { opId?: string; netOps?: Record<string, string> } = {};
    mockInvoke("fetch", (args) => {
      seen = {
        opId: args.opId as string,
        // Read INSIDE the op: this is the only moment the Stop button exists.
        netOps: { ...useRepoStore.getState().netOps },
      };
      return undefined;
    });

    await useRepoStore.getState().fetch("origin");

    expect(seen.opId, "the op id never reached the backend").toBeTruthy();
    expect(seen.netOps).toEqual({ fetch: seen.opId });
    // Cleared on the way out, or Stop outlives the op it would stop.
    expect(useRepoStore.getState().netOps).toEqual({});
  });

  it("clears the id when the op FAILS, not just when it succeeds", async () => {
    mockInvoke("fetch", () => {
      throw { kind: "Network", message: "host unreachable" };
    });

    await useRepoStore.getState().fetch("origin");

    expect(useRepoStore.getState().netOps).toEqual({});
    // A real failure still raises a banner — this is what the Cancelled filter
    // must not swallow.
    expect(useRepoStore.getState().error).toEqual({
      kind: "Network",
      message: "host unreachable",
    });
  });

  it("publishes under the right key for each op", async () => {
    const keys: string[] = [];
    for (const cmd of ["fetch_all", "pull", "push"]) {
      mockInvoke(cmd, () => {
        keys.push(Object.keys(useRepoStore.getState().netOps).join(","));
        return undefined;
      });
    }
    mockInvoke("stash_save", () => null);

    await useRepoStore.getState().fetchAll();
    await useRepoStore.getState().pull("origin", "main");
    await useRepoStore.getState().push("origin", "main");

    expect(keys).toEqual(["fetch", "pull", "push"]);
    expect(useRepoStore.getState().netOps).toEqual({});
  });
});

describe("the credential retry is cancellable too", () => {
  // `withAuthRetry` resolves as soon as the challenge is RAISED, not when the
  // retry finishes. So an id minted around it would already be cleared while the
  // prompt is up, and the retry — a second git process, every bit as able to
  // stall — would run with no Stop button and a stale id. Caught by reading the
  // code, not by a failure, which is exactly why it is pinned here.
  const AUTH = { kind: "Auth", message: { host: "github.com", kind: "Https" } };

  it("gives the retry its own id, published while the retry runs", async () => {
    const { useAuthStore } = await import("@/features/auth/useAuthStore");
    useAuthStore.setState({ challenge: null } as never);

    const seen: { opId: unknown; published: unknown }[] = [];
    let attempt = 0;
    mockInvoke("fetch", (args) => {
      attempt += 1;
      seen.push({
        opId: args.opId,
        published: useRepoStore.getState().netOps.fetch,
      });
      if (attempt === 1) throw AUTH;
      return undefined;
    });

    await useRepoStore.getState().fetch("origin");
    // Between the two attempts there is nothing to stop.
    expect(useRepoStore.getState().netOps).toEqual({});

    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "t" }, false);

    expect(seen).toHaveLength(2);
    // Each attempt's id was live in the slice DURING that attempt...
    expect(seen[0].published).toBe(seen[0].opId);
    expect(seen[1].published).toBe(seen[1].opId);
    // ...and they are different processes, so they are different ids.
    expect(seen[0].opId).not.toBe(seen[1].opId);
    expect(useRepoStore.getState().netOps).toEqual({});
  });
});

describe("cancelNetOp", () => {
  it("asks the backend to stop the id that is actually in flight", async () => {
    let cancelledDuring: unknown[] = [];
    mockInvoke("fetch", async (args) => {
      // The click happens WHILE the op is running, which is the only time it
      // can happen at all.
      useRepoStore.getState().cancelNetOp("fetch");
      cancelledDuring = calls("cancel_operation").map((c) => c.args.opId);
      expect(cancelledDuring).toEqual([args.opId]);
      throw CANCELLED;
    });

    await useRepoStore.getState().fetch("origin");

    expect(cancelledDuring).toHaveLength(1);
  });

  it("is a no-op when nothing of that kind is running", () => {
    useRepoStore.getState().cancelNetOp("push");
    expect(calls("cancel_operation")).toHaveLength(0);
  });

  it("survives a rejected cancel — the op had already finished", async () => {
    mockInvoke("cancel_operation", () => {
      throw { kind: "Internal", message: "boom" };
    });
    mockInvoke("fetch", () => {
      useRepoStore.getState().cancelNetOp("fetch");
      return undefined;
    });

    await useRepoStore.getState().fetch("origin");

    // No banner: a cancel that lost the race is the outcome the user wanted.
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("cancelAllNetOps stops every kind in flight", () => {
    useRepoStore.setState({
      netOps: { fetch: "fetch-1", push: "push-2" },
    } as never);

    useRepoStore.getState().cancelAllNetOps();

    expect(calls("cancel_operation").map((c) => c.args.opId).sort()).toEqual([
      "fetch-1",
      "push-2",
    ]);
  });
});

describe("a cancelled op is not a failure", () => {
  it("raises no banner for fetch", async () => {
    mockInvoke("fetch", () => {
      throw CANCELLED;
    });

    await useRepoStore.getState().fetch("origin");

    expect(useRepoStore.getState().error).toBeNull();
    expect(useRepoStore.getState().activity.fetch).toBeUndefined();
  });

  it("raises no banner for push", async () => {
    mockInvoke("push", () => {
      throw CANCELLED;
    });

    await useRepoStore.getState().push("origin", "main");

    expect(useRepoStore.getState().error).toBeNull();
  });

  it("still refreshes after a cancelled pull, banner or not", async () => {
    // A pull killed mid-merge changed the tree. The banner is skipped; the
    // refresh is not — the UI must reflect disk truth either way.
    mockInvoke("stash_save", () => null);
    mockInvoke("pull", () => {
      throw CANCELLED;
    });

    await useRepoStore.getState().pull("origin", "main");

    expect(useRepoStore.getState().error).toBeNull();
    expect(calls("get_status").length).toBeGreaterThan(0);
  });

  it("does not raise the credential prompt for a cancel", async () => {
    // The backend claims a cancel before `map_git_failure` runs, so this can
    // only regress if the frontend starts inventing Auth from something else.
    const { useAuthStore } = await import("@/features/auth/useAuthStore");
    useAuthStore.setState({ challenge: null } as never);
    mockInvoke("fetch", () => {
      throw CANCELLED;
    });

    await useRepoStore.getState().fetch("origin");

    expect(useAuthStore.getState().challenge).toBeNull();
  });
});
