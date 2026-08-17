// What the error BANNER reads for a throw that is not an AppError.
//
// #151 pointed the five `toAppError` copies at `describeError`, which formats for
// the LOG FILE — it leads with a discriminant on purpose. That fixed the actual
// bug (a plain object read "[object Object]") but also put "TypeError: " in front
// of every banner message from a thrown JS Error, which is developer text in a
// place four other stores already use `appErrorMessage` for.
import { beforeEach, describe, expect, it } from "vitest";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";

const HANDLE = { id: "repo-1", path: "/tmp/r", head: "main" };
const initial = useRepoStore.getState();

/** A store action whose IPC throws `thrown`, run against an open repository. */
async function stageThrowing(thrown: unknown) {
  useRepoStore.setState({ ...initial, current: HANDLE }, true);
  useRepoStore.setState({ refreshStatus: async () => {} });
  mockInvoke("stage_paths", () => {
    throw thrown;
  });
  await useRepoStore.getState().stage(["a.txt"]);
  return useRepoStore.getState().error;
}

describe("useRepoStore's error banner text", () => {
  beforeEach(() => {
    useRepoStore.setState(initial, true);
  });

  it("shows a thrown Error's prose without the class name a log line wants", async () => {
    const err = await stageThrowing(new TypeError("x is not a function"));
    expect(err).toEqual({ kind: "Internal", message: "x is not a function" });
  });

  it("still renders a plain thrown object's reason — the #146 bug", async () => {
    const err = await stageThrowing({ code: 7, why: "nope" });
    expect(err?.message).not.toContain("[object Object]");
    expect(err?.message).toContain("nope");
  });

  it("passes a real AppError through untouched", async () => {
    const app = { kind: "Git", message: "index is locked" };
    expect(await stageThrowing(app)).toEqual(app);
  });
});
