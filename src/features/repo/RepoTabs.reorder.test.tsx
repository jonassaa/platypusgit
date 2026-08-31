// Dragging a repository tab to a new position (#238) — the horizontal half of
// `useRowReorder`. Modelled on `Rebase.reorder.test.tsx`: jsdom has no layout,
// so every tab's box is stubbed, and no `PointerEvent`, so a `MouseEvent` typed
// as one carries the coordinates React's `onPointerDown` needs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { resetDialogs } from "@/test/dialog";
import { RepoTabs } from "./RepoTabs";
import { newTab } from "./tabs";
import { useTabsStore } from "./useTabsStore";

vi.mock("./ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ops")>()),
  openRepoDialog: vi.fn().mockResolvedValue(undefined),
}));

const TAB_W = 120;

const open = (path: string) => newTab(path, { status: "open", repoId: path });

function seed(paths: string[], activePath = paths[0]) {
  useTabsStore.setState({
    tabs: paths.map(open),
    activePath,
    activate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    refreshBadges: vi.fn().mockResolvedValue(undefined),
  } as never);
}

const order = () =>
  Array.from(document.querySelectorAll('[data-testid="repo-tab"]')).map((r) =>
    r.getAttribute("data-path"),
  );

/** Give every tab a real box along X so the drag can resolve an index. */
function stubGeometry(): HTMLElement[] {
  const tabs = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="repo-tab"]'),
  );
  tabs.forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({
        left: i * TAB_W,
        right: i * TAB_W + TAB_W,
        width: TAB_W,
        top: 0,
        bottom: 28,
        height: 28,
        x: i * TAB_W,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });
  return tabs;
}

function pointer(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
}

/**
 * Press at tab `index`'s own centre and drag by `dx`.
 *
 * The hook resolves an index by strict midpoint crossing, so a drag of exactly
 * one tab width lands ON the neighbour's midpoint and does NOT move — every
 * distance here clears it.
 */
function grabAndDrop(tabs: HTMLElement[], index: number, dx: number): void {
  const from = index * TAB_W + TAB_W / 2;
  fireEvent(tabs[index], pointer("pointerdown", from));
  fireEvent(window, pointer("pointermove", from + dx));
  fireEvent(window, pointer("pointerup", from + dx));
}

beforeEach(() => {
  resetDialogs();
  localStorage.clear();
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
});

describe("repository tab reordering (#238)", () => {
  it("drags a tab past its neighbour and commits the new order", async () => {
    seed(["/dev/api", "/dev/web", "/dev/cli"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();

    // Past the second tab's midpoint, which sits 1.0 tab widths away.
    grabAndDrop(tabs, 0, 1.5 * TAB_W);

    // The commit lands after the settle animation, not on pointerup.
    await waitFor(() =>
      expect(order()).toEqual(["/dev/web", "/dev/api", "/dev/cli"]),
    );
  });

  it("drags a tab leftwards", async () => {
    seed(["/dev/api", "/dev/web", "/dev/cli"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();

    grabAndDrop(tabs, 2, -2.5 * TAB_W);

    await waitFor(() =>
      expect(order()).toEqual(["/dev/cli", "/dev/api", "/dev/web"]),
    );
  });

  it("leaves the order alone when the drag never clears a midpoint", () => {
    seed(["/dev/api", "/dev/web"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();

    grabAndDrop(tabs, 0, 20);

    expect(order()).toEqual(["/dev/api", "/dev/web"]);
  });

  it("does not start a drag from the close button", () => {
    seed(["/dev/api", "/dev/web"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();
    const close = tabs[0].querySelector('[data-testid="repo-tab-close"]')!;

    fireEvent(close, pointer("pointerdown", TAB_W / 2));
    fireEvent(window, pointer("pointermove", TAB_W / 2 + TAB_W));
    fireEvent(window, pointer("pointerup", TAB_W / 2 + TAB_W));

    // The close `×` is a <button>, which the hook's control opt-out excludes —
    // otherwise closing a tab would be a one-pixel-slip away from moving it.
    expect(order()).toEqual(["/dev/api", "/dev/web"]);
  });

  it("persists the order it committed", async () => {
    seed(["/dev/api", "/dev/web"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();

    grabAndDrop(tabs, 0, 1.5 * TAB_W);

    await waitFor(() => expect(order()).toEqual(["/dev/web", "/dev/api"]));
    const raw = JSON.parse(localStorage.getItem("pg-open-repos") ?? "null") as {
      paths: string[];
    } | null;
    expect(raw?.paths).toEqual(["/dev/web", "/dev/api"]);
  });

  it("does not reorder a strip with a single tab", () => {
    seed(["/dev/api"]);
    render(<RepoTabs />);
    const tabs = stubGeometry();

    grabAndDrop(tabs, 0, 1.5 * TAB_W);

    expect(order()).toEqual(["/dev/api"]);
  });
});

describe("the tab context menu's move verbs (#238)", () => {
  const tabPaths = () => useTabsStore.getState().tabs.map((t) => t.path);
  const tabAt = (i: number) =>
    document.querySelectorAll('[data-testid="repo-tab"]')[i];

  it("moves a tab right from the menu", async () => {
    seed(["/dev/api", "/dev/web"]);
    render(<RepoTabs />);
    fireEvent.contextMenu(tabAt(0));
    await act(async () => {
      fireEvent.click(screen.getByText("Move right"));
    });
    expect(tabPaths()).toEqual(["/dev/web", "/dev/api"]);
  });

  it("moves a tab left from the menu", async () => {
    seed(["/dev/api", "/dev/web"]);
    render(<RepoTabs />);
    fireEvent.contextMenu(tabAt(1));
    await act(async () => {
      fireEvent.click(screen.getByText("Move left"));
    });
    expect(tabPaths()).toEqual(["/dev/web", "/dev/api"]);
  });

  it("keeps both verbs on a single tab, inert", () => {
    seed(["/dev/api"]);
    render(<RepoTabs />);
    fireEvent.contextMenu(tabAt(0));
    // Shown disabled rather than hidden, so the menu keeps a stable shape.
    expect(screen.getByText("Move left")).toBeTruthy();
    expect(screen.getByText("Move right")).toBeTruthy();
    expect(tabPaths()).toEqual(["/dev/api"]);
  });
});
