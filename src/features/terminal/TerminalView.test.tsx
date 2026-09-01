// The terminal view (#243).
//
// xterm itself is mocked: it needs a real layout engine and this is jsdom, and
// what is worth testing here is not "does xterm render" (that is the e2e spec's
// one job) but the WIRING — which is where the bugs are. Specifically the three
// things a careless refactor breaks silently: that output is base64-decoded
// rather than written as text, that another session's events are dropped, and
// that unmounting does not leak a listener.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const onDataHandlers: Array<(s: string) => void> = [];
const written: Array<Uint8Array | string> = [];
const disposed = vi.fn();
const resized = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    onData(cb: (s: string) => void) {
      onDataHandlers.push(cb);
      return { dispose: vi.fn() };
    }
    write(d: Uint8Array | string) {
      written.push(d);
    }
    resize(c: number, r: number) {
      resized(c, r);
      this.cols = c;
      this.rows = r;
    }
    focus() {}
    dispose() {
      disposed();
    }
  },
}));

// The css import has no loader in the vitest env.
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { emitMockEvent } from "@/test/eventMock";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { TerminalView } from "./TerminalView";
import { useTerminalStore } from "./useTerminalStore";

/** Decode what the view handed xterm, so assertions read as text. */
const writtenText = () =>
  written
    .map((w) =>
      typeof w === "string" ? w : new TextDecoder().decode(w),
    )
    .join("");

const b64 = (s: string) => btoa(s);

beforeEach(() => {
  onDataHandlers.length = 0;
  written.length = 0;
  vi.clearAllMocks();
  resetInvokeMock();
  localStorage.clear();
  useTerminalStore.setState({ epochs: {} });
  mockInvoke("term_open", () => 7);
  mockInvoke("term_write", () => null);
  mockInvoke("term_resize", () => null);
  mockInvoke("term_close", () => null);
});

describe("TerminalView", () => {
  it("opens a session for its own repository", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );
  });

  it("forwards what the user types to the pty", async () => {
    const calls: unknown[] = [];
    mockInvoke("term_write", (args) => {
      calls.push(args);
      return null;
    });
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));

    onDataHandlers[0]("ls\r");

    await waitFor(() =>
      expect(calls).toContainEqual({ repoId: "repo-a", data: "ls\r" }),
    );
  });

  it("sends keystrokes in order even when the IPC calls resolve out of order", async () => {
    // The regression this exists for: one un-awaited `term_write` per
    // keystroke lets the invokes race, and the pty receives whatever order
    // they land in. Typing `echo ZZMARKER` into the real app reached the shell
    // as `ecoZARhR ZMKE`.
    const order: string[] = [];
    // A holder rather than a bare `let`: TypeScript cannot see the assignment
    // inside the promise callback and narrows a `let … = null` to `never` at
    // the call site below.
    const gate: { release?: () => void } = {};
    mockInvoke("term_write", (args) => {
      const data = (args as { data: string }).data;
      order.push(data);
      // Make the FIRST call the slowest, so an unordered implementation
      // finishes the later ones first and records them out of order.
      if (data === "a") {
        return new Promise<null>((res) => {
          gate.release = () => res(null);
        });
      }
      return null;
    });

    render(<TerminalView repoId="repo-a" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));

    onDataHandlers[0]("a");
    onDataHandlers[0]("b");
    onDataHandlers[0]("c");

    // Only the first has been issued; the rest are queued behind it.
    await waitFor(() => expect(order).toEqual(["a"]));
    gate.release?.();

    await waitFor(() => expect(order).toEqual(["a", "b", "c"]));
  });

  it("decodes output from base64 instead of writing the payload as text", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    emitMockEvent("term://data", {
      repoId: "repo-a",
      epoch: 7,
      data: b64("hello"),
    });

    await waitFor(() => expect(writtenText()).toContain("hello"));
    // The literal base64 must never reach the screen.
    expect(writtenText()).not.toContain(b64("hello"));
  });

  it("keeps a multi-byte character intact across the wire", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    // The whole reason the payload is bytes and not a string: an é that a
    // String payload would have had a chance to turn into U+FFFD.
    const bytes = new TextEncoder().encode("café");
    const payload = btoa(String.fromCharCode(...bytes));
    emitMockEvent("term://data", {
      repoId: "repo-a",
      epoch: 7,
      data: payload,
    });

    await waitFor(() => expect(writtenText()).toContain("café"));
    expect(writtenText()).not.toContain("�");
  });

  it("does not lose output emitted before term_open returns", async () => {
    // The regression this exists for: `term_open` spawns the shell AND its
    // reader thread before it returns, so the prompt is on the wire while a
    // listener attached afterwards does not exist yet. Tauri buffers nothing,
    // so the terminal opened blank and stayed blank — the bug was invisible in
    // every test that emitted after the open resolved.
    mockInvoke("term_open", () => {
      // Emit from inside the command, i.e. before the caller has the epoch.
      emitMockEvent("term://data", {
        repoId: "repo-a",
        epoch: 7,
        data: b64("$ prompt-from-the-shell"),
      });
      return 7;
    });

    render(<TerminalView repoId="repo-a" />);

    await waitFor(() =>
      expect(writtenText()).toContain("prompt-from-the-shell"),
    );
  });

  it("drops pre-open output belonging to a different session", async () => {
    // The buffer must not become a hole in the epoch fence.
    mockInvoke("term_open", () => {
      emitMockEvent("term://data", {
        repoId: "repo-a",
        epoch: 6,
        data: b64("older-session"),
      });
      emitMockEvent("term://data", {
        repoId: "repo-a",
        epoch: 7,
        data: b64("this-session"),
      });
      return 7;
    });

    render(<TerminalView repoId="repo-a" />);

    await waitFor(() => expect(writtenText()).toContain("this-session"));
    expect(writtenText()).not.toContain("older-session");
  });

  it("ignores another repository's output", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    emitMockEvent("term://data", {
      repoId: "repo-b",
      epoch: 7,
      data: b64("not mine"),
    });

    expect(writtenText()).not.toContain("not mine");
  });

  it("ignores a dead session's tail", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    // A reader still mid-read when the terminal was closed and reopened.
    emitMockEvent("term://data", {
      repoId: "repo-a",
      epoch: 6,
      data: b64("ghost of the old shell"),
    });

    expect(writtenText()).not.toContain("ghost");
  });

  it("says so when the shell exits, and does not respawn it", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    emitMockEvent("term://exit", { repoId: "repo-a", epoch: 7, code: 3 });

    await waitFor(() => expect(writtenText()).toContain("shell exited with 3"));

    // Nothing further is accepted on that epoch — the session is over.
    written.length = 0;
    emitMockEvent("term://data", {
      repoId: "repo-a",
      epoch: 7,
      data: b64("zombie output"),
    });
    expect(writtenText()).not.toContain("zombie");
  });

  it("shows the reason when no shell could be started", async () => {
    mockInvoke("term_open", () => {
      throw { kind: "TerminalUnavailable", message: "/bin/nope: not found" };
    });
    render(<TerminalView repoId="repo-a" />);

    const banner = await screen.findByTestId("terminal-error");
    // The remedy, not just the failure — the field that fixes it is named.
    expect(banner.textContent).toMatch(/Settings/);
    expect(banner.textContent).toMatch(/nope/);
  });

  it("tears its listeners down on unmount", async () => {
    const { unmount } = render(<TerminalView repoId="repo-a" />);
    await waitFor(() =>
      expect(useTerminalStore.getState().epochs["repo-a"]).toBe(7),
    );

    unmount();
    expect(disposed).toHaveBeenCalled();

    written.length = 0;
    emitMockEvent("term://data", {
      repoId: "repo-a",
      epoch: 7,
      data: b64("after unmount"),
    });
    expect(writtenText()).toBe("");
  });
});
