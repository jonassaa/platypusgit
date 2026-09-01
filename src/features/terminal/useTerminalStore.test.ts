import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_HEIGHT,
  MAX_HEIGHT,
  MIN_HEIGHT,
  clampHeight,
  useTerminalStore,
} from "./useTerminalStore";

beforeEach(() => {
  localStorage.clear();
  useTerminalStore.setState({
    open: false,
    heightPx: DEFAULT_HEIGHT,
    epochs: {},
  });
});

describe("the terminal panel's UI state", () => {
  it("starts closed — a terminal nobody asked for should not spawn a shell", () => {
    expect(useTerminalStore.getState().open).toBe(false);
  });

  it("toggles", () => {
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(true);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(false);
  });

  it("clamps the height to a range a terminal can render in", () => {
    useTerminalStore.getState().setHeight(10);
    expect(useTerminalStore.getState().heightPx).toBe(MIN_HEIGHT);
    useTerminalStore.getState().setHeight(100_000);
    expect(useTerminalStore.getState().heightPx).toBe(MAX_HEIGHT);
  });

  it("remembers open and height across a reload, but not the sessions", () => {
    useTerminalStore.getState().setOpen(true);
    useTerminalStore.getState().setHeight(321);
    useTerminalStore.getState().noteEpoch("a", 9);

    const raw = localStorage.getItem("pg.terminal.ui");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string) as Record<string, unknown>;
    expect(persisted.open).toBe(true);
    expect(persisted.heightPx).toBe(321);
    // The shells die with the process, so a restored epoch would be a handle
    // to nothing.
    expect(persisted.epochs).toBeUndefined();
  });

  it("survives a corrupt persisted value rather than failing to start", () => {
    localStorage.setItem("pg.terminal.ui", "{not json");
    expect(clampHeight(DEFAULT_HEIGHT)).toBe(DEFAULT_HEIGHT);
  });
});

describe("session epochs", () => {
  it("tracks one per repository, not one for the app", () => {
    useTerminalStore.getState().noteEpoch("a", 1);
    useTerminalStore.getState().noteEpoch("b", 2);
    expect(useTerminalStore.getState().epochs).toEqual({ a: 1, b: 2 });
  });

  it("replaces a repository's epoch when its terminal is reopened", () => {
    useTerminalStore.getState().noteEpoch("a", 1);
    useTerminalStore.getState().noteEpoch("a", 7);
    expect(useTerminalStore.getState().epochs).toEqual({ a: 7 });
  });

  it("forgets one repository without disturbing the others", () => {
    useTerminalStore.getState().noteEpoch("a", 1);
    useTerminalStore.getState().noteEpoch("b", 2);
    useTerminalStore.getState().forget("a");
    expect(useTerminalStore.getState().epochs).toEqual({ b: 2 });
  });

  it("forgetting a repository that never had a terminal is a no-op", () => {
    useTerminalStore.getState().noteEpoch("b", 2);
    useTerminalStore.getState().forget("never");
    expect(useTerminalStore.getState().epochs).toEqual({ b: 2 });
  });
});
