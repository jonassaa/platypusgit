// Warming the token cache for a commit's other files.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { PREFETCH_MAX, usePrefetchSyntax } from "./usePrefetchSyntax";

const tokenized: string[] = [];
vi.mock("./tokenize", () => ({
  tokenizeFile: async (path: string) => {
    tokenized.push(path);
    return null;
  },
}));

const readPaths = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "read_file_content_at_rev")
    .map((c) => c.args.path as string);

beforeEach(() => {
  resetInvokeMock();
  tokenized.length = 0;
  mockInvoke("read_file_content_at_rev", (args) => ({
    path: args.path as string,
    binary: false,
    text: "let a = 1",
    fromHead: false,
    size: 9,
  }));
});

const paths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"];

describe("usePrefetchSyntax", () => {
  it("warms at most PREFETCH_MAX files and skips the selected one", async () => {
    renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths,
        source: { kind: "rev", rev: "abc" },
        enabled: true,
      }),
    );
    await waitFor(() => expect(tokenized).toHaveLength(PREFETCH_MAX));
    // a.ts is the selected file — the panel is already loading it.
    expect(readPaths()).not.toContain("a.ts");
    expect(readPaths()).toEqual(["b.ts", "c.ts", "d.ts", "e.ts"]);
  });

  it("does nothing when disabled", async () => {
    renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths,
        source: { kind: "rev", rev: "abc" },
        enabled: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(readPaths()).toEqual([]);
  });

  it("does nothing without a side to read from", async () => {
    renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths,
        source: { kind: "none" },
        enabled: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(readPaths()).toEqual([]);
  });

  it("does nothing when the selected file is the only one", async () => {
    renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths: ["only.ts"],
        source: { kind: "rev", rev: "abc" },
        enabled: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(readPaths()).toEqual([]);
  });

  // A read that fails must not stop the rest of the list, and must not surface.
  it("keeps going past a file it cannot read", async () => {
    resetInvokeMock();
    mockInvoke("read_file_content_at_rev", (args) => {
      if (args.path === "b.ts") throw new Error("no blob");
      return {
        path: args.path as string,
        binary: false,
        text: "let a = 1",
        fromHead: false,
        size: 9,
      };
    });
    renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths,
        source: { kind: "rev", rev: "abc" },
        enabled: true,
      }),
    );
    await waitFor(() => expect(tokenized).toEqual(["c.ts", "d.ts", "e.ts"]));
  });

  it("abandons the rest of the list when the commit changes", async () => {
    const { unmount } = renderHook(() =>
      usePrefetchSyntax({
        repoId: "r1",
        paths,
        source: { kind: "rev", rev: "abc" },
        enabled: true,
      }),
    );
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    // Cancelled before the idle callback ran, so nothing was warmed.
    expect(tokenized).toEqual([]);
  });
});
