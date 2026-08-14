// The resolver's conflicted-file sidebar (#108) — the list that replaced the
// deleted Conflicts screen. What matters: it shows the whole set, it can move
// between files, it keeps files it finished visible, and it does not throw away
// in-editor work when the user navigates.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MergeWindow } from "./MergeWindow";
import { mockInvoke, getInvokeCalls, resetInvokeMock } from "@/test/invokeMock";
import { dialogTitle, dismissDialog, resetDialogs } from "@/test/dialog";
import type { ConflictSides, FileStatus } from "@/lib/types";

function conflictedStatus(paths: string[]): FileStatus[] {
  return paths.map((path) => ({
    path,
    index: { kind: "Conflicted" },
    worktree: { kind: "Conflicted" },
  })) as unknown as FileStatus[];
}

function sidesFor(path: string): ConflictSides {
  return {
    path,
    base: "base\n",
    ours: "ours change\n",
    theirs: "theirs change\n",
    binary: false,
  };
}

function setSearch(params: string) {
  window.history.replaceState(null, "", `/?${params}`);
}

function chord(key: string, code: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true }),
  );
}

const rows = () => screen.queryAllByTestId("merge-file-row");
const row = (path: string) =>
  rows().find((r) => r.getAttribute("data-path") === path);

describe("resolver file list", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    mockInvoke("conflict_sides", (args) => sidesFor(String(args.path)));
    mockInvoke("save_resolution", () => undefined);
    mockInvoke("accept_ours", () => undefined);
  });

  it("lists every conflicted file and marks the open one", async () => {
    setSearch("window=merge&repoId=r1&path=beta.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(row("beta.txt")?.getAttribute("data-selected")).toBe("true");
    expect(row("alpha.txt")?.getAttribute("data-selected")).toBeNull();
  });

  it("picks the first conflicted file when opened without one", async () => {
    // How the operation bar, the status-bar count and ⌘5 open the window.
    setSearch("window=merge&repoId=r1");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);

    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("alpha.txt"),
    );
  });

  it("loads the sides of a file clicked in the list", async () => {
    setSearch("window=merge&repoId=r1&path=alpha.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.click(row("beta.txt")!);

    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("beta.txt"),
    );
    expect(
      getInvokeCalls().some(
        (c) => c.cmd === "conflict_sides" && c.args.path === "beta.txt",
      ),
    ).toBe(true);
  });

  it("keeps a file it finished listed, marked resolved", async () => {
    setSearch("window=merge&repoId=r1&path=alpha.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent(/^0\//),
    );

    chord("1", "Digit1"); // take ours for the open region
    await waitFor(() => expect(screen.getByTestId("merge-apply")).toBeEnabled());
    // Disk truth after the apply: only beta is still conflicted.
    mockInvoke("get_status", () => conflictedStatus(["beta.txt"]));
    await userEvent.click(screen.getByTestId("merge-apply"));

    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("beta.txt"),
    );
    // Still two rows: the list is the session's work, not just what is left.
    expect(rows()).toHaveLength(2);
    expect(row("alpha.txt")?.getAttribute("data-resolved")).toBe("true");
    expect(row("beta.txt")?.getAttribute("data-resolved")).toBeNull();
  });

  it("confirms before leaving a file with unapplied progress", async () => {
    setSearch("window=merge&repoId=r1&path=alpha.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent(/^0\//),
    );

    chord("1", "Digit1"); // unapplied side pick
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent("1/1"),
    );

    await userEvent.click(row("beta.txt")!);
    await waitFor(() => expect(dialogTitle()).toMatch(/discard/i));
    await dismissDialog();
    // Dismissed → still on the file the user was resolving.
    expect(screen.getByTestId("merge-file-path")).toHaveTextContent("alpha.txt");
  });

  // The sidebar menu cannot reuse `conflictMenuItems`: this window's store has
  // no open repo, so those store actions would silently no-op. It must reach
  // IPC directly — this test is what would catch a regression to the store.
  it("resolves a file from its row menu, via IPC", async () => {
    setSearch("window=merge&repoId=r1&path=alpha.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.contextMenu(row("beta.txt")!);
    const menu = await waitFor(() => {
      const m = document.querySelector("[data-pg-menu]");
      if (!m) throw new Error("no context menu");
      return m as HTMLElement;
    });
    // Only beta is conflicted after the accept.
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt"]));
    fireEvent.click(within(menu).getByText("Accept ours"));

    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "accept_ours");
      expect(call?.args.path).toBe("beta.txt");
    });
    // Still listed, now resolved — and the open file did not change.
    await waitFor(() =>
      expect(row("beta.txt")?.getAttribute("data-resolved")).toBe("true"),
    );
    expect(screen.getByTestId("merge-file-path")).toHaveTextContent("alpha.txt");
  });

  it("switches without a prompt when nothing has been touched", async () => {
    setSearch("window=merge&repoId=r1&path=alpha.txt");
    mockInvoke("get_status", () => conflictedStatus(["alpha.txt", "beta.txt"]));
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");

    await userEvent.click(row("beta.txt")!);

    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("beta.txt"),
    );
    expect(dialogTitle()).toBeNull();
  });
});
