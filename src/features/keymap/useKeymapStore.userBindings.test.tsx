// Chords that are DATA rather than catalog entries (#225) — a user-defined
// action's shortcut — and the recording mode the Settings field runs on.
//
// The property these tests exist for: a setting can never take a key away from
// the app. Settings refuses such a chord up front; this is the half that holds
// even for a hand-edited file.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { useNavStore } from "@/features/nav/useNavStore";
import { useTabsStore } from "@/features/repo/useTabsStore";

import { useFocusStore } from "./useFocusStore";
import { useKeymapStore, type UserBinding } from "./useKeymapStore";

const key = (
  over: Partial<KeyboardEvent>,
  target: EventTarget = document.body,
) =>
  ({
    key: "x",
    code: "KeyX",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
    target,
    ...over,
  }) as unknown as KeyboardEvent;

const bind = (chord: string, run: UserBinding["run"], title = "Deploy") =>
  useKeymapStore.getState().setUserBindings(new Map([[chord, { title, run }]]));

beforeEach(() => {
  useKeymapStore.setState({
    handlers: new Map(),
    lastShiftAt: 0,
    userBindings: new Map(),
    capture: null,
  });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  useNavStore.setState({ intent: null });
  useTabsStore.setState({ tabs: [], activePath: null });
});

describe("a user-defined shortcut", () => {
  it("fires for its chord", () => {
    const run = vi.fn();
    bind("Mod+Shift+X", run);
    expect(useKeymapStore.getState().dispatch(key({}))).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("prevents the default, so the webview never sees the key", () => {
    const preventDefault = vi.fn();
    bind("Mod+Shift+X", () => true);
    useKeymapStore.getState().dispatch(key({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("fires with the caret in a text field", () => {
    // No input rule of its own is needed: a bindable user chord always carries
    // ⌘/Ctrl or is a function key, so it cannot type a character — the same
    // reasoning the catalog's modifier chords already run on.
    const input = document.createElement("input");
    document.body.appendChild(input);
    const run = vi.fn();
    bind("Mod+Shift+X", run);
    useKeymapStore.getState().dispatch(key({}, input));
    expect(run).toHaveBeenCalledOnce();
    input.remove();
  });

  it("declines when its runner does, leaving the key to the browser", () => {
    bind("Mod+Shift+X", () => false);
    expect(useKeymapStore.getState().dispatch(key({}))).toBe(false);
  });

  it("never fires inside the built-in terminal — the shell owns those keys", () => {
    const term = document.createElement("div");
    term.setAttribute("data-testid", "terminal-view");
    const child = document.createElement("textarea");
    term.appendChild(child);
    document.body.appendChild(term);
    const run = vi.fn();
    bind("Mod+Shift+X", run);
    expect(useKeymapStore.getState().dispatch(key({}, child))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    term.remove();
  });
});

describe("a user-defined shortcut never shadows a built-in", () => {
  it("loses the chord to the catalog action bound to it", () => {
    const run = vi.fn();
    bind("Mod+K", run);
    // ⌘K is Go to Commit in the rider preset.
    const handled = useKeymapStore
      .getState()
      .dispatch(key({ key: "k", code: "KeyK", shiftKey: false }));
    expect(handled).toBe(true);
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "commit",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("gets the chord only once every built-in on it has declined", () => {
    // ⌘Tab is tab.next, which declines with fewer than two tabs open. The user
    // binding is offered after that refusal, not before it.
    const run = vi.fn();
    bind("Mod+Tab", run);
    const handled = useKeymapStore
      .getState()
      .dispatch(key({ key: "Tab", code: "Tab", shiftKey: false }));
    expect(handled).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("recording a shortcut", () => {
  it("takes every chord instead of running it", () => {
    const seen: string[] = [];
    const run = vi.fn();
    bind("Mod+Shift+X", run);
    useKeymapStore.getState().beginCapture((c) => seen.push(c));

    // A chord that IS bound, and one that could never be: recording sees both,
    // which is what lets the field refuse a bare key by name.
    useKeymapStore.getState().dispatch(key({}));
    useKeymapStore.getState().dispatch(
      key({ key: "g", code: "KeyG", metaKey: false, shiftKey: false }),
    );

    expect(seen).toEqual(["Mod+Shift+X", "G"]);
    expect(run).not.toHaveBeenCalled();
    expect(useNavStore.getState().intent).toBe(null);
  });

  it("stops the event as well as preventing it", () => {
    // The dispatcher listens on `window` in the CAPTURE phase and is registered
    // first, so stopping here is the only thing that keeps the recorded key out
    // of the field's own input and every handler beneath it.
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    useKeymapStore.getState().beginCapture(() => {});
    useKeymapStore.getState().dispatch(key({ stopPropagation, preventDefault }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("ignores a lone modifier — it is not a chord", () => {
    const seen: string[] = [];
    useKeymapStore.getState().beginCapture((c) => seen.push(c));
    useKeymapStore.getState().dispatch(key({ key: "Shift", code: "ShiftLeft" }));
    expect(seen).toEqual([]);
  });

  it("hands the keyboard back when it stops", () => {
    const stop = useKeymapStore.getState().beginCapture(() => {});
    stop();
    expect(useKeymapStore.getState().capture).toBe(null);
    const run = vi.fn();
    bind("Mod+Shift+X", run);
    useKeymapStore.getState().dispatch(key({}));
    expect(run).toHaveBeenCalledOnce();
  });

  it("a stale stopper cannot cancel the recording that replaced it", () => {
    // Otherwise a field unmounting late would leave the app eating every key.
    const stopFirst = useKeymapStore.getState().beginCapture(() => {});
    const second = vi.fn();
    useKeymapStore.getState().beginCapture(second);
    stopFirst();
    useKeymapStore.getState().dispatch(key({}));
    expect(second).toHaveBeenCalledWith("Mod+Shift+X");
  });
});
