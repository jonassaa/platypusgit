import { describe, it, expect } from "vitest";
import { withPlanBase } from "./withPlanBase";
import type { RebaseStep } from "@/lib/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const BASE = "9".repeat(40);

function step(oid: string, over: Partial<RebaseStep> = {}): RebaseStep {
  return { oid, action: "Pick", message: null, onto: null, mergeParents: [], ...over };
}

describe("withPlanBase", () => {
  it("names the base on the first step and leaves the rest linear", () => {
    const out = withPlanBase([step(A), step(B), step(C)], BASE);
    expect(out.map((s) => s.onto)).toEqual([BASE, null, null]);
  });

  it("skips leading drops — the engine reads the first NON-Drop step", () => {
    const out = withPlanBase([step(A, { action: "Drop" }), step(B), step(C)], BASE);
    expect(out.map((s) => s.onto)).toEqual([null, BASE, null]);
  });

  it("leaves an intermediate step's own base alone (the preserve case)", () => {
    const out = withPlanBase([step(A), step(B, { onto: A }), step(C)], BASE);
    expect(out.map((s) => s.onto)).toEqual([BASE, A, null]);
  });

  it("overwrites the first step's own base — a picked base outranks it", () => {
    const out = withPlanBase([step(A, { onto: C }), step(B)], BASE);
    expect(out[0].onto).toBe(BASE);
  });

  it("is the identity when no base is known", () => {
    const plan = [step(A), step(B)];
    expect(withPlanBase(plan, null)).toBe(plan);
  });

  it("is the identity for an all-Drop plan (the backend refuses it anyway)", () => {
    const plan = [step(A, { action: "Drop" }), step(B, { action: "Drop" })];
    expect(withPlanBase(plan, BASE).map((s) => s.onto)).toEqual([null, null]);
  });

  it("does not mutate its input", () => {
    const plan = [step(A), step(B)];
    withPlanBase(plan, BASE);
    expect(plan[0].onto).toBeNull();
  });
});
