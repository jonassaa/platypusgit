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

  it("squash-range: oldest selected stays Pick, rest Squash with message", () => {
    // Select b and c (contiguous). Base is a (parent of oldest, b). Plan
    // covers everything newer than a: b, c, d oldest→newest.
    expect(
      buildRebasePlan(commits, "a", {
        kind: "squash-range",
        oids: ["c", "b"],
        message: "combined",
      }),
    ).toEqual([
      { oid: "b", action: "Pick", message: null }, // oldest selected = anchor
      { oid: "c", action: "Squash", message: "combined" },
      { oid: "d", action: "Pick", message: null }, // newer than the selection
    ]);
  });

  it("squash-range: folds three commits, only the oldest stays Pick", () => {
    expect(
      buildRebasePlan(commits, "a", {
        kind: "squash-range",
        oids: ["b", "c", "d"],
        message: "all",
      }),
    ).toEqual([
      { oid: "b", action: "Pick", message: null },
      { oid: "c", action: "Squash", message: "all" },
      { oid: "d", action: "Squash", message: "all" },
    ]);
  });
});
