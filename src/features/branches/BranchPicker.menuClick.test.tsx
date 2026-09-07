// A row's context menu is portalled to `document.body`, i.e. OUT of the
// picker's popover — so the picker's dismiss-on-outside-press handler read the
// press on its own menu as a press outside itself. The picker closed on
// `mousedown` and took the menu with it, and the entry's `click` landed on a
// detached node: "Merge into current" and every other entry on that menu did
// nothing under a real mouse (#422).
//
// The e2e specs (merge-window, merge-conflict) drive this end to end now that
// jsClickMenuItem presses first; this is the fast guard on the press itself.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

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

beforeEach(() => {
  resetInvokeMock();
  anchor = document.createElement("div");
  document.body.appendChild(anchor);
});

afterEach(() => {
  anchor.remove();
});

function menuItem(label: string): HTMLElement | null {
  const menu = document.querySelector("[data-pg-menu]");
  if (!menu) return null;
  const span = Array.from(menu.querySelectorAll("span")).find(
    (s) => s.textContent === label,
  );
  return (span?.closest("div") as HTMLElement | null) ?? null;
}

describe("branch picker row menu", () => {
  it("survives the press on one of its own entries", () => {
    const onClose = vi.fn();
    useRepoStore.setState({
      current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
      branches: [branch("main", true), branch("feature")],
    } as never);
    render(<BranchPicker anchor={anchor} open onClose={onClose} />);

    const row = document.querySelector('[data-branch-row][data-branch-name="feature"]');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);

    const merge = menuItem("Merge into current");
    expect(merge).not.toBeNull();

    // The press is the bug: it must not dismiss the picker, because the picker
    // owns the menu the user is pressing.
    fireEvent.mouseDown(merge!);
    expect(onClose).not.toHaveBeenCalled();
    expect(menuItem("Merge into current")).not.toBeNull();
  });

  it("still dismisses on a press outside the picker and its menu", () => {
    const onClose = vi.fn();
    useRepoStore.setState({
      current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
      branches: [branch("main", true), branch("feature")],
    } as never);
    render(<BranchPicker anchor={anchor} open onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
