// A context menu taller than the window must stay REACHABLE.
//
// The commit menu is 31 items / ~734px at its MINIMUM — one branch at the
// commit, no custom actions — so on any window shorter than that it exceeds the
// viewport. Before this guard the menu had no height bound and no scroll, and
// the off-screen correction degenerated:
//
//     if (y + r.height + 4 > vh) ny = Math.max(4, vh - r.height - 4);
//
// With `r.height > vh`, `vh - r.height - 4` is NEGATIVE, `Math.max` pins the
// menu at `top: 4`, and everything past the bottom edge is unreachable — no
// scrollbar, no keyboard route, nothing. "View in browser" is the last entry in
// the commit menu, so it was the first thing lost.
//
// jsdom performs no layout, so the assertions here are on the STYLE CONTRACT
// that makes overflow reachable in a real webview. That is the layer the
// regression would land in: both properties are unconditional, so there is no
// threshold for a later change to get wrong.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PGContextMenu, type ContextMenuItem } from "./context-menu";

/** The outside-press listeners attach in a `setTimeout(0)` — let them. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function menuEl(): HTMLElement {
  const el = document.querySelector("[data-pg-menu]");
  if (!el) throw new Error("no context menu rendered");
  return el as HTMLElement;
}

/** `n` plain rows, enough to exceed any plausible window height. */
const manyItems = (n: number): ContextMenuItem[] =>
  Array.from({ length: n }, (_, i) => ({ label: `Entry ${i}`, onClick: vi.fn() }));

describe("PGContextMenu overflow", () => {
  it("bounds its height to the viewport", async () => {
    render(<PGContextMenu x={10} y={10} items={manyItems(60)} onClose={vi.fn()} />);
    await settle();
    // Whatever the exact expression, it must be viewport-relative — a fixed
    // pixel cap would be wrong on a small window and wasteful on a large one.
    expect(menuEl().style.maxHeight).toMatch(/vh|vb|dvh/);
  });

  it("makes the overflow scrollable rather than clipped", async () => {
    render(<PGContextMenu x={10} y={10} items={manyItems(60)} onClose={vi.fn()} />);
    await settle();
    // `hidden` would bound the height and still lose the entries — the bug this
    // guards is unreachability, not spill.
    expect(menuEl().style.overflowY).toBe("auto");
  });

  it("applies the bound unconditionally, not past some item count", async () => {
    // A threshold is the shape a later change gets wrong: it would work for the
    // commit menu and quietly fail for the next menu to grow.
    render(<PGContextMenu x={10} y={10} items={manyItems(3)} onClose={vi.fn()} />);
    await settle();
    expect(menuEl().style.maxHeight).toMatch(/vh|vb|dvh/);
    expect(menuEl().style.overflowY).toBe("auto");
  });

  it("still positions a short menu at the click point", async () => {
    // The bound must not disturb ordinary placement. jsdom reports a zero-size
    // rect, so no correction should fire and the menu keeps the given point.
    render(<PGContextMenu x={42} y={99} items={manyItems(3)} onClose={vi.fn()} />);
    await settle();
    expect(menuEl().style.left).toBe("42px");
    expect(menuEl().style.top).toBe("99px");
  });
});
