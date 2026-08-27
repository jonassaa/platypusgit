// The "Fast-forward to upstream" entry on a branch's context menu (#246).
//
// The two things worth pinning are the ones a reviewer would get wrong: it is
// offered on branches that are NOT checked out (the whole point), and it is not
// gated on `behind`, which is only as fresh as the last fetch — and this op
// fetches, so gating would hide the action exactly when it is needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { branchMenuItems, type ContextMenuItem } from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";

const LABEL = "Fast-forward to upstream";

const entry = (items: ContextMenuItem[]) =>
  items.find((i) => typeof i.label === "string" && i.label === LABEL);

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "feat/x" },
    branches: [],
  } as never);
});

describe("branchMenuItems fast-forward entry", () => {
  it("is offered on a branch that is not checked out", () => {
    const item = entry(
      branchMenuItems({ name: "main", current: false, upstream: "origin/main" }),
    );
    expect(item).toBeDefined();
    expect(item?.disabled).toBeFalsy();
  });

  it("is offered on the checked-out branch too — the store routes it to pull", () => {
    const item = entry(
      branchMenuItems({ name: "main", current: true, upstream: "origin/main" }),
    );
    expect(item?.disabled).toBeFalsy();
  });

  it("is disabled without an upstream, which is the only thing it needs", () => {
    const item = entry(
      branchMenuItems({ name: "orphan", current: false, upstream: null }),
    );
    expect(item?.disabled).toBe(true);
  });

  it("calls the store action with the branch it was opened on", async () => {
    const fastForwardBranch = vi.fn().mockResolvedValue(null);
    useRepoStore.setState({ fastForwardBranch } as never);

    await entry(
      branchMenuItems({ name: "main", current: false, upstream: "origin/main" }),
    )?.onClick?.();

    expect(fastForwardBranch).toHaveBeenCalledWith("main");
  });

  it("flashes the outcome, including 'nothing changed'", async () => {
    const fastForwardBranch = vi.fn().mockResolvedValue({
      branch: "main",
      upstream: "origin/main",
      from: "a".repeat(40),
      to: "a".repeat(40),
      moved: false,
    });
    useRepoStore.setState({ fastForwardBranch } as never);

    await entry(
      branchMenuItems({ name: "main", current: false, upstream: "origin/main" }),
    )?.onClick?.();

    const flash = document.querySelector("[data-pg-flash]");
    expect(flash?.textContent).toBe("main is already up to date");
  });
});
