// PGColorSwatch — the wheel-and-sliders popover that replaced the native
// `<input type="color">` in the theme editor.
//
// A native colour input handed us a picker for free; these tests are what says
// we actually re-provided it, and they lean on the same two house rules
// `primitives.select.test.tsx` documents: every keyboard assertion runs with
// the REAL capture-phase dispatcher installed, because that is the only
// configuration the app ships in, and Escape must be claimed while the popover
// is open and RELEASED while it is closed — otherwise a picker inside the theme
// editor either cannot be dismissed or takes the dialog down with it.
//
// Pixels are not asserted here and never should be: the wheel's arithmetic is
// pinned in `colorWheel.test.ts`, where real numbers exist. jsdom measures every
// rendered box as 0, so what a component test can prove is wiring — which
// control is connected to which channel, and what reaches `onChange`.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PGColorSwatch, PGSlider } from "./color-picker";
import { PGModal } from "./modal";
import { useFocusStore } from "@/features/keymap/useFocusStore";
import { useKeymapStore } from "@/features/keymap/useKeymapStore";
import { useOverlayStore } from "@/features/keymap/useOverlayStore";
import { colorModel } from "@/lib/color";

const ACCENT = "#5aa8e8";

const trigger = () => screen.getByRole("button", { name: /accent/i });
const popover = () => document.querySelector("[data-pg-colorpicker]");
const hexField = () => screen.getByLabelText("Hex");
const slider = (name: RegExp | string) => screen.getByRole("slider", { name });

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

/** Render with a caller that keeps the value, the way every real one does. */
function renderLive(props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = React.useState(ACCENT);
    return (
      <PGColorSwatch
        label="Accent"
        value={value}
        onChange={(v: string) => {
          setValue(v);
          onChange(v);
        }}
        {...props}
      />
    );
  }
  const utils = render(<Host />);
  return { ...utils, onChange };
}

function open(): void {
  fireEvent.click(trigger());
}

describe("PGColorSwatch — the trigger", () => {
  it("is a button that names the field it edits", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    expect(trigger()).toBeTruthy();
    expect(popover()).toBeNull();
  });

  it("says the current colour in text, not only in paint", () => {
    // A swatch alone is unreachable to a screen reader and unverifiable to a
    // test, since jsdom renders no colour.
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    expect(trigger().getAttribute("aria-label")).toMatch(/#5aa8e8/i);
  });

  it("opens the popover on click and closes it on a second click", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    expect(popover()).toBeTruthy();
    fireEvent.click(trigger());
    expect(popover()).toBeNull();
  });

  it("renders no native colour input — the whole point of the exercise", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    expect(document.querySelector('input[type="color"]')).toBeNull();
  });
});

describe("PGColorSwatch — the hex field", () => {
  it("commits a typed hex on Enter", () => {
    const { onChange } = renderLive();
    open();
    fireEvent.change(hexField(), { target: { value: "#ff8800" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#ff8800");
  });

  it("accepts the shorthand and the missing hash, and canonicalizes both", () => {
    const { onChange } = renderLive();
    open();
    fireEvent.change(hexField(), { target: { value: "F80" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#ff8800");
  });

  it("leaves the colour alone when the text is not one", () => {
    const { onChange } = renderLive();
    open();
    fireEvent.change(hexField(), { target: { value: "rebeccapurple" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PGColorSwatch — the sliders", () => {
  it("shows the wheel's own axes by default, so the controls agree", () => {
    // The tall slider and the numeric row are the same axis. Defaulting the row
    // to HSL instead would put two different lightness controls side by side,
    // each moving the other.
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    expect(slider(/hsv hue/i)).toBeTruthy();
    expect(slider(/hsv saturation/i)).toBeTruthy();
    expect(slider(/hsv value/i)).toBeTruthy();
    expect(slider(/brightness/i)).toBeTruthy();
  });

  it("gives the two lightness controls distinguishable names", () => {
    // The tall slider IS the HSV model's V. Two role=slider nodes both named
    // "Value" would be one control announced twice, with no way to tell a
    // screen reader user which is which.
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    const names = screen
      .getAllByRole("slider")
      .map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("moves the colour by one step on an arrow key", () => {
    const { onChange } = renderLive();
    open();
    const before = colorModel("hsv").read(ACCENT);
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalled();
    const after = colorModel("hsv").read(onChange.mock.lastCall![0]);
    expect(after[0]).toBeGreaterThan(before[0]);
  });

  it("moves ten steps with Shift held", () => {
    // Asserted on the slider's own reported value, not on the hue read back
    // out of the hex: a theme colour is eight bits per channel, so the STORED
    // colour necessarily lands on the nearest representable hue (0.14° away
    // here). That quantization is the reason the channel values have to be
    // held rather than re-derived, and re-deriving them to check would be
    // measuring the very thing being avoided.
    renderLive();
    open();
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    const one = Number(slider(/hsv hue/i).getAttribute("aria-valuenow"));
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight", shiftKey: true });
    const eleven = Number(slider(/hsv hue/i).getAttribute("aria-valuenow"));
    expect(eleven - one).toBe(10);
  });

  it("jumps to the ends with Home and End", () => {
    const { onChange } = renderLive();
    open();
    fireEvent.keyDown(slider(/hsv saturation/i), { key: "Home" });
    expect(colorModel("hsv").read(onChange.mock.lastCall![0])[1]).toBe(0);
    fireEvent.keyDown(slider(/hsv saturation/i), { key: "End" });
    expect(colorModel("hsv").read(onChange.mock.lastCall![0])[1]).toBeCloseTo(1, 3);
  });

  it("keeps the hue after saturation goes to zero", () => {
    // The failure this pins: a grey has no hue to report, so a naive read
    // resets the angle to 0 and the wheel cursor teleports to red — taking the
    // colour the user was tuning with it, since there is no way back.
    renderLive();
    open();
    fireEvent.keyDown(slider(/hsv saturation/i), { key: "Home" });
    expect(slider(/hsv hue/i).getAttribute("aria-valuenow")).toBe("207");
  });

  it("does not drift the channel across repeated steps", () => {
    // Re-reading the channel values from the hex on every render made each
    // step inherit the last one's rounding, so the error ACCUMULATED: ten
    // presses of a one-degree step landed 1.4° past where they should, and the
    // readout crept away from the number it had just shown. Ten steps from 207
    // must read 217, not 218.
    renderLive();
    open();
    const start = Number(slider(/hsv hue/i).getAttribute("aria-valuenow"));
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    }
    expect(Number(slider(/hsv hue/i).getAttribute("aria-valuenow"))).toBe(start + 10);
  });

  it("reports its range and position for a screen reader", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    const hue = slider(/hsv hue/i);
    expect(hue.getAttribute("aria-valuemin")).toBe("0");
    expect(hue.getAttribute("aria-valuemax")).toBe("360");
    // The rounded number the readout shows beside it, not the raw 207.042…
    expect(hue.getAttribute("aria-valuenow")).toBe("207");
    expect(hue.getAttribute("aria-valuetext")).toBe("207°");
  });
});

describe("PGColorSwatch — the model selector", () => {
  it("swaps the channel set without changing the colour", () => {
    const { onChange } = renderLive();
    open();
    fireEvent.click(screen.getByRole("button", { name: /oklch/i }));
    expect(slider(/lightness/i)).toBeTruthy();
    expect(slider(/chroma/i)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ends the chroma track where sRGB does", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /oklch/i }));
    const chroma = slider(/chroma/i);
    // Not the model's nominal 0.4: the reachable ceiling for this L and H.
    const max = Number(chroma.getAttribute("aria-valuemax"));
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(0.4);
  });
});

describe("PGColorSwatch — the swatch rows", () => {
  it("commits a colour taken from the theme's own palette", () => {
    const { onChange } = renderLive({
      swatches: [
        { hex: "#1e222a", label: "Background · panel" },
        { hex: "#eef1f5", label: "Foreground · primary" },
      ],
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: /Background · panel/ }));
    expect(onChange).toHaveBeenLastCalledWith("#1e222a");
  });

  it("offers the colours picked recently", () => {
    const { onChange } = renderLive({ recent: ["#ff8800", "#123456"] });
    open();
    fireEvent.click(screen.getByRole("button", { name: /#ff8800/ }));
    expect(onChange).toHaveBeenLastCalledWith("#ff8800");
  });

  it("shows no recent row at all when there is nothing in it", () => {
    render(
      <PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} recent={[]} />,
    );
    open();
    expect(screen.queryByText(/recent/i)).toBeNull();
  });
});

describe("PGColorSwatch — the contrast readout", () => {
  it("measures the pair while you drag, where the finding is actionable", () => {
    render(
      <PGColorSwatch
        label="Accent"
        value={ACCENT}
        onChange={() => {}}
        contrast={{ against: "#0e1a26", label: "Accent · on-ink" }}
      />,
    );
    open();
    // #5aa8e8 on #0e1a26, by the same formula theme/contrast.ts uses.
    expect(screen.getByTestId("colorpicker-contrast").textContent).toMatch(/6\.9:1/);
  });

  it("says nothing when the field has no pair to be read against", () => {
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    expect(screen.queryByTestId("colorpicker-contrast")).toBeNull();
  });
});

describe("PGColorSwatch — copy and paste", () => {
  // fireEvent, not userEvent: `userEvent.setup()` swaps `navigator.clipboard`
  // for its own stub, which detaches a writeText spy so every clipboard
  // assertion passes while asserting nothing.
  const clipboard = (text = "") => {
    const writeText = vi.fn();
    const readText = vi.fn(async () => text);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText },
      configurable: true,
    });
    return { writeText, readText };
  };

  it("copies the colour from the swatch's own menu", () => {
    const { writeText } = clipboard();
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    fireEvent.contextMenu(trigger());
    fireEvent.click(screen.getByText(`Copy ${ACCENT}`));
    expect(writeText).toHaveBeenCalledWith(ACCENT);
  });

  it("pastes a colour off the clipboard, in any of its written forms", async () => {
    clipboard("  F80 ");
    const onChange = vi.fn();
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={onChange} />);
    fireEvent.contextMenu(trigger());
    fireEvent.click(screen.getByText("Paste colour"));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("#ff8800"));
  });

  it("leaves the colour alone when the clipboard holds no colour", async () => {
    clipboard("git rebase --continue");
    const onChange = vi.fn();
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={onChange} />);
    fireEvent.contextMenu(trigger());
    fireEvent.click(screen.getByText("Paste colour"));
    await vi.waitFor(() =>
      expect(screen.getByText(/clipboard holds no colour/i)).toBeTruthy(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("survives its own menu being clicked while the popover is open", async () => {
    // The #422 trap: the menu is portalled onto document.body, so an outside
    // handler that only checks `contains` reads a press on the menu as a press
    // outside the popover, closes on mousedown, and the entry's click lands on
    // a detached node doing nothing at all.
    const { writeText } = clipboard();
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.contextMenu(trigger());
    const entry = screen.getByText(`Copy ${ACCENT}`);
    fireEvent.mouseDown(entry);
    expect(popover()).toBeTruthy();
    fireEvent.click(entry);
    expect(writeText).toHaveBeenCalledWith(ACCENT);
  });
});

describe("PGColorSwatch — dismissal", () => {
  it("Escape closes the popover and puts the colour back", () => {
    // Consistent with the theme editor one level up, whose close() re-applies
    // the theme that was live on open: a dismissal is not an answer.
    const { onChange } = renderLive();
    open();
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalled();
    fireEvent.keyDown(popover()!, { key: "Escape" });
    expect(popover()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(ACCENT);
  });

  it("Escape is claimed while open and RELEASED while closed", () => {
    const outer = vi.fn(() => true);
    const un = useKeymapStore.getState().register("app.closeOverlay", outer);
    render(<PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />);
    open();
    fireEvent.keyDown(popover()!, { key: "Escape" });
    expect(popover()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    // Closed, the picker declines and the chord goes back to the outer handler.
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(outer).toHaveBeenCalledOnce();
    un();
  });

  it("does not take the dialog it is inside down with it", () => {
    // The case that actually matters. No dialog REGISTERS app.closeOverlay, so
    // what protects the theme editor is the picker claiming the chord before
    // the catalog's default runner is ever reached.
    useOverlayStore.setState({ cheatSheetOpen: true });
    render(
      <PGModal onCancel={() => {}}>
        <PGColorSwatch label="Accent" value={ACCENT} onChange={() => {}} />
      </PGModal>,
    );
    open();
    fireEvent.keyDown(popover()!, { key: "Escape" });
    expect(popover()).toBeNull();
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(true);
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
  });

  it("a click outside KEEPS the colour, unlike Escape", async () => {
    const { onChange } = renderLive();
    open();
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    const picked = onChange.mock.lastCall![0];
    // The outside listener is armed on a timeout, so the very click that
    // OPENED the popover cannot immediately close it again — hence the tick.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(document.body);
    expect(popover()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(picked);
  });

  it("reports the kept colour once, for the recents list", async () => {
    const onCommit = vi.fn();
    renderLive({ onCommit });
    open();
    fireEvent.change(hexField(), { target: { value: "#ff8800" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    // The outside listener is armed on a timeout, so the very click that
    // OPENED the popover cannot immediately close it again — hence the tick.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(document.body);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("#ff8800");
  });

  it("reports nothing on a dismissal", () => {
    const onCommit = vi.fn();
    renderLive({ onCommit });
    open();
    fireEvent.keyDown(slider(/hsv hue/i), { key: "ArrowRight" });
    fireEvent.keyDown(popover()!, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("PGSlider", () => {
  it("is exported for reuse and reports the full slider value trio", () => {
    // The theme editor's tint control is this slider, not a second one: a
    // design system with two sliders is a design system where one of them is
    // subtly wrong.
    render(
      <PGSlider
        name="Tint"
        valueText="35%"
        min={0}
        max={1}
        step={0.01}
        value={0.35}
        trackCss="linear-gradient(90deg, #000, #fff)"
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Tint" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "1");
    expect(slider).toHaveAttribute("aria-valuenow", "0.35");
    expect(slider).toHaveAttribute("aria-valuetext", "35%");
  });
});
