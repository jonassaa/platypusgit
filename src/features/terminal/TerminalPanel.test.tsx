// The docked terminal panel (#243).
//
// TerminalView is mocked here: it owns an xterm instance and a session, and
// what this file is about is the MOUNTING decisions — when a view exists at
// all, and which one is visible. Those carry the feature's least obvious rule:
// a view is hidden, never unmounted, because unmounting disposes xterm and
// takes the scrollback with it. The shell would survive and the user would
// still reopen the panel to a blank pane.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Counts MOUNTS per repo, so "was it unmounted and rebuilt?" is directly
// observable — which is the whole property this file exists to pin. Recorded
// from an effect with empty deps, not from the component body: a body re-runs
// on every render and would count those too.
const mounts: string[] = [];

vi.mock("./TerminalView", async () => {
  const React = await import("react");
  return {
    TerminalView: ({
      repoId,
      hidden,
    }: {
      repoId: string;
      hidden?: boolean;
    }) => {
      React.useEffect(() => {
        mounts.push(repoId);
      }, [repoId]);
      return (
        <div
          data-testid="terminal-view"
          data-repo-id={repoId}
          data-hidden={hidden ? "true" : "false"}
        >
          {repoId}
        </div>
      );
    },
  };
});

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { TerminalPanel } from "./TerminalPanel";
import { DEFAULT_HEIGHT, useTerminalStore } from "./useTerminalStore";

const repo = (id: string) => ({ id, path: `/tmp/${id}`, head: "main" });

const views = () =>
  screen.queryAllByTestId("terminal-view").map((el) => ({
    id: el.getAttribute("data-repo-id"),
    hidden: el.getAttribute("data-hidden") === "true",
  }));

beforeEach(() => {
  localStorage.clear();
  mounts.length = 0;
  useTerminalStore.setState({
    open: false,
    heightPx: DEFAULT_HEIGHT,
    epochs: {},
  });
  useSettingsStore.getState().reset();
  useRepoStore.setState({ current: repo("r1") } as never);
});

describe("when nothing has been opened", () => {
  it("renders nothing, and spawns no shell", () => {
    const { container } = render(<TerminalPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(mounts).toEqual([]);
  });

  it("renders nothing with no repository open — there is nowhere to cd to", () => {
    useRepoStore.setState({ current: null } as never);
    useTerminalStore.setState({ open: true });
    const { container } = render(<TerminalPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(mounts).toEqual([]);
  });
});

describe("when the panel is open", () => {
  beforeEach(() => {
    useTerminalStore.setState({ open: true });
  });

  it("mounts a visible view for the active repository", () => {
    render(<TerminalPanel />);
    expect(views()).toEqual([{ id: "r1", hidden: false }]);
  });

  it("takes its height from the store", () => {
    useTerminalStore.setState({ heightPx: 321 });
    render(<TerminalPanel />);
    expect(screen.getByTestId("terminal-panel")).toHaveStyle({
      height: "321px",
    });
  });

  it("names the shell, so a slow rc file reads as the shell starting", () => {
    render(<TerminalPanel />);
    expect(screen.getByTestId("terminal-shell-label")).toHaveTextContent(
      "default shell",
    );
  });
});

describe("keeping the scrollback", () => {
  it("hides rather than unmounts when the panel is collapsed", () => {
    useTerminalStore.setState({ open: true, epochs: { r1: 1 } });
    const { rerender } = render(<TerminalPanel />);
    expect(mounts).toEqual(["r1"]);

    useTerminalStore.setState({ open: false });
    rerender(<TerminalPanel />);

    // Still there — disposing it would take the scrollback with it.
    expect(screen.getByTestId("terminal-view")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel")).not.toBeVisible();
    // And it was never re-created, which is what proves it was not unmounted.
    expect(mounts).toEqual(["r1"]);
  });

  it("keeps an inactive tab's terminal mounted but hidden", () => {
    useTerminalStore.setState({ open: true, epochs: { r1: 1 } });
    const { rerender } = render(<TerminalPanel />);

    useRepoStore.setState({ current: repo("r2") } as never);
    rerender(<TerminalPanel />);

    // r1's shell is still alive, so its view stays — hidden. r2 gets its own.
    expect(views()).toEqual([
      { id: "r1", hidden: true },
      { id: "r2", hidden: false },
    ]);
  });

  it("returns to the same instance when the user switches back", () => {
    useTerminalStore.setState({ open: true, epochs: { r1: 1 } });
    const { rerender } = render(<TerminalPanel />);

    useRepoStore.setState({ current: repo("r2") } as never);
    useTerminalStore.setState({ epochs: { r1: 1, r2: 2 } });
    rerender(<TerminalPanel />);

    useRepoStore.setState({ current: repo("r1") } as never);
    rerender(<TerminalPanel />);

    expect(views()).toEqual([
      { id: "r1", hidden: false },
      { id: "r2", hidden: true },
    ]);
    // Each was created exactly once across the whole round trip.
    expect(mounts).toEqual(["r1", "r2"]);
  });

  it("drops a repository's view once its session is forgotten", () => {
    useTerminalStore.setState({ open: true, epochs: { r1: 1, r2: 2 } });
    useRepoStore.setState({ current: repo("r1") } as never);
    const { rerender } = render(<TerminalPanel />);
    expect(views()).toHaveLength(2);

    // What `useTabsStore.evict` does when a repository tab closes.
    useTerminalStore.getState().forget("r2");
    rerender(<TerminalPanel />);

    expect(views()).toEqual([{ id: "r1", hidden: false }]);
  });
});

describe("hiding the panel", () => {
  it("does not kill the session", () => {
    useTerminalStore.setState({ open: true, epochs: { r1: 1 } });
    render(<TerminalPanel />);
    screen.getByTitle("Hide terminal").click();
    expect(useTerminalStore.getState().open).toBe(false);
    // The epochs map is what tracks live sessions; hiding must not touch it.
    expect(useTerminalStore.getState().epochs).toEqual({ r1: 1 });
  });
});
