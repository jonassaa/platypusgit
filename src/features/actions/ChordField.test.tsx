// Recording a custom action's shortcut (#225).
//
// The dispatcher's half — which chord wins, and that recording eats every key —
// is tested in `useKeymapStore.userBindings.test.tsx`. What only this field can
// get wrong is the answer it gives back: a chord it should have refused, a
// refusal with no reason on screen, or a shortcut stored on an action that can
// never run it.

import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useKeymapStore } from "@/features/keymap/useKeymapStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

import { CustomActionsSettings } from "./CustomActionsSettings";
import { CHORD_IS_ALTGR, CHORD_NEEDS_ACCELERATOR } from "./customActions";

const stored = () => useSettingsStore.getState().customActions;

/** Press a key at the recorder — the dispatcher's job in the real app. */
const press = (chord: string) =>
  act(() => {
    useKeymapStore.getState().capture?.(chord);
  });

const note = () => screen.getByTestId("custom-action-chord-note").textContent;

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
  useKeymapStore.setState({ capture: null });
});

async function startNewAction(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("custom-action-add"));
  await user.type(screen.getByTestId("custom-action-name-input"), "Deploy");
  await user.type(screen.getByTestId("custom-action-command-input"), "deploy $REPO");
}

describe("recording a shortcut", () => {
  it("stores the chord it recorded, and saves it with the action", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);

    await user.click(screen.getByTestId("custom-action-chord-record"));
    expect(useKeymapStore.getState().capture).toBeTypeOf("function");
    press("Mod+Shift+X");
    await user.click(screen.getByTestId("custom-action-save"));

    expect(stored()[0].chord).toBe("Mod+Shift+X");
  });

  it("hands the keyboard back once it has a chord", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Mod+Shift+X");
    expect(useKeymapStore.getState().capture).toBe(null);
  });

  it("cancels on Escape without changing the shortcut", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Escape");

    expect(useKeymapStore.getState().capture).toBe(null);
    expect(screen.getByTestId("custom-action-chord-value")).toHaveTextContent(
      "None",
    );
  });

  it("stops when the button is pressed again", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    await user.click(screen.getByTestId("custom-action-chord-record"));
    expect(useKeymapStore.getState().capture).toBe(null);
  });

  it("stops when the field goes away, never leaving a dead capture", async () => {
    // A capture nobody stops eats every key in the app — so the recorder is
    // torn down by the effect's own cleanup, not by any exit path remembering.
    const user = userEvent.setup();
    const view = render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    view.unmount();
    expect(useKeymapStore.getState().capture).toBe(null);
  });
});

describe("what the field refuses", () => {
  it("a bare key, saying what a shortcut needs, and keeps recording", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("G");

    expect(note()).toBe(CHORD_NEEDS_ACCELERATOR);
    // Still listening: the next press is almost certainly the correction.
    expect(useKeymapStore.getState().capture).toBeTypeOf("function");
    press("Mod+Shift+X");
    expect(screen.getByTestId("custom-action-chord-value")).toHaveTextContent(
      /X/,
    );
  });

  it("Mod+Alt+<letter>, because that is AltGr on Windows", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Mod+Alt+E");
    expect(note()).toBe(CHORD_IS_ALTGR);
  });

  it("a chord the app already uses, naming the action that owns it", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Mod+K");

    // A built-in always wins the key, so the refusal has to happen HERE — a
    // chord accepted now would simply never fire.
    expect(note()).toContain("Go to Commit");
    expect(stored()).toEqual([]);
  });

  it("a chord another custom action already fires, naming it", async () => {
    useSettingsStore.getState().set("customActions", [
      {
        id: "a1",
        name: "Sync",
        command: "sync",
        showOutput: false,
        refreshAfter: false,
        surfaces: ["repo"],
        chord: "Mod+Shift+X",
      },
    ]);
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Mod+Shift+X");

    expect(note()).toContain("Sync");
  });
});

describe("a shortcut needs the palette", () => {
  it("is unavailable while the action is off the palette, and says why", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-surface-repo"));

    expect(screen.getByTestId("custom-action-chord-record")).toBeDisabled();
    expect(note()).toContain("command palette");
  });

  it("keeps a recorded chord through a trip off the palette", async () => {
    // Unticking must not silently discard what the user recorded.
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-chord-record"));
    press("Mod+Shift+X");
    await user.click(screen.getByTestId("custom-action-surface-repo"));
    await user.click(screen.getByTestId("custom-action-surface-repo"));

    expect(screen.getByTestId("custom-action-chord-value")).toHaveTextContent(
      /X/,
    );
  });
});

describe("the saved row", () => {
  it("shows a shortcut that fires", async () => {
    useSettingsStore.getState().set("customActions", [
      {
        id: "a1",
        name: "Deploy",
        command: "deploy",
        showOutput: false,
        refreshAfter: false,
        surfaces: ["repo"],
        chord: "Mod+Shift+X",
      },
    ]);
    render(<CustomActionsSettings />);
    expect(screen.getByTestId("custom-action-row-chord")).toBeInTheDocument();
  });

  it("shows nothing for a shortcut that cannot fire", async () => {
    // A row advertising a dead shortcut is the surprise to avoid most.
    useSettingsStore.getState().set("customActions", [
      {
        id: "a1",
        name: "Deploy",
        command: "deploy",
        showOutput: false,
        refreshAfter: false,
        surfaces: ["file"],
        chord: "Mod+Shift+X",
      },
    ]);
    render(<CustomActionsSettings />);
    expect(screen.queryByTestId("custom-action-row-chord")).toBeNull();
  });
});
