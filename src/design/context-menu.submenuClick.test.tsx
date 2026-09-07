// A submenu is a SEPARATE portal, so the parent menu's dismiss-on-outside-press
// handler used to see a press on its own submenu as a press outside itself: the
// whole tree unmounted on `mousedown`, and the `click` that would have run the
// item's handler never reached it. Every submenu entry — "Reset current branch
// to here" ▸ Soft/Mixed/Hard, "Check out branch", "Bisect" — silently did
// nothing under a real mouse (#422).
//
// The e2e layer cannot see this: `HTMLElement.click()` dispatches a bare `click`
// with no preceding press, which is a sequence no user can produce. So this
// lives here, where the press can be spelled out.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PGContextMenu, type ContextMenuItem } from "./context-menu";

/** The outside-press listeners attach in a `setTimeout(0)` — let them. */
async function listenersAttached() {
  await new Promise((r) => setTimeout(r, 0));
}

function row(label: string): HTMLElement {
  const el = screen.getByText(label).closest("div");
  if (!el) throw new Error(`no menu row for ${label}`);
  return el as HTMLElement;
}

describe("PGContextMenu submenus", () => {
  function open(onClick: () => void, onClose = vi.fn()) {
    const items: ContextMenuItem[] = [
      { label: "Plain entry", onClick: vi.fn() },
      {
        label: "Reset current branch to here",
        submenu: [{ label: "Hard (discard changes)", danger: true, onClick }],
      },
    ];
    render(<PGContextMenu x={10} y={10} items={items} onClose={onClose} />);
    return { onClose };
  }

  it("runs a submenu item's handler on a real press-then-click", async () => {
    const onClick = vi.fn();
    const { onClose } = open(onClick);
    await listenersAttached();

    fireEvent.mouseEnter(row("Reset current branch to here"));
    const hard = row("Hard (discard changes)");

    // The press is the whole bug: it must not dismiss the menu the submenu
    // belongs to, or the item is gone before its click can land.
    fireEvent.mouseDown(hard);
    expect(onClose).not.toHaveBeenCalled();
    expect(hard).toBeInTheDocument();

    fireEvent.click(hard);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("still dismisses on a press outside the menu tree", async () => {
    const onClick = vi.fn();
    const { onClose } = open(onClick);
    await listenersAttached();

    fireEvent.mouseEnter(row("Reset current branch to here"));
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
