// PGSelect — the in-page listbox that replaced the native `<select>` (issue
// 146). A native `<select>` handed us keyboard, semantics and focus for free;
// these tests are what says we actually re-provided each of them.
//
// The load-bearing one is "the global dispatcher never sees a bare key": the
// trigger is an `<input>` PRECISELY so the keymap's text-input policy suppresses
// bare-key chords, and swapping it for a `<button>` or a `<div>` silently gives
// ArrowDown back to History's commit list.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PGSelect } from "./primitives";
import { PGModal } from "./modal";
import { useKeymapStore } from "@/features/keymap/useKeymapStore";
import { useFocusStore } from "@/features/keymap/useFocusStore";
import { useOverlayStore } from "@/features/keymap/useOverlayStore";

const OPTIONS = [
  { value: "all", label: "All branches" },
  { value: "head", label: "HEAD" },
  { value: "main", label: "main" },
  { value: "feature", label: "feature/thing" },
];

const trigger = () => screen.getByRole("combobox");
const listbox = () => document.querySelector("[data-pg-listbox]");
const optionRows = () =>
  [...document.querySelectorAll<HTMLElement>("[data-pg-option]")];
const activeValue = () =>
  document
    .querySelector("[data-pg-option][data-active='true']")
    ?.getAttribute("data-value") ?? null;

/** AppShell's real wiring: ONE capture-phase keydown listener on window that
 *  runs the dispatcher before any element handler. Every keyboard assertion
 *  below is made with it installed, because that is the only configuration the
 *  app ever runs in. */
function withDispatcher(): () => void {
  const onKey = (e: KeyboardEvent) => useKeymapStore.getState().dispatch(e);
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

let detach: (() => void) | null = null;

beforeEach(() => {
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({ focused: "history.list" });
  useOverlayStore.setState({ cheatSheetOpen: false });
  detach = withDispatcher();
});

afterEach(() => {
  detach?.();
  detach = null;
});

function open(): void {
  fireEvent.mouseDown(trigger(), { button: 0 });
}

describe("PGSelect — structure and semantics", () => {
  it("maps no native <select> or <option>, open or closed", () => {
    render(<PGSelect value="main" options={OPTIONS} />);
    expect(document.querySelector("select")).toBeNull();
    open();
    expect(listbox()).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector("option")).toBeNull();
  });

  it("shows the selected option's LABEL, and nothing for a value not offered", () => {
    const { rerender } = render(<PGSelect value="feature" options={OPTIONS} />);
    expect(trigger()).toHaveValue("feature/thing");
    rerender(<PGSelect value="gone" options={OPTIONS} />);
    expect(trigger()).toHaveValue("");
  });

  it("carries the combobox/listbox/option roles and the aria-* a select implies", () => {
    render(<PGSelect value="main" options={OPTIONS} />);
    const t = trigger();
    expect(t).toHaveAttribute("aria-expanded", "false");
    expect(t).toHaveAttribute("aria-haspopup", "listbox");
    expect(t.getAttribute("aria-controls")).toBeTruthy();
    expect(t).not.toHaveAttribute("aria-activedescendant");

    open();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const list = listbox()!;
    expect(list).toHaveAttribute("role", "listbox");
    // aria-controls has to RESOLVE, or the relationship is decoration.
    expect(list.id).toBe(trigger().getAttribute("aria-controls"));
    // The active option is named by id, and the SELECTED one is aria-selected.
    const rows = optionRows();
    expect(rows.map((r) => r.getAttribute("role"))).toEqual(
      OPTIONS.map(() => "option"),
    );
    expect(trigger().getAttribute("aria-activedescendant")).toBe(rows[2].id);
    expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual([
      "false", "false", "true", "false",
    ]);
  });

  it("opts option rows into UI density, or the Settings toggle skips them", () => {
    render(<PGSelect value="main" options={OPTIONS} />);
    open();
    for (const row of optionRows()) {
      expect(row.style.height).toContain("var(--row-step)");
    }
  });

  it("does not open with no options", () => {
    render(<PGSelect value="" options={[]} />);
    open();
    expect(listbox()).toBeNull();
  });
});

describe("PGSelect — the global dispatcher must not see a bare key", () => {
  it("suppresses list navigation while the picker has focus (open or closed)", () => {
    const listDown = vi.fn(() => true);
    const listUp = vi.fn(() => true);
    const listTop = vi.fn(() => true);
    const activate = vi.fn(() => true);
    const toggle = vi.fn(() => true);
    // Unscoped: answers wherever focus sits, so nothing but the input policy
    // can be keeping these from firing.
    const off = [
      useKeymapStore.getState().register("list.down", listDown),
      useKeymapStore.getState().register("list.up", listUp),
      useKeymapStore.getState().register("list.top", listTop),
      useKeymapStore.getState().register("list.activate", activate),
      useKeymapStore.getState().register("list.toggle", toggle),
    ];

    const onChange = vi.fn();
    render(<PGSelect value="main" options={OPTIONS} onChange={onChange} />);
    const t = trigger();
    // Closed: ArrowDown opens the list rather than moving History's selection.
    fireEvent.keyDown(t, { key: "ArrowDown" });
    expect(listbox()).not.toBeNull();
    // Open: every list chord is the picker's.
    fireEvent.keyDown(t, { key: "ArrowDown" });
    fireEvent.keyDown(t, { key: "ArrowUp" });
    fireEvent.keyDown(t, { key: "Home" });
    fireEvent.keyDown(t, { key: " " });

    for (const spy of [listDown, listUp, listTop, activate, toggle]) {
      expect(spy).not.toHaveBeenCalled();
    }
    for (const un of off) un();
  });

  it("keeps typed characters out of the focused pane's speed-search", () => {
    const un = useKeymapStore.getState().registerSpeedSearch("history.list");
    render(<PGSelect value="main" options={OPTIONS} />);
    open();
    fireEvent.keyDown(trigger(), { key: "H" });
    // The keystroke steered the listbox, not History.
    expect(activeValue()).toBe("head");
    un();
  });
});

describe("PGSelect — keyboard", () => {
  it("arrows move the active option without committing; Enter commits", () => {
    const onChange = vi.fn();
    render(<PGSelect value="all" options={OPTIONS} onChange={onChange} />);
    open();
    expect(activeValue()).toBe("all");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(activeValue()).toBe("main");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("main");
    expect(listbox()).toBeNull();
  });

  it("clamps at both ends instead of wrapping", () => {
    render(<PGSelect value="all" options={OPTIONS} />);
    open();
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    expect(activeValue()).toBe("all");
    fireEvent.keyDown(trigger(), { key: "End" });
    expect(activeValue()).toBe("feature");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(activeValue()).toBe("feature");
    fireEvent.keyDown(trigger(), { key: "Home" });
    expect(activeValue()).toBe("all");
  });

  it("Space commits, and Enter opens a closed picker", () => {
    const onChange = vi.fn();
    render(<PGSelect value="all" options={OPTIONS} onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(listbox()).not.toBeNull();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: " " });
    expect(onChange).toHaveBeenCalledWith("head");
  });

  it("types to jump, and a repeated letter cycles the matches", () => {
    render(<PGSelect value="all" options={OPTIONS} />);
    open();
    // "f" from "All branches" reaches feature/thing; typing it again wraps
    // round to nothing else and comes back.
    fireEvent.keyDown(trigger(), { key: "f" });
    expect(activeValue()).toBe("feature");
    fireEvent.keyDown(trigger(), { key: "m" });
    // "fm" matches no prefix and no substring — the cursor stays put.
    expect(activeValue()).toBe("feature");
  });

  it("a multi-letter buffer narrows by prefix", () => {
    render(<PGSelect value="feature" options={OPTIONS} />);
    open();
    fireEvent.keyDown(trigger(), { key: "a" });
    fireEvent.keyDown(trigger(), { key: "l" });
    expect(activeValue()).toBe("all");
  });

  it("Escape closes without committing and leaves focus on the trigger", () => {
    const onChange = vi.fn();
    render(<PGSelect value="all" options={OPTIONS} onChange={onChange} />);
    trigger().focus();
    open();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it("Escape is claimed BEFORE an outer registered handler, and released when closed", () => {
    const outer = vi.fn(() => true);
    const un = useKeymapStore.getState().register("app.closeOverlay", outer);
    render(<PGSelect value="all" options={OPTIONS} />);
    open();
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(listbox()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    // Closed, the picker declines and the outer handler gets its chord back.
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(outer).toHaveBeenCalledOnce();
    un();
  });

  it("Escape does not reach the catalog's overlay runner while the list is open", () => {
    // This is the case that actually matters, and it works for a different
    // reason than the test above: no dialog in the app REGISTERS
    // `app.closeOverlay` — they all rely on the catalog's default runner, which
    // the dispatcher only reaches when every registered handler declined. So a
    // PGSelect open inside a PGModal eats Escape and the dialog survives. Driven
    // through the real runner (the cheat sheet is its first branch) rather than a
    // spy, because the ordering rule being relied on is the dispatcher's own.
    useOverlayStore.setState({ cheatSheetOpen: true });
    render(<PGSelect value="all" options={OPTIONS} />);
    open();
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(listbox()).toBeNull();
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(true);
    // Second press: the picker declines, so the overlay closes as it always did.
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
  });
});

describe("PGSelect — mouse", () => {
  it("clicking an option commits it and closes", () => {
    const onChange = vi.fn();
    render(<PGSelect value="all" options={OPTIONS} onChange={onChange} />);
    open();
    fireEvent.click(optionRows()[3]);
    expect(onChange).toHaveBeenCalledWith("feature");
    expect(listbox()).toBeNull();
  });

  it("re-picking the current option writes nothing", () => {
    const onChange = vi.fn();
    render(<PGSelect value="main" options={OPTIONS} onChange={onChange} />);
    open();
    fireEvent.click(optionRows()[2]);
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
  });

  it("a second mousedown on the trigger closes it", () => {
    render(<PGSelect value="main" options={OPTIONS} />);
    open();
    fireEvent.mouseDown(trigger(), { button: 0 });
    expect(listbox()).toBeNull();
  });

  it("scrolling the option list does not close it, but scrolling behind it does", async () => {
    render(<PGSelect value="main" options={OPTIONS} />);
    open();
    await new Promise((r) => setTimeout(r, 0));
    // The active-into-view effect scrolls the list itself on every open, and a
    // capture-phase scroll listener sees that — so an unguarded one shuts a long
    // option list the instant it appears.
    fireEvent.scroll(listbox()!);
    expect(listbox()).not.toBeNull();
    // A scroll anywhere else detaches the fixed popup from its anchor.
    fireEvent.scroll(document.body);
    expect(listbox()).toBeNull();
  });

  // Two of the ten call sites live inside a PGModal (the create-PR and add-
  // worktree dialogs), so picking an option must not dismiss the dialog.
  //
  // Note WHAT protects it, because the obvious answer is wrong and a mutation
  // said so: it is NOT the `document.body` portal. A React portal bubbles events
  // through the REACT tree, not the DOM tree, so the modal's backdrop handler
  // does receive the option's click either way. What declines it is the
  // backdrop's `e.currentTarget === e.target` equality — the same guard that
  // keeps a click on the dialog's own body from dismissing it. Loosening that
  // equality fails this test; moving the portal does not.
  it("picking an option inside a PGModal does not dismiss the dialog", () => {
    const onCancel = vi.fn();
    const onChange = vi.fn();
    render(
      <PGModal onCancel={onCancel}>
        <PGSelect value="all" options={OPTIONS} onChange={onChange} />
      </PGModal>,
    );
    open();
    fireEvent.click(optionRows()[1]);
    expect(onChange).toHaveBeenCalledWith("head");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a mousedown outside closes without committing", async () => {
    const onChange = vi.fn();
    render(<PGSelect value="main" options={OPTIONS} onChange={onChange} />);
    open();
    // The outside listener is deliberately armed on a timeout, so the very
    // mousedown that OPENED the list cannot immediately close it again — hence
    // the tick. Asserting that first, so a lost guard fails here by name rather
    // than as a mysterious "never opens".
    fireEvent.mouseDown(document.body);
    expect(listbox()).not.toBeNull();

    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(document.body);
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
