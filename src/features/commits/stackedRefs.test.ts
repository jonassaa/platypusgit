// Telling the user which branches a rebase will move (#240).
//
// The issue calls this the valuable half of the feature: the flag alone is a
// silent behaviour change, and a rebase that quietly moves branches nobody
// thought about is worse than one that leaves them behind — at least the second
// is visible. So the assertions here are about the dialog appearing exactly
// when it should, naming exactly what will move, and never blocking a rebase it
// could not describe.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RebaseStep, StackedRef } from "@/lib/types";

const tauri = vi.hoisted(() => ({ stackedRefs: vi.fn() }));
vi.mock("@/lib/tauri", () => tauri);

const dialog = vi.hoisted(() => ({ pgConfirm: vi.fn() }));
vi.mock("@/design", () => dialog);

import {
  confirmStackedRefs,
  describeStackedRefs,
  resolveUpdateRefs,
} from "./stackedRefs";

const ref = (short: string): StackedRef => ({
  name: `refs/heads/${short}`,
  short,
  oid: `oid-${short}`,
});

const plan: RebaseStep[] = [
  { oid: "a", action: "Pick", message: null, onto: null, mergeParents: [] },
];

beforeEach(() => {
  tauri.stackedRefs.mockReset().mockResolvedValue([]);
  dialog.pgConfirm.mockReset().mockResolvedValue(true);
});

describe("resolveUpdateRefs", () => {
  it("turns the tri-state into what the backend expects", () => {
    // `null` is "ask the repository", NOT a resolved boolean — the app never
    // has to keep its own answer in step with git's config.
    expect(resolveUpdateRefs("config")).toBeNull();
    expect(resolveUpdateRefs("always")).toBe(true);
    expect(resolveUpdateRefs("never")).toBe(false);
  });
});

describe("describeStackedRefs", () => {
  it("names the branches rather than counting them", () => {
    // "3 branches will move" is not something anyone can check. The point is
    // that the user recognises the names as their stack.
    expect(describeStackedRefs([ref("feat/b")])).toBe(
      "This will also move feat/b.",
    );
    expect(describeStackedRefs([ref("feat/b"), ref("feat/c")])).toBe(
      "This will also move feat/b and feat/c.",
    );
    expect(
      describeStackedRefs([ref("feat/a"), ref("feat/b"), ref("feat/c")]),
    ).toBe("This will also move feat/a, feat/b and feat/c.");
  });
});

describe("when the confirmation appears", () => {
  it("is silent when nothing points into the range", async () => {
    // The ordinary case. A confirmation on every rebase would be trained away
    // in a week, and then it would not work when it mattered.
    tauri.stackedRefs.mockResolvedValue([]);
    await expect(confirmStackedRefs("r1", plan, true)).resolves.toBe(true);
    expect(dialog.pgConfirm).not.toHaveBeenCalled();
  });

  it("asks when branches would move, naming them", async () => {
    tauri.stackedRefs.mockResolvedValue([ref("feat/b"), ref("feat/c")]);
    await confirmStackedRefs("r1", plan, true);
    expect(dialog.pgConfirm).toHaveBeenCalledTimes(1);
    const body = String(dialog.pgConfirm.mock.calls[0][0].body);
    expect(body).toContain("feat/b and feat/c");
    // A branch that was already pushed needs a force-push afterwards; saying so
    // is the difference between a warning and a surprise.
    expect(body).toContain("force-push");
  });

  it("does not even look when update-refs is off for this run", async () => {
    // Nothing will move, so there is nothing to warn about — and the lookup
    // would be a wasted round trip on every rebase.
    await expect(confirmStackedRefs("r1", plan, false)).resolves.toBe(true);
    expect(tauri.stackedRefs).not.toHaveBeenCalled();
    expect(dialog.pgConfirm).not.toHaveBeenCalled();
  });

  it("still asks when the decision is left to git config", async () => {
    // `null` means the repository may well say yes, so the user still has to
    // be told. Deciding not to ask here would make `config` the one mode that
    // moves branches silently.
    tauri.stackedRefs.mockResolvedValue([ref("feat/b")]);
    await confirmStackedRefs("r1", plan, null);
    expect(dialog.pgConfirm).toHaveBeenCalledTimes(1);
  });

  it("passes the plan's oids, so the answer is about THIS rebase", async () => {
    const steps: RebaseStep[] = [
      { oid: "x", action: "Pick", message: null, onto: null, mergeParents: [] },
      { oid: "y", action: "Drop", message: null, onto: null, mergeParents: [] },
    ];
    await confirmStackedRefs("r1", steps, true);
    expect(tauri.stackedRefs).toHaveBeenCalledWith("r1", ["x", "y"]);
  });
});

describe("what the answer means", () => {
  it("declining stops the rebase", async () => {
    tauri.stackedRefs.mockResolvedValue([ref("feat/b")]);
    dialog.pgConfirm.mockResolvedValue(false);
    await expect(confirmStackedRefs("r1", plan, true)).resolves.toBe(false);
  });

  it("accepting proceeds", async () => {
    tauri.stackedRefs.mockResolvedValue([ref("feat/b")]);
    dialog.pgConfirm.mockResolvedValue(true);
    await expect(confirmStackedRefs("r1", plan, true)).resolves.toBe(true);
  });

  it("a failed lookup does not block the rebase", async () => {
    // This is an advisory read. Refusing to rebase because we could not
    // enumerate branches would turn a missing warning into a broken feature.
    tauri.stackedRefs.mockRejectedValue(new Error("boom"));
    await expect(confirmStackedRefs("r1", plan, true)).resolves.toBe(true);
    expect(dialog.pgConfirm).not.toHaveBeenCalled();
  });
});
