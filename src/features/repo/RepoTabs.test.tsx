// The strip (#90): one row per open repository, the active one marked, and the
// close verbs — single close silent, bulk close confirmed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { WithDialogs, acceptDialog, dialogTitle, resetDialogs } from "@/test/dialog";
import { RepoTabs } from "./RepoTabs";
import { newTab, type RepoTab } from "./tabs";
import { useTabsStore } from "./useTabsStore";

// Partial: the keymap catalog imports the other ops from this module, and a
// full replacement would break its module init.
vi.mock("./ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ops")>()),
  openRepoDialog: vi.fn().mockResolvedValue(undefined),
}));
import { openRepoDialog } from "./ops";

function seed(tabs: RepoTab[], activePath: string | null) {
  useTabsStore.setState({
    tabs,
    activePath,
    // Stub the async actions: this file is about the strip, not the switch.
    activate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    closeOthers: vi.fn().mockResolvedValue(undefined),
    closeAll: vi.fn().mockResolvedValue(undefined),
    refreshBadges: vi.fn().mockResolvedValue(undefined),
  } as never);
}

const open = (path: string, over: Partial<RepoTab> = {}) =>
  newTab(path, { status: "open", repoId: path, ...over });

beforeEach(() => {
  resetDialogs();
  vi.mocked(openRepoDialog).mockClear();
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    activationSeq: 0,
    activating: null,
  });
});

function rows() {
  return Array.from(document.querySelectorAll('[data-testid="repo-tab"]'));
}

describe("RepoTabs", () => {
  it("renders nothing without an open repository", () => {
    render(<RepoTabs />);
    expect(screen.queryByTestId("repo-tab-strip")).toBeNull();
  });

  it("renders one row per tab and marks the active one", () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/web");
    render(<RepoTabs />);
    expect(rows().map((r) => r.getAttribute("data-path"))).toEqual([
      "/dev/api",
      "/dev/web",
    ]);
    expect(rows().map((r) => r.getAttribute("data-active"))).toEqual([
      "false",
      "true",
    ]);
    expect(screen.getByText("api")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
  });

  it("disambiguates colliding repository names by parent directory", () => {
    seed([open("/work/acme/api"), open("/work/beta/api")], "/work/acme/api");
    render(<RepoTabs />);
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("beta/api")).toBeTruthy();
  });

  it("shows the dirty count, and the conflict count in its place", () => {
    seed(
      [open("/dev/api", { dirty: 3 }), open("/dev/web", { dirty: 2, conflicts: 1 })],
      "/dev/api",
    );
    render(<RepoTabs />);
    expect(screen.getByText("●3")).toBeTruthy();
    // A conflict outranks the dirty dot — it is the thing that needs attention.
    expect(screen.getByText("✕1")).toBeTruthy();
    expect(screen.queryByText("●2")).toBeNull();
  });

  it("clicking a tab activates it", () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/web");
    render(<RepoTabs />);
    fireEvent.click(rows()[0]);
    expect(useTabsStore.getState().activate).toHaveBeenCalledWith("/dev/api");
  });

  it("the close button closes that tab without confirming", () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/web");
    render(<WithDialogs><RepoTabs /></WithDialogs>);
    fireEvent.click(
      document.querySelector('[data-testid="repo-tab-close"][data-path="/dev/api"]') as Element,
    );
    // Closing a tab closes a VIEW — nothing on disk is lost, so a prompt there
    // would misrepresent the stakes.
    expect(dialogTitle()).toBeNull();
    expect(useTabsStore.getState().close).toHaveBeenCalledWith("/dev/api");
  });

  it("the + button opens the folder picker", () => {
    seed([open("/dev/api")], "/dev/api");
    render(<RepoTabs />);
    fireEvent.click(screen.getByTestId("repo-tab-new"));
    expect(openRepoDialog).toHaveBeenCalled();
  });

  it("close others confirms first, then closes", async () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/api");
    render(<WithDialogs><RepoTabs /></WithDialogs>);
    fireEvent.contextMenu(rows()[1]);
    await act(async () => {
      fireEvent.click(screen.getByText("Close others"));
    });
    expect(dialogTitle()).toBe("Close 1 other repository?");
    await acceptDialog();
    expect(useTabsStore.getState().closeOthers).toHaveBeenCalledWith("/dev/web");
  });

  it("close all confirms and can be declined", async () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/api");
    render(<WithDialogs><RepoTabs /></WithDialogs>);
    fireEvent.contextMenu(rows()[0]);
    await act(async () => {
      fireEvent.click(screen.getByText("Close all"));
    });
    expect(dialogTitle()).toBe("Close all 2 repositories?");
    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-cancel"));
    });
    expect(useTabsStore.getState().closeAll).not.toHaveBeenCalled();
  });

  it("refreshes background badges when the window regains focus", () => {
    seed([open("/dev/api"), open("/dev/web")], "/dev/api");
    render(<RepoTabs />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(useTabsStore.getState().refreshBadges).toHaveBeenCalled();
  });

  it("dims a tab whose repository could not be opened", () => {
    seed([open("/dev/api"), newTab("/dev/gone", { status: "failed" })], "/dev/api");
    render(<RepoTabs />);
    expect(rows()[1].getAttribute("data-path")).toBe("/dev/gone");
    expect(Number(getComputedStyle(rows()[1] as Element).opacity)).toBeLessThan(1);
  });
});
