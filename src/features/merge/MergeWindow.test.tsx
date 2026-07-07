import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MergeWindow, findNextConflict } from "./MergeWindow";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";
import type { ConflictSides, FileStatus } from "@/lib/types";

function conflictedStatus(paths: string[]): FileStatus[] {
  return paths.map((path) => ({
    path,
    index: { kind: "Conflicted" },
    worktree: { kind: "Conflicted" },
  })) as unknown as FileStatus[];
}

function setSearch(params: string) {
  window.history.replaceState(null, "", `/?${params}`);
}

function textSides(): ConflictSides {
  return {
    path: "conflict.txt",
    base: "base\n",
    ours: "ours change\n",
    theirs: "theirs change\n",
    binary: false,
  };
}

// CRLF fixture with a MULTI-LINE conflict: both sides rewrite base lines
// b,c differently → one region spanning 2 lines. Pre-fix, splitLines kept the
// \r so the region `to` overran CM's \r-stripped doc → accept() threw
// RangeError and Apply also silently converted CRLF→LF.
function crlfSides(): ConflictSides {
  return {
    path: "crlf.txt",
    base: "a\r\nb\r\nc\r\nd\r\n",
    ours: "a\r\nB1\r\nB2\r\nd\r\n",
    theirs: "a\r\nX1\r\nX2\r\nd\r\n",
    binary: false,
  };
}

function chord(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }),
  );
}

describe("findNextConflict", () => {
  it("picks the first conflicted path that is not the current file", () => {
    const st = conflictedStatus(["a.txt", "b.txt"]);
    expect(findNextConflict(st, "a.txt")).toBe("b.txt");
  });
  it("returns null when nothing conflicted remains", () => {
    expect(findNextConflict([], "a.txt")).toBeNull();
  });
});

describe("MergeWindow shell", () => {
  it("loads sides for the file from the query string", async () => {
    setSearch("window=merge&repoId=r1&path=conflict.txt");
    mockInvoke("get_status", () => conflictedStatus(["conflict.txt"]));
    mockInvoke("conflict_sides", () => ({
      path: "conflict.txt",
      base: "base\n",
      ours: "ours change\n",
      theirs: "theirs change\n",
      binary: false,
    }));
    render(<MergeWindow />);
    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("conflict.txt"),
    );
    expect(
      getInvokeCalls().some(
        (c) => c.cmd === "conflict_sides" && c.args.path === "conflict.txt",
      ),
    ).toBe(true);
  });

  it("shows the chooser for binary conflicts and resolves via accept_theirs", async () => {
    setSearch("window=merge&repoId=r1&path=blob.bin");
    mockInvoke("get_status", () => conflictedStatus(["blob.bin"]));
    mockInvoke("conflict_sides", () => ({
      path: "blob.bin", base: null, ours: null, theirs: null, binary: true,
    }));
    mockInvoke("accept_theirs", () => undefined);
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");
    await userEvent.click(screen.getByTestId("chooser-take-theirs"));
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "accept_theirs")).toBe(true),
    );
  });

  it("shows deleted-side chooser labels when ours is null", async () => {
    setSearch("window=merge&repoId=r1&path=gone.txt");
    mockInvoke("get_status", () => conflictedStatus(["gone.txt"]));
    mockInvoke("conflict_sides", () => ({
      path: "gone.txt", base: "b\n", ours: null, theirs: "t\n", binary: false,
    }));
    render(<MergeWindow />);
    await screen.findByTestId("merge-chooser");
    expect(screen.getByTestId("chooser-take-ours")).toHaveTextContent(/delete/i);
  });
});

describe("MergeWindow resolution flow", () => {
  async function setup(paths = ["conflict.txt"]) {
    setSearch("window=merge&repoId=r1&path=conflict.txt");
    mockInvoke("get_status", () => conflictedStatus(paths));
    mockInvoke("conflict_sides", () => textSides());
    mockInvoke("save_resolution", () => undefined);
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");
  }

  // Regression: a text conflict must start with Apply DISABLED. If the parent's
  // [model] reset effect clobbered regionStates to [] (running AFTER MergeBody's
  // mount push), the gate `[].every(...) === true` would wrongly ENABLE Apply.
  it("text conflict starts with Apply disabled until resolved", async () => {
    await setup();
    expect(screen.getByTestId("merge-apply")).toBeDisabled();
    expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent("0/1");
  });

  it("Mod+2 accepts theirs and enables Apply", async () => {
    await setup();
    expect(screen.getByTestId("merge-apply")).toBeDisabled();
    chord("2", { metaKey: true, code: "Digit2" });
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent("1/1"),
    );
    expect(screen.getByTestId("merge-apply")).toBeEnabled();
  });

  it("Apply saves resolution with trailing newline and closes on last file", async () => {
    await setup();
    chord("1", { metaKey: true, code: "Digit1" });
    await waitFor(() => expect(screen.getByTestId("merge-apply")).toBeEnabled());
    // Post-apply status: nothing conflicted anymore.
    mockInvoke("get_status", () => []);
    await userEvent.click(screen.getByTestId("merge-apply"));
    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "save_resolution");
      expect(call).toBeDefined();
      expect(call!.args.content).toBe("ours change\n");
    });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await waitFor(() =>
      expect(getCurrentWindow().close).toHaveBeenCalled(),
    );
  });

  it("auto-advances to the next conflicted file after Apply", async () => {
    await setup(["conflict.txt", "second.txt"]);
    chord("2", { metaKey: true, code: "Digit2" });
    await waitFor(() => expect(screen.getByTestId("merge-apply")).toBeEnabled());
    mockInvoke("get_status", () => conflictedStatus(["second.txt"]));
    mockInvoke("conflict_sides", () => ({ ...textSides(), path: "second.txt" }));
    await userEvent.click(screen.getByTestId("merge-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("merge-file-path")).toHaveTextContent("second.txt"),
    );
  });

  it("CRLF multi-line conflict: accept without throwing, Apply writes back \\r\\n", async () => {
    setSearch("window=merge&repoId=r1&path=crlf.txt");
    mockInvoke("get_status", () => conflictedStatus(["crlf.txt"]));
    mockInvoke("conflict_sides", () => crlfSides());
    mockInvoke("save_resolution", () => undefined);
    render(<MergeWindow />);
    await screen.findByTestId("merge-result");
    expect(screen.getByTestId("merge-apply")).toBeDisabled();
    // Accept ours on the multi-line region — pre-fix this threw a RangeError
    // (region `to` past the \r-stripped doc) so the counter never advanced.
    chord("1", { metaKey: true, code: "Digit1" });
    await waitFor(() =>
      expect(screen.getByTestId("merge-conflict-counter")).toHaveTextContent("1/1"),
    );
    expect(screen.getByTestId("merge-apply")).toBeEnabled();
    mockInvoke("get_status", () => []);
    await userEvent.click(screen.getByTestId("merge-apply"));
    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "save_resolution");
      expect(call).toBeDefined();
      // Original CRLF endings preserved end-to-end — no silent EOL conversion.
      expect(call!.args.content).toBe("a\r\nB1\r\nB2\r\nd\r\n");
    });
  });

  it("Escape with progress asks for confirmation", async () => {
    await setup();
    chord("1", { metaKey: true, code: "Digit1" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    chord("Escape");
    expect(confirmSpy).toHaveBeenCalled();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    expect(getCurrentWindow().close).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
