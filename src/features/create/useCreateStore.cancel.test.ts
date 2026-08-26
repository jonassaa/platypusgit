// Cancelling a running clone (#234).
//
// The clone is the op with the worst failure mode: before this, a stalled clone
// could only be escaped by force-quitting the app, which left git finishing the
// transfer into a directory the frontend had already given up on.
import { beforeEach, describe, expect, it } from "vitest";

import { useCreateStore } from "./useCreateStore";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const CANCELLED = { kind: "Cancelled" };
const AUTH = { kind: "Auth", message: { host: "github.com", kind: "Https" } };

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

const ARGS = {
  url: "https://github.com/me/slow.git",
  parentDir: "/dev",
  name: "slow",
  recurseSubmodules: false,
};

beforeEach(() => {
  resetInvokeMock();
  mockInvoke("cancel_operation", () => true);
  useAuthStore.setState({ challenge: null } as never);
  useRepoStore.setState({ current: null } as never);
  useCreateStore.setState({
    open: "clone",
    busy: false,
    progress: null,
    error: null,
    cloneOpId: null,
  });
});

describe("the clone publishes an op id while it runs", () => {
  it("hands the same id to the backend and to the dialog, then clears it", async () => {
    let seen: { opId?: string; stored?: string | null } = {};
    mockInvoke("clone_repo", (args) => {
      seen = {
        opId: args.opId as string,
        stored: useCreateStore.getState().cloneOpId,
      };
      throw { kind: "Network", message: "nope" };
    });

    await useCreateStore.getState().runClone(ARGS);

    expect(seen.opId).toBeTruthy();
    expect(seen.stored).toBe(seen.opId);
    // Cleared even though the clone failed, or Cancel points at a dead process.
    expect(useCreateStore.getState().cloneOpId).toBeNull();
  });

  it("mints a FRESH id for the credential retry", async () => {
    // The retry is a second `git clone`. Reusing the first attempt's id would
    // leave Cancel aimed at a process that has already exited.
    const ids: unknown[] = [];
    mockInvoke("clone_repo", (args) => {
      ids.push(args.opId);
      throw AUTH;
    });

    await useCreateStore.getState().runClone(ARGS);
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "t" }, false);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("cancelClone", () => {
  it("asks the backend to stop the clone that is in flight", async () => {
    let asked: unknown[] = [];
    mockInvoke("clone_repo", (args) => {
      useCreateStore.getState().cancelClone();
      asked = calls("cancel_operation").map((c) => c.args.opId);
      expect(asked).toEqual([args.opId]);
      throw CANCELLED;
    });

    await useCreateStore.getState().runClone(ARGS);

    expect(asked).toHaveLength(1);
  });

  it("is a no-op with no clone running", () => {
    useCreateStore.getState().cancelClone();
    expect(calls("cancel_operation")).toHaveLength(0);
  });

  it("does not close the dialog by itself — the backend confirms first", () => {
    // The dialog must not say "done" before the partial destination is gone.
    // Only the `Cancelled` rejection proves the backend cleaned up.
    useCreateStore.setState({ busy: true, cloneOpId: "clone-x" });
    useCreateStore.getState().cancelClone();
    expect(useCreateStore.getState().open).toBe("clone");
    expect(useCreateStore.getState().busy).toBe(true);
  });
});

describe("a cancelled clone closes the dialog and says nothing", () => {
  it("leaves no error and no progress behind", async () => {
    mockInvoke("clone_repo", () => {
      throw CANCELLED;
    });

    await useCreateStore.getState().runClone(ARGS);

    const s = useCreateStore.getState();
    expect(s.open).toBe("none");
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.cloneOpId).toBeNull();
  });

  it("does NOT open a repository — there is nothing there", async () => {
    mockInvoke("clone_repo", () => {
      throw CANCELLED;
    });

    await useCreateStore.getState().runClone(ARGS);

    expect(calls("open_repo")).toHaveLength(0);
  });

  it("still reports a REAL failure, so the filter is not swallowing everything", async () => {
    mockInvoke("clone_repo", () => {
      throw { kind: "Network", message: "repository not found" };
    });

    await useCreateStore.getState().runClone(ARGS);

    // Error stays IN the dialog: the user needs the form to fix the URL.
    expect(useCreateStore.getState().open).toBe("clone");
    expect(useCreateStore.getState().error).toBe("repository not found");
  });

  it("closes the dialog when the credential RETRY is cancelled too", async () => {
    let attempt = 0;
    mockInvoke("clone_repo", () => {
      attempt += 1;
      throw attempt === 1 ? AUTH : CANCELLED;
    });

    await useCreateStore.getState().runClone(ARGS);
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "t" }, false);

    expect(useCreateStore.getState().open).toBe("none");
    expect(useCreateStore.getState().error).toBeNull();
  });
});
