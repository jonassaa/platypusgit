// PGWorktreeRow's layout, pinned.
//
// The list is a dozen rows whose paths differ only in the last segment, so it
// only works if it is scannable: one fact per line, every line clipped instead
// of wrapped, and an action column that does not move. Both halves regressed at
// once before this — a lock reason wrapped to a second line inside its badge
// (giving every locked row a different height), and because Lock/Unlock are
// different lengths, the auto-sized buttons slid Open and Remove sideways on
// exactly those rows. jsdom cannot measure pixels, so these assert the
// mechanism: fixed equal grid tracks, and clip styles on every text line.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { PGWorktreeRow } from "./git-components";
import type { WorktreeInfo } from "@/lib/types";

const LONG_REASON =
  "claude session commit-flow-hardening (PID 19292 start Mon Aug 31 14:10:57 2026)";

function wt(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    name: "commit-flow-hardening",
    path: "/Users/jonas/dev/fun/platypusgit/.claude/worktrees/commit-flow-hardening",
    branch: "fix/commit-flow-hardening",
    headOid: "177ddb1c0ffee0ffee0ffee0ffee0ffee0ffee000",
    locked: false,
    lockReason: null,
    prunable: false,
    isCurrent: false,
    ...over,
  };
}

function renderRow(over: Partial<WorktreeInfo> = {}) {
  const { container } = render(<PGWorktreeRow worktree={wt(over)} />);
  const row = container.querySelector<HTMLElement>('[data-testid="worktree-row"]')!;
  const buttons = ["open", "lock", "remove"].map(
    (k) => container.querySelector<HTMLElement>(`[data-testid="worktree-${k}"]`)!,
  );
  return { container, row, buttons };
}

const clipped = (el: HTMLElement) => ({
  overflow: el.style.overflow,
  textOverflow: el.style.textOverflow,
  whiteSpace: el.style.whiteSpace,
  minWidth: el.style.minWidth,
});
const CLIPPED = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: "0",
};

describe("PGWorktreeRow layout", () => {
  it("puts the three actions in equal fixed-width slots", () => {
    const { buttons } = renderRow();
    const grid = buttons[0].parentElement!;
    // Same parent, so they cannot drift apart independently.
    for (const b of buttons) expect(b.parentElement).toBe(grid);
    expect(grid.style.display).toBe("grid");

    const tracks = grid.style.gridTemplateColumns.split(/\s+/).filter(Boolean);
    expect(tracks).toHaveLength(3);
    expect(new Set(tracks).size).toBe(1); // three IDENTICAL tracks
    // The column never gives ground to a long branch name or path.
    expect(grid.style.flexShrink).toBe("0");
    // Each button fills its slot and left-aligns inside it: centring would
    // re-centre the label when Lock becomes Unlock, jittering the icon column.
    for (const b of buttons) {
      expect(b.style.width).toBe("100%");
      expect(b.style.justifyContent).toBe("flex-start");
    }
  });

  it("keeps Lock and Unlock in the same slot", () => {
    const locked = renderRow({ locked: true });
    expect(locked.buttons[1].textContent).toContain("Unlock");
    const unlocked = renderRow();
    expect(unlocked.buttons[1].textContent).toContain("Lock");
    // Identical slot geometry in both states — the label length is the row's
    // business, not the column's.
    expect(locked.buttons[1].parentElement!.style.gridTemplateColumns).toBe(
      unlocked.buttons[1].parentElement!.style.gridTemplateColumns,
    );
  });

  it("pins the buttons to the top so a lock line cannot push them down", () => {
    const { row } = renderRow({ locked: true, lockReason: LONG_REASON });
    expect(row.style.alignItems).toBe("flex-start");
  });

  it("gives each fact its own line", () => {
    const { container } = renderRow({ locked: true, lockReason: LONG_REASON });
    const column = container.querySelector<HTMLElement>(
      '[data-testid="worktree-row"] > div',
    )!;
    expect(column.style.flexDirection).toBe("column");
    // name / branch+sha / path / lock — four separate lines.
    expect(column.children).toHaveLength(4);
  });

  it("clips the name, the path and the lock reason rather than wrapping", () => {
    const w = wt({ locked: true, lockReason: LONG_REASON });
    const { container } = render(<PGWorktreeRow worktree={w} />);
    for (const full of [w.name, w.path, w.lockReason!]) {
      const el = container.querySelector<HTMLElement>(`[title="${full}"]`);
      // A title, so the clipped text is still recoverable on hover.
      expect(el, `no titled element for ${full}`).not.toBeNull();
      expect(clipped(el!)).toEqual(CLIPPED);
    }
  });

  it("shows the lock reason beside a short badge, not inside one", () => {
    const w = wt({ locked: true, lockReason: LONG_REASON });
    const { container } = render(<PGWorktreeRow worktree={w} />);
    const reason = container.querySelector<HTMLElement>(`[title="${w.lockReason}"]`)!;
    // The badge is uppercase and fixed-height; a 79-character reason inside it
    // is what wrapped. It stays a one-word badge with the reason as text.
    const badge = reason.previousElementSibling as HTMLElement;
    expect(badge.textContent).toBe("locked");
    expect(badge.style.flexShrink).toBe("0");
  });

  it("still shows a lock with no reason", () => {
    const { container } = render(<PGWorktreeRow worktree={wt({ locked: true })} />);
    expect(container.textContent).toContain("locked");
  });
});
