// "Create patch…" — export commits as mailbox patch files.
//
// The ordering assertion is the load-bearing one: the backend numbers the
// series in the order it is given, so a reversed list would produce 0001 for
// the newest commit and a series that replays backwards.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createPatch } from "./createPatch";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const A = "a".repeat(40); // newest
const B = "b".repeat(40);
const C = "c".repeat(40); // oldest

// The folder picker is a Tauri plugin call, not one of our commands.
const picked = vi.fn<() => Promise<string | null>>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => picked(),
}));

const exports = () => getInvokeCalls().filter((c) => c.cmd === "format_patch");

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    error: null,
  } as never);
  picked.mockReset();
  picked.mockResolvedValue("/tmp/patches");
  mockInvoke("format_patch", () => ["/tmp/patches/0001-one.patch"]);
});

afterEach(() => vi.restoreAllMocks());

describe("createPatch", () => {
  it("exports to the directory the user picked", async () => {
    await createPatch([A]);
    expect(exports()).toHaveLength(1);
    expect(exports()[0].args).toMatchObject({
      repoId: "r1",
      oids: [A],
      outDir: "/tmp/patches",
    });
  });

  it("passes a multi-commit selection through in the order given", async () => {
    mockInvoke("format_patch", () => [
      "/tmp/patches/0001-c.patch",
      "/tmp/patches/0002-b.patch",
      "/tmp/patches/0003-a.patch",
    ]);
    // Oldest-first, as planCommitSelection hands them over. Reversing this
    // would number the newest commit 0001 and replay the series backwards.
    await createPatch([C, B, A]);
    expect(exports()[0].args.oids).toEqual([C, B, A]);
  });

  it("exports nothing when the picker is dismissed", async () => {
    picked.mockResolvedValue(null);
    await createPatch([A]);
    expect(exports()).toHaveLength(0);
  });

  it("exports nothing for an empty selection, and does not open a picker", async () => {
    await createPatch([]);
    expect(picked).not.toHaveBeenCalled();
    expect(exports()).toHaveLength(0);
  });

  it("exports nothing without an open repository", async () => {
    useRepoStore.setState({ current: null } as never);
    await createPatch([A]);
    expect(picked).not.toHaveBeenCalled();
    expect(exports()).toHaveLength(0);
  });

  it("reports a refusal in the error banner — the user asked for files and got none", async () => {
    mockInvoke("format_patch", () => {
      throw { kind: "InvalidArgument", message: "aaaaaaa is a merge commit" };
    });
    await createPatch([A]);
    expect(useRepoStore.getState().error).toBeTruthy();
    expect(useRepoStore.getState().error?.kind).toBe("InvalidArgument");
  });

  it("does not throw on a refusal — a menu click must not crash the screen", async () => {
    mockInvoke("format_patch", () => {
      throw { kind: "Io", message: "permission denied" };
    });
    await expect(createPatch([A])).resolves.toBeUndefined();
  });
});
