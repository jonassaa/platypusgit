// The window's own lifecycle (#256): what comes back at launch, and what is
// forgotten when the user closes one window rather than quitting.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { emitMockEvent } from "@/test/eventMock";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  loadWindowRecords,
  openReposKey,
  saveWindowRecords,
  WINDOW_CLOSED_EVENT,
} from "./windowKind";
import { __resetWindowClaims, openAppWindow } from "./openAppWindow";
import { __resetWindowRestore, useWindowLifecycle } from "./useWindowLifecycle";

function Harness() {
  useWindowLifecycle();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  __resetWindowRestore();
  __resetWindowClaims();
  mockInvoke("next_window_label", () => "pg-9");
});

/** The shared `WebviewWindow` mock is a class; wrap it so a test can see the
 *  labels a restore asked for without changing the shared mock's shape. */
vi.mock("@tauri-apps/api/webviewWindow", async () => {
  class FakeWebviewWindow {
    static getByLabel = vi.fn().mockResolvedValue(null);
    static made: string[] = [];
    static instances: FakeWebviewWindow[] = [];
    label: string;
    constructor(label: string) {
      this.label = label;
      FakeWebviewWindow.made.push(label);
      FakeWebviewWindow.instances.push(this);
    }
    once = vi.fn().mockResolvedValue(() => {});
    setPosition = vi.fn().mockResolvedValue(undefined);
    setSize = vi.fn().mockResolvedValue(undefined);
    setFocus = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { WebviewWindow: FakeWebviewWindow };
});

const made = () => (WebviewWindow as unknown as { made: string[] }).made;
const instances = () =>
  (WebviewWindow as unknown as { instances: Record<string, ReturnType<typeof vi.fn>>[] })
    .instances;

beforeEach(() => {
  made().length = 0;
  instances().length = 0;
});

describe("restoring the other windows at launch", () => {
  it("recreates every persisted sibling, at the label it had", async () => {
    saveWindowRecords([
      { label: "pg-1", bounds: { x: 10, y: 20, width: 900, height: 700 } },
      { label: "pg-2", bounds: null },
    ]);
    render(<Harness />);
    await waitFor(() => expect(made()).toEqual(["pg-1", "pg-2"]));
    // A restore reuses the label, so it must NOT ask for a new one — a fresh
    // label would strand the window's persisted repositories under the old key.
    expect(getInvokeCalls().filter((c) => c.cmd === "next_window_label")).toEqual([]);
  });

  it("restores nothing when the last quit left one window", async () => {
    render(<Harness />);
    await waitFor(() => expect(made()).toEqual([]));
  });

  it("runs once per process, not once per mount", async () => {
    saveWindowRecords([{ label: "pg-1", bounds: null }]);
    const first = render(<Harness />);
    await waitFor(() => expect(made()).toEqual(["pg-1"]));
    first.unmount();
    render(<Harness />);
    // A remount (React StrictMode, a hot reload) must not open a second copy
    // of every window.
    await waitFor(() => expect(made()).toEqual(["pg-1"]));
  });
});

describe("forgetting a window the user closed", () => {
  it("drops the record and the session when the backend says one closed", async () => {
    saveWindowRecords([{ label: "pg-1", bounds: null }, { label: "pg-2", bounds: null }]);
    localStorage.setItem(
      openReposKey("pg-2"),
      JSON.stringify({ paths: ["/dev/web"], active: "/dev/web" }),
    );
    render(<Harness />);
    await waitFor(() => expect(made()).toHaveLength(2));

    emitMockEvent(WINDOW_CLOSED_EVENT, "pg-2");

    expect(loadWindowRecords().map((r) => r.label)).toEqual(["pg-1"]);
    expect(localStorage.getItem(openReposKey("pg-2"))).toBeNull();
  });

  it("ignores a payload that is not a label", async () => {
    saveWindowRecords([{ label: "pg-1", bounds: null }]);
    render(<Harness />);
    await waitFor(() => expect(made()).toHaveLength(1));

    emitMockEvent(WINDOW_CLOSED_EVENT, { label: "pg-1" });
    emitMockEvent(WINDOW_CLOSED_EVENT, null);

    expect(loadWindowRecords().map((r) => r.label)).toEqual(["pg-1"]);
  });
});

describe("naming a window", () => {
  it("does not hand the same label to two clicks in the same tick", async () => {
    // `next_window_label` answers from the windows Tauri knows about, and a
    // window is not in that list the instant its constructor returns. Two fast
    // clicks both got `pg-1`: the second failed on the duplicate label, having
    // already overwritten the first window's seed on the way there.
    mockInvoke("next_window_label", () => "pg-1");
    const labels = await Promise.all([
      openAppWindow({ seedPaths: ["/dev/api"] }),
      openAppWindow({ seedPaths: ["/dev/web"] }),
    ]);
    expect(labels).toEqual(["pg-1", "pg-2"]);
    expect(made()).toEqual(["pg-1", "pg-2"]);
    // Each window kept its own seed.
    expect(
      JSON.parse(localStorage.getItem(openReposKey("pg-1")) as string).paths,
    ).toEqual(["/dev/api"]);
    expect(
      JSON.parse(localStorage.getItem(openReposKey("pg-2")) as string).paths,
    ).toEqual(["/dev/web"]);
  });

  it("frees a label again once its window is closed", async () => {
    mockInvoke("next_window_label", () => "pg-1");
    await openAppWindow({ seedPaths: ["/dev/api"] });
    render(<Harness />);

    emitMockEvent(WINDOW_CLOSED_EVENT, "pg-1");

    // A long session that opens and closes windows keeps reusing pg-1 rather
    // than climbing.
    expect(await openAppWindow({ seedPaths: ["/dev/web"] })).toBe("pg-1");
  });

  it("claims a restored window's label, so a click cannot take it", async () => {
    saveWindowRecords([{ label: "pg-1", bounds: null }]);
    render(<Harness />);
    await waitFor(() => expect(made()).toEqual(["pg-1"]));

    mockInvoke("next_window_label", () => "pg-1");
    expect(await openAppWindow({ seedPaths: ["/dev/api"] })).toBe("pg-2");
  });
});

describe("where a restored window comes back", () => {
  it("places it in PHYSICAL pixels, not through the logical creation options", async () => {
    // `WebviewWindowOptions`' x/y/width/height are LOGICAL units and the
    // remembered bounds are physical, so passing them straight through is wrong
    // by the scale factor — on a 2x display the window returns at twice its
    // size, on the wrong part of the wrong monitor. Invisible on a 1x screen,
    // which is exactly why it is pinned here.
    saveWindowRecords([
      { label: "pg-1", bounds: { x: 1440, y: 300, width: 1800, height: 1200 } },
    ]);
    render(<Harness />);
    await waitFor(() => expect(made()).toEqual(["pg-1"]));

    const win = instances()[0];
    await waitFor(() => expect(win.setPosition).toHaveBeenCalled());
    const pos = win.setPosition.mock.calls[0][0] as { x: number; y: number; type: string };
    const size = win.setSize.mock.calls[0][0] as {
      width: number;
      height: number;
      type: string;
    };
    expect(pos).toMatchObject({ x: 1440, y: 300 });
    expect(size).toMatchObject({ width: 1800, height: 1200 });
    // The unit is the whole point of the assertion.
    expect(pos.type).toBe("Physical");
    expect(size.type).toBe("Physical");
  });

  it("lets the OS place a window with no remembered bounds", async () => {
    saveWindowRecords([{ label: "pg-1", bounds: null }]);
    render(<Harness />);
    await waitFor(() => expect(made()).toEqual(["pg-1"]));
    expect(instances()[0].setPosition).not.toHaveBeenCalled();
  });
});
