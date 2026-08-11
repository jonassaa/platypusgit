import { describe, expect, it, beforeEach } from "vitest";
import { readViewMode, writeViewMode, validSelectionKeys } from "./RepoBrowser";
import { buildStatusTree } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

function mod(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("RepoBrowser view mode persistence", () => {
  it("defaults to tree, preserving today's behavior", () => {
    expect(readViewMode()).toBe("tree");
  });

  it("round-trips through localStorage", () => {
    writeViewMode("flat");
    expect(readViewMode()).toBe("flat");
    expect(localStorage.getItem("pg-browser-view")).toBe("flat");
  });

  it("falls back to tree on a corrupt stored value", () => {
    localStorage.setItem("pg-browser-view", "garbage");
    expect(readViewMode()).toBe("tree");
  });
});

describe("validSelectionKeys", () => {
  const files = [mod("src/a.ts"), mod("src/nested/b.ts")];
  const tree = buildStatusTree(files);

  it("keeps folder keys in tree mode", () => {
    const valid = validSelectionKeys("tree", tree, files);
    expect(valid.has("/src")).toBe(true);
    expect(valid.has("/src/a.ts")).toBe(true);
  });

  it("drops folder keys in flat mode but keeps file keys", () => {
    const valid = validSelectionKeys("flat", tree, files);
    expect(valid.has("/src")).toBe(false);
    expect(valid.has("/src/a.ts")).toBe(true);
    expect(valid.has("/src/nested/b.ts")).toBe(true);
  });
});
