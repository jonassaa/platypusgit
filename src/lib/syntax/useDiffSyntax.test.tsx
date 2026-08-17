// The texts `useDiffSyntax` exposes are what whole-file mode fills gaps from, so
// the ABSENT sentinel matters as much as the tokens.
//
// `null` is what `flattenDiffRows` bails on ("no text to fill from" → render the
// hunks alone). An empty string is not the same thing: it says "this file has one
// blank line", so a `?? ""` here would send whole-file mode off to compose a file
// from nothing. Since #151 an absent side RESOLVES rather than rejecting, so this
// sentinel is now on the common path (an added file's old side, a deleted file's
// new side, a submodule, a directory).
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { mockInvoke } from "@/test/invokeMock";
import { useDiffSyntax } from "./useDiffSyntax";

vi.mock("./tokenize", async (orig) => ({
  ...(await orig<typeof import("./tokenize")>()),
  tokenizeFile: async () => null,
}));

describe("useDiffSyntax's exposed texts", () => {
  it("keeps an absent side null rather than an empty string", async () => {
    mockInvoke("read_file_content_at_rev", () => null);
    mockInvoke("read_file_content", () => ({
      path: "a.ts",
      binary: false,
      text: "one\ntwo\n",
      fromHead: false,
      size: 8,
    }));

    const { result } = renderHook(() =>
      useDiffSyntax({
        repoId: "r1",
        path: "a.ts",
        old: { kind: "rev", rev: "HEAD" },
        new: { kind: "worktree" },
      }),
    );

    await waitFor(() => expect(result.current.newText).toBe("one\ntwo\n"));
    expect(result.current.oldText).toBeNull();
  });

  it("keeps a rejected side null too", async () => {
    mockInvoke("read_file_content_at_rev", () => {
      throw { kind: "UnknownRepo", message: "r1" };
    });
    mockInvoke("read_file_content", () => null);

    const { result } = renderHook(() =>
      useDiffSyntax({
        repoId: "r1",
        path: "a.ts",
        old: { kind: "rev", rev: "HEAD" },
        new: { kind: "worktree" },
      }),
    );

    await waitFor(() => expect(result.current.oldText).toBeNull());
    expect(result.current.newText).toBeNull();
  });
});
