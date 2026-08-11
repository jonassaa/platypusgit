import { describe, expect, it, beforeEach } from "vitest";
import { readViewMode, writeViewMode } from "./CommitPanel";

beforeEach(() => {
  localStorage.clear();
});

describe("CommitPanel view mode persistence", () => {
  it("defaults to flat, preserving today's behavior", () => {
    expect(readViewMode()).toBe("flat");
  });

  it("round-trips through localStorage", () => {
    writeViewMode("tree");
    expect(readViewMode()).toBe("tree");
    expect(localStorage.getItem("pg-commit-view")).toBe("tree");
  });

  it("falls back to flat on a corrupt stored value", () => {
    localStorage.setItem("pg-commit-view", "garbage");
    expect(readViewMode()).toBe("flat");
  });
});
