import { describe, it, expect } from "vitest";
import { buildRebasePlan } from "./buildRebasePlan";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, summary: string): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary, body: null,
  author: "", email: "", timestamp: 0, parents: [], refs: [],
});

describe("buildRebasePlan", () => {
  const commits = [mk("d", "4"), mk("c", "3"), mk("b", "2"), mk("a", "1")];

  it("returns a Pick-only plan for edit-from", () => {
    expect(buildRebasePlan(commits, "a", { kind: "edit-from" })).toEqual([
      { oid: "b", action: "Pick", message: null },
      { oid: "c", action: "Pick", message: null },
      { oid: "d", action: "Pick", message: null },
    ]);
  });

  it("marks the target as Fixup", () => {
    expect(buildRebasePlan(commits, "a", { kind: "fixup", targetOid: "c" })).toEqual([
      { oid: "b", action: "Pick", message: null },
      { oid: "c", action: "Fixup", message: null },
      { oid: "d", action: "Pick", message: null },
    ]);
  });

  it("returns null when the base isn't in commits", () => {
    expect(buildRebasePlan(commits, "zzz", { kind: "edit-from" })).toBeNull();
  });
});
