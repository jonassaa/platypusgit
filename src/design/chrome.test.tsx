import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const platformMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform", () => ({
  usePlatform: platformMock,
  __esModule: true,
}));

import {
  PGSidebarGroup,
  PGSidebarRow,
  PGTabStrip,
  PGTitlebar,
  type PGTabItem,
} from "./chrome";

beforeEach(() => {
  platformMock.mockReset();
});

describe("PGTitlebar", () => {
  it("renders the 80px shim on macOS and no window controls", () => {
    platformMock.mockReturnValue("macos");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("renders window controls on Windows and no shim", () => {
    platformMock.mockReturnValue("windows");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders window controls on Linux and no shim", () => {
    platformMock.mockReturnValue("linux");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
  });

  it("treats undefined platform as mac to avoid control-flash", () => {
    platformMock.mockReturnValue(undefined);
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("carries data-tauri-drag-region on root", () => {
    platformMock.mockReturnValue("macos");
    const { container } = render(<PGTitlebar repoName="demo" branch="main" />);
    const root = container.querySelector("[data-tauri-drag-region]");
    expect(root).not.toBeNull();
  });
});

// ── PGTabStrip: the `+` placement (issue 178) ──────────────────────────────

/** jsdom implements no scrollIntoView, so the effect's optional call is a
 *  no-op there. Install one that records its receiver — WHICH element the
 *  strip scrolls to is the whole of decision 3. */
function trackScrollIntoView(): { calls: Element[]; restore: () => void } {
  const proto = Element.prototype as unknown as {
    scrollIntoView?: (arg?: unknown) => void;
  };
  const prev = proto.scrollIntoView;
  const calls: Element[] = [];
  proto.scrollIntoView = function (this: Element) {
    calls.push(this);
  };
  return {
    calls,
    restore: () => {
      if (prev) proto.scrollIntoView = prev;
      else delete proto.scrollIntoView;
    },
  };
}

function stripTabs(activeIndex: number): PGTabItem[] {
  return ["/repos/alpha", "/repos/beta", "/repos/gamma"].map((id, i) => ({
    id,
    label: id.split("/").pop() as string,
    active: i === activeIndex,
  }));
}

describe("PGTabStrip", () => {
  let tracked: { calls: Element[]; restore: () => void } | null = null;

  afterEach(() => {
    tracked?.restore();
    tracked = null;
  });

  it("puts the + immediately after the last tab, in the same scroller", () => {
    const { container } = render(<PGTabStrip tabs={stripTabs(0)} />);
    const plus = screen.getByTestId("repo-tab-new");
    const rows = Array.from(container.querySelectorAll('[data-testid="repo-tab"]'));
    const last = rows[rows.length - 1];

    expect(last.nextElementSibling).toBe(plus);
    // Same parent as the tabs = inside the overflow-x scroller, so it travels
    // with them instead of pinning to the strip's right edge (issue 178).
    expect(plus.parentElement).toBe(last.parentElement);
  });

  it("draws no left border — the tab's own right border is the divider", () => {
    render(<PGTabStrip tabs={stripTabs(0)} />);
    const style = screen.getByTestId("repo-tab-new").getAttribute("style") ?? "";
    expect(style).not.toContain("border-left");
  });

  it("reveals the + when the LAST tab is active, not just that tab", () => {
    tracked = trackScrollIntoView();
    render(<PGTabStrip tabs={stripTabs(2)} />);
    // Scrolling the last tab into view stops at its right edge and clips the
    // button that follows it; the button is the scroller's final child, so
    // aiming at it scrolls to the end and shows both.
    expect(tracked.calls).toEqual([screen.getByTestId("repo-tab-new")]);
  });

  it("still scrolls the active tab into view when it is not the last", () => {
    tracked = trackScrollIntoView();
    const { container } = render(<PGTabStrip tabs={stripTabs(1)} />);
    const rows = Array.from(container.querySelectorAll('[data-testid="repo-tab"]'));
    expect(tracked.calls).toEqual([rows[1]]);
  });
});

describe("PGSidebarGroup controlled open", () => {
  it("stays uncontrolled when `open` is omitted", () => {
    render(<PGSidebarGroup title="G"><div>child</div></PGSidebarGroup>);
    expect(screen.getByText("child")).toBeTruthy();
    fireEvent.click(screen.getByText("G"));
    expect(screen.queryByText("child")).toBeNull();
  });

  it("obeys `open` and reports clicks when controlled", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <PGSidebarGroup title="G" open={false} onOpenChange={onOpenChange}>
        <div>child</div>
      </PGSidebarGroup>,
    );
    expect(screen.queryByText("child")).toBeNull();
    fireEvent.click(screen.getByText("G"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled: the click alone must not open it.
    expect(screen.queryByText("child")).toBeNull();
    rerender(
      <PGSidebarGroup title="G" open onOpenChange={onOpenChange}>
        <div>child</div>
      </PGSidebarGroup>,
    );
    expect(screen.getByText("child")).toBeTruthy();
  });
});

describe("PGSidebarRow a11y passthrough", () => {
  it("forwards role, tabIndex, aria-selected, keydown, dimmed and testId", () => {
    const onKeyDown = vi.fn();
    render(
      <PGSidebarRow
        label="Diff"
        role="treeitem"
        tabIndex={0}
        ariaSelected
        onKeyDown={onKeyDown}
        dimmed
        testId="settings-nav-git.diff"
      />,
    );
    const row = screen.getByRole("treeitem");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalled();
    expect(row.style.opacity).toBe("0.45");
    expect(screen.getByTestId("settings-nav-git.diff")).toBe(row);
  });
});
