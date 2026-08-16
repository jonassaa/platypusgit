// Regression: a palette branch pick step must not preselect its first row.
//
// #135 pins the default branch at row 0 of every branch list, and the palette
// resets `activeIndex` to 0 on every `pushStep`. That put `main` under the
// cursor of the Delete step, one Enter after the Enter that opened it — and
// `delete_branch` refuses only UNMERGED branches, so the default branch (an
// ancestor of HEAD) went without a murmur, unconfirmed and irreversible.
//
// Two things are pinned here: the step rests on no row, and the delete itself
// now confirms.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette } from "./CommandPalette";
import { paletteInitial, usePaletteStore } from "./usePaletteStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import type { BranchInfo } from "@/lib/types";

const mkBranch = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: null,
  tipTime: 0,
  isDefault: false,
  ...over,
});

let deleted: string[] = [];

function setup() {
  deleted = [];
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "feat/y" },
    status: [],
    allFiles: [],
    // `main` is the pinned default and NOT head, so it survives the step's
    // `!b.isHead && !b.isRemote` filter and sorts to row 0.
    branches: [
      mkBranch({ name: "chore/x", tipTime: 900 }),
      mkBranch({ name: "main", tipTime: 100, isDefault: true }),
      mkBranch({ name: "feat/y", tipTime: 950, isHead: true }),
    ],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
    deleteBranch: async (name: string) => {
      deleted.push(name);
    },
  } as never);
  useNavStore.setState({ intent: null });
  usePaletteStore.setState(paletteInitial());
  localStorage.clear();
  mockInvoke("list_all_files", () => []);
}

const rowLabels = () =>
  Array.from(document.querySelectorAll("[data-pal-index]")).map(
    (el) => el.textContent ?? "",
  );

async function openDeleteStep(user: ReturnType<typeof userEvent.setup>) {
  usePaletteStore.getState().openPalette();
  render(
    <WithDialogs>
      <CommandPalette />
    </WithDialogs>,
  );
  await user.keyboard("Delete branch");
  await user.keyboard("{Enter}");
  expect(usePaletteStore.getState().stack.at(-1)).toMatchObject({
    kind: "pick",
    title: "Delete branch",
  });
}

describe("palette branch pick steps", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    setup();
  });

  it("rests on no row, so the Enter that opened the step cannot fire row 0", async () => {
    const user = userEvent.setup();
    await openDeleteStep(user);

    // Row 0 IS the pinned default — that is precisely why nothing may rest there.
    expect(rowLabels()[0]).toContain("main");

    await user.keyboard("{Enter}");

    // Activating a row closes the palette and raises the confirm, so "still
    // open, no dialog" is the assertion that a row was NOT activated —
    // `deleted` alone would be empty either way while the confirm is pending.
    expect(usePaletteStore.getState().open).toBe(true);
    expect(document.querySelector("[data-pg-dialog]")).toBeNull();
    expect(deleted).toEqual([]);
  });

  it("confirms before deleting once the user aims a row", async () => {
    const user = userEvent.setup();
    await openDeleteStep(user);

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    // The confirm is the point: this was the one delete path with none.
    expect(deleted).toEqual([]);
    await acceptDialog();
    expect(deleted).toEqual(["main"]);
  });

  it("moves the cursor to the top match once a query is typed", async () => {
    const user = userEvent.setup();
    await openDeleteStep(user);

    await user.keyboard("chore");
    expect(rowLabels()[0]).toContain("chore/x");

    await user.keyboard("{Enter}");
    await acceptDialog();

    expect(deleted).toEqual(["chore/x"]);
  });

  it("the other branch steps decline a resting row too", async () => {
    const user = userEvent.setup();
    usePaletteStore.getState().openPalette();
    render(
      <WithDialogs>
        <CommandPalette />
      </WithDialogs>,
    );
    await user.keyboard("Checkout branch");
    await user.keyboard("{Enter}");

    const step = usePaletteStore.getState().stack.at(-1);
    expect(step).toMatchObject({ kind: "pick", title: "Checkout branch" });
    expect(step && "cursor" in step ? step.cursor : undefined).toBe("none");
    expect(screen.queryByText("Checkout branch")).toBeTruthy();
  });
});
