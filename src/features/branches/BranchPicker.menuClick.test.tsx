// A branch row's ACTIONS MENU is what a press on the row opens, and that menu
// is portalled out of the picker. Two rules live here.
//
// 1. A left-click — and Enter — on a branch row OPENS the row's actions menu
//    instead of checking the branch out. The picker used to spend a single
//    click on a working-tree mutation: `onClick` called `checkoutBranch`
//    straight away, so a misfired press in a list of near-identical names
//    switched branches. "Check out" is the menu's FIRST entry, so the op costs
//    one deliberate second press and nothing became unreachable — while the
//    current branch's row, dead under the old click, now offers everything
//    else it can do. This is the split the Branches screen already had (a row
//    click selects, the menu acts); the picker was the last surface without it.
//
// 2. The menu must SURVIVE the press that runs one of its entries. A row's
//    menu is portalled to `document.body`, i.e. OUT of the picker's popover —
//    so the picker's dismiss-on-outside-press handler read the press on its own
//    menu as a press outside itself. The picker closed on `mousedown` and took
//    the menu with it, and the entry's `click` landed on a detached node:
//    "Merge into current" and every other entry did nothing under a real mouse
//    (#422). Rule 1 makes that path the ONLY way to check out with a mouse, so
//    this guard now protects the picker's primary action, not just its menu.
//
// The e2e specs (branches, merge-window, merge-conflict) drive this end to end
// now that jsClickMenuItem presses first; these are the fast guards.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { BranchPicker } from "./BranchPicker";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { resetInvokeMock } from "@/test/invokeMock";
import type { BranchInfo } from "@/lib/types";

const branch = (name: string, isHead = false): BranchInfo => ({
  name,
  isHead,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "0".repeat(40),
  tipTime: 0,
  isDefault: false,
});

let anchor: HTMLElement;
let checkoutBranch: ReturnType<typeof vi.fn>;
// Typed to the prop's own signature: the bare `vi.fn()` type is a union with a
// constructable, which `onClose: () => void` does not accept.
let onClose: Mock<() => void>;

function setup() {
  checkoutBranch = vi.fn();
  onClose = vi.fn();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    branches: [branch("main", true), branch("feature")],
    checkoutBranch,
  } as never);
  return render(<BranchPicker anchor={anchor} open onClose={onClose} />);
}

beforeEach(() => {
  resetInvokeMock();
  anchor = document.createElement("div");
  document.body.appendChild(anchor);
});

afterEach(() => {
  anchor.remove();
});

const row = (name: string) =>
  document.querySelector(
    `[data-branch-row][data-branch-name="${name}"]`,
  ) as HTMLElement;

function menuItem(label: string): HTMLElement | null {
  const menu = document.querySelector("[data-pg-menu]");
  if (!menu) return null;
  const span = Array.from(menu.querySelectorAll("span")).find(
    (s) => s.textContent === label,
  );
  return (span?.closest("div") as HTMLElement | null) ?? null;
}

describe("branch picker row press", () => {
  it("opens the row's actions menu instead of checking out", () => {
    setup();

    fireEvent.click(row("feature"));

    expect(menuItem("Check out")).not.toBeNull();
    // The press itself must not mutate anything, and must not dismiss the
    // picker — the menu it just opened is rendered inside it.
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("checks out and dismisses the picker when Check out is chosen", () => {
    setup();

    fireEvent.click(row("feature"));
    fireEvent.click(menuItem("Check out")!);

    expect(checkoutBranch).toHaveBeenCalledWith("feature");
    // The old one-click path closed the popover, so the two-press path has to
    // as well: `PGContextMenu`'s own `onClose` cannot carry it, because it
    // fires for a DISMISSAL too (see the test below).
    expect(onClose).toHaveBeenCalled();
  });

  // The distinction `withPickerDismiss` exists for: `PGContextMenu` fires one
  // `onClose` for "an entry ran" AND for "the user dismissed me", so the picker
  // cannot hang its own dismissal off it. Backing out of a menu has to leave
  // the picker exactly as it was.
  it("leaves the picker open when the menu is merely dismissed", async () => {
    setup();

    fireEvent.click(row("feature"));
    expect(menuItem("Check out")).not.toBeNull();

    // The menu arms its own dismiss listeners on `document` in a `setTimeout`,
    // so the press that opened it cannot immediately close it again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.querySelector("[data-pg-menu]")).toBeNull();
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens a menu on the CURRENT branch's row, which the old click ignored", () => {
    setup();

    fireEvent.click(row("main"));

    // Everything the current branch can still do — merge, rename, push — is
    // reachable now; only Check out is disabled, so pressing it does nothing.
    expect(menuItem("Rename…")).not.toBeNull();
    fireEvent.click(menuItem("Check out")!);
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it("opens the active row's menu on Enter, not a checkout", () => {
    setup();
    // The cursor rests on HEAD with an empty query; a query moves it to the
    // top match, so this aims Enter at `feature` without a mouse.
    fireEvent.change(screen.getByPlaceholderText("Switch to branch…"), {
      target: { value: "feature" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Switch to branch…"), {
      key: "Enter",
    });

    expect(menuItem("Check out")).not.toBeNull();
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("branch picker row menu", () => {
  it("survives the press on one of its own entries", () => {
    setup();

    const target = row("feature");
    expect(target).not.toBeNull();
    fireEvent.contextMenu(target);

    const merge = menuItem("Merge into current");
    expect(merge).not.toBeNull();

    // The press is the bug: it must not dismiss the picker, because the picker
    // owns the menu the user is pressing.
    fireEvent.mouseDown(merge!);
    expect(onClose).not.toHaveBeenCalled();
    expect(menuItem("Merge into current")).not.toBeNull();
  });

  it("still dismisses on a press outside the picker and its menu", () => {
    setup();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
