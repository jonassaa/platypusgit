// The palette's route to Stop (#234).
//
// The titlebar button is a mouse target; a hung fetch must be stoppable from the
// keyboard too. Gated on an op actually running, the same way `Resolve
// conflicts…` is — a row that only ever says "nothing to stop" is noise.
import { describe, it, expect, beforeEach } from "vitest";

import { buildCommands } from "./commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { paletteInitial, usePaletteStore } from "./usePaletteStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const REPO = { id: "r1", path: "/repo", head: "main" };
const ROW = "action:cancel-net-op";

function seed(patch: Record<string, unknown> = {}) {
  useRepoStore.setState({ ...emptySlice(), current: REPO, ...patch } as never);
}

const row = () => buildCommands().find((i) => i.id === ROW);

beforeEach(() => {
  resetInvokeMock();
  mockInvoke("cancel_operation", () => true);
  seed();
  usePaletteStore.setState({ ...paletteInitial(), open: true });
});

describe("the Stop row", () => {
  it("is absent while nothing cancellable is running", () => {
    expect(row()).toBeUndefined();
  });

  it("appears while a fetch is in flight, and names it", () => {
    seed({ netOps: { fetch: "fetch-1" } });
    expect(row()?.label).toBe("Stop the running fetch");
  });

  it("stops the op by id when invoked", async () => {
    seed({ netOps: { pull: "pull-9" } });

    row()!.run();

    const calls = getInvokeCalls().filter((c) => c.cmd === "cancel_operation");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.opId).toBe("pull-9");
  });

  it("closes the palette, like every other direct action", () => {
    seed({ netOps: { fetch: "fetch-1" } });

    row()!.run();

    expect(usePaletteStore.getState().open).toBe(false);
  });

  it("addresses the same op the titlebar's Stop does when two overlap", () => {
    seed({ netOps: { fetch: "fetch-1", push: "push-2" } });

    row()!.run();

    const calls = getInvokeCalls().filter((c) => c.cmd === "cancel_operation");
    expect(calls[0].args.opId).toBe("push-2");
  });

  it("is searchable by the words a user would actually type", () => {
    seed({ netOps: { push: "push-2" } });
    const search = row()!.search.toLowerCase();
    for (const term of ["cancel", "stop", "abort", "push"]) {
      expect(search).toContain(term);
    }
  });
});
