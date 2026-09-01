// How the terminal joins the rest of the app (#243).
//
// Two rules that live in files the terminal does not own, so they are tested
// here where the reason for them is written down:
//
//   1. Keys typed in the terminal belong to the SHELL. xterm renders a hidden
//      textarea, so the keymap's `isEditable` already drops bare chords — but
//      not modifier chords, which is exactly the set a shell needs (Ctrl+C,
//      Ctrl+D, Ctrl+R). Without an explicit guard, Ctrl+C opens whatever the
//      app has bound instead of interrupting the foreground process.
//   2. The shell belongs to the TAB. Closing a repository must end its shell,
//      or an interactive process outlives every trace of it in the UI.
import { beforeEach, describe, expect, it } from "vitest";

import { ACTIONS, type ActionId } from "@/features/keymap/actions";
import { useKeymapStore } from "@/features/keymap/useKeymapStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useTerminalStore } from "./useTerminalStore";

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  useTerminalStore.setState({ open: false, heightPx: 240, epochs: {} });
});

/** A key event whose target is inside the terminal host. */
function keyInTerminal(init: KeyboardEventInit) {
  const host = document.createElement("div");
  host.setAttribute("data-testid", "terminal-view");
  const textarea = document.createElement("textarea");
  host.appendChild(textarea);
  document.body.appendChild(host);
  const e = new KeyboardEvent("keydown", { ...init, bubbles: true });
  Object.defineProperty(e, "target", { value: textarea });
  return e;
}

/** The same event from an ordinary, non-terminal target. */
function keyOutside(init: KeyboardEventInit) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const e = new KeyboardEvent("keydown", { ...init, bubbles: true });
  Object.defineProperty(e, "target", { value: div });
  return e;
}

describe("the shell owns the keyboard inside the terminal", () => {
  it("does not let Ctrl+C reach an app action", () => {
    const dispatch = useKeymapStore.getState().dispatch;
    const handled = dispatch(
      keyInTerminal({ key: "c", ctrlKey: true }) as unknown as KeyboardEvent,
    );
    expect(handled).toBe(false);
  });

  it("does not let the command palette chord through either", () => {
    const dispatch = useKeymapStore.getState().dispatch;
    // Sanity: the chord IS bound, so a false below means the guard fired and
    // not that nothing was listening.
    const outside = dispatch(
      keyOutside({ key: "k", metaKey: true }) as unknown as KeyboardEvent,
    );
    expect(outside).toBe(true);

    const inside = dispatch(
      keyInTerminal({ key: "k", metaKey: true }) as unknown as KeyboardEvent,
    );
    expect(inside).toBe(false);
  });

  it("still honours the toggle — that is the way back out", () => {
    useTerminalStore.setState({ open: true });
    const dispatch = useKeymapStore.getState().dispatch;
    const handled = dispatch(
      keyInTerminal({ key: "`", ctrlKey: true }) as unknown as KeyboardEvent,
    );
    expect(handled).toBe(true);
    expect(useTerminalStore.getState().open).toBe(false);
  });
});

describe("the toggle action", () => {
  it("is in the catalog, so the palette and cheat sheet can find it", () => {
    const id: ActionId = "terminal.toggle";
    expect(ACTIONS[id]).toBeTruthy();
    expect(ACTIONS[id].title).toMatch(/terminal/i);
  });

  it("flips the panel", () => {
    ACTIONS["terminal.toggle"].run?.("Ctrl+`");
    expect(useTerminalStore.getState().open).toBe(true);
    ACTIONS["terminal.toggle"].run?.("Ctrl+`");
    expect(useTerminalStore.getState().open).toBe(false);
  });
});

describe("the shell belongs to the tab", () => {
  it("closes the session when the repository tab is evicted", async () => {
    mockInvoke("close_repo", () => null);
    mockInvoke("term_close", () => null);
    mockInvoke("get_status", () => []);

    const { useTabsStore } = await import("@/features/repo/useTabsStore");
    useTerminalStore.getState().noteEpoch("r1", 4);
    useTabsStore.setState({
      tabs: [{ path: "/tmp/r1", repoId: "r1", status: "open" }] as never,
      activePath: "/tmp/r1",
    });

    await useTabsStore.getState().close("/tmp/r1");

    expect(
      getInvokeCalls().some(
        (c) => c.cmd === "term_close" && c.args?.repoId === "r1",
      ),
    ).toBe(true);
    // And the frontend forgets the handle, so a reopened tab does not filter
    // its new session's events against a dead epoch.
    expect(useTerminalStore.getState().epochs.r1).toBeUndefined();
  });
});
