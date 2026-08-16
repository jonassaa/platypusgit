// Branch picker ordering + resting cursor (#135).
//
// The comparator itself is tested in orderBranches.test.ts; this pins that the
// picker actually calls it, that it calls it AFTER filtering, and where the
// keyboard cursor starts — Enter checks out the active row, so that position is
// a correctness question, not a cosmetic one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BranchPicker } from "./BranchPicker";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { resetInvokeMock } from "@/test/invokeMock";
import type { BranchInfo } from "@/lib/types";

const branch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "0".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...over,
});

let anchor: HTMLElement;

function setup(branches: BranchInfo[]) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/feature/fresh" },
    branches,
  } as never);
  return render(<BranchPicker anchor={anchor} open onClose={() => {}} />);
}

const rowNames = () =>
  Array.from(document.querySelectorAll("[data-branch-row]")).map((el) =>
    el.querySelector("span")?.textContent,
  );

const activeName = () =>
  document
    .querySelector('[data-branch-row][data-active="true"]')
    ?.querySelector("span")?.textContent;

beforeEach(() => {
  resetInvokeMock();
  anchor = document.createElement("div");
  document.body.appendChild(anchor);
});

afterEach(() => {
  anchor.remove();
});

describe("BranchPicker ordering", () => {
  it("pins the default branch, then orders by recency", () => {
    setup([
      branch({ name: "chore/old", tipTime: 50 }),
      branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
      branch({ name: "main", tipTime: 100, isDefault: true }),
    ]);

    expect(rowNames()).toEqual(["main", "feature/fresh", "chore/old"]);
  });

  it("orders local and remote sections independently", () => {
    setup([
      branch({ name: "zzz-local", tipTime: 900 }),
      branch({ name: "main", tipTime: 100, isDefault: true, isHead: true }),
      branch({ name: "origin/zzz", tipTime: 900, isRemote: true }),
      branch({ name: "origin/main", tipTime: 100, isRemote: true, isDefault: true }),
    ]);

    expect(rowNames()).toEqual(["main", "zzz-local", "origin/main", "origin/zzz"]);
  });

  it("does not resurrect the default branch when the query excludes it", () => {
    setup([
      branch({ name: "main", tipTime: 100, isDefault: true }),
      branch({ name: "chore/old", tipTime: 50 }),
      branch({ name: "chore/new", tipTime: 900 }),
    ]);

    fireEvent.change(screen.getByPlaceholderText("Switch to branch…"), {
      target: { value: "chore" },
    });

    expect(rowNames()).toEqual(["chore/new", "chore/old"]);
  });
});

describe("BranchPicker resting cursor", () => {
  it("rests on the current branch with an empty query", () => {
    // Enter on the HEAD row is a no-op (`checkout` early-returns), so this is
    // the only starting position where the stray keystroke checks nothing out.
    setup([
      branch({ name: "main", tipTime: 100, isDefault: true }),
      branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
    ]);

    expect(activeName()).toBe("feature/fresh");
  });

  it("moves to the first row once a query is typed", () => {
    setup([
      branch({ name: "main", tipTime: 100, isDefault: true }),
      branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
      branch({ name: "feature/other", tipTime: 800 }),
    ]);

    fireEvent.change(screen.getByPlaceholderText("Switch to branch…"), {
      target: { value: "feature" },
    });

    expect(rowNames()).toEqual(["feature/fresh", "feature/other"]);
    expect(activeName()).toBe("feature/fresh");
  });

  it("falls back to the first row when nothing is HEAD", () => {
    setup([
      branch({ name: "main", tipTime: 100, isDefault: true }),
      branch({ name: "feature/fresh", tipTime: 900 }),
    ]);

    expect(activeName()).toBe("main");
  });

  // Regression: the popover can be opened before `list_branches` resolves. An
  // effect keyed only on [open, query] ran once against an EMPTY list, landed
  // on 0, and never re-ran — leaving the cursor on the pinned default once the
  // branches arrived, which is the exact accident this rule exists to prevent.
  it("re-parks on HEAD when the branch list arrives after the popover opened", () => {
    setup([]);
    expect(activeName()).toBeUndefined();

    act(() => {
      useRepoStore.setState({
        branches: [
          branch({ name: "main", tipTime: 100, isDefault: true }),
          branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
        ],
      } as never);
    });

    expect(rowNames()).toEqual(["main", "feature/fresh"]);
    expect(activeName()).toBe("feature/fresh");
  });

  // ...but re-running must not undo the user's own aim, which is why the flag
  // exists rather than a bare dependency-array change.
  it("leaves a cursor the user moved alone when the list changes", () => {
    setup([
      branch({ name: "main", tipTime: 100, isDefault: true }),
      branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
    ]);

    fireEvent.keyDown(screen.getByPlaceholderText("Switch to branch…"), {
      key: "ArrowUp",
    });
    expect(activeName()).toBe("main");

    act(() => {
      useRepoStore.setState({
        branches: [
          branch({ name: "main", tipTime: 100, isDefault: true }),
          branch({ name: "feature/fresh", tipTime: 900, isHead: true }),
          branch({ name: "chore/late", tipTime: 50 }),
        ],
      } as never);
    });

    expect(activeName()).toBe("main");
  });
});
