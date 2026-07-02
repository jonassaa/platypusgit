import { describe, it, expect } from "vitest";
import { eventToChord, formatChord, DOUBLE_SHIFT } from "./chord";

const ev = (p: Partial<KeyboardEvent>) =>
  ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...p,
  }) as KeyboardEvent;

describe("eventToChord", () => {
  it("maps meta+digit to Mod+", () => {
    expect(eventToChord(ev({ key: "1", metaKey: true }))).toBe("Mod+1");
  });
  it("maps ctrl+digit to Mod+ on non-mac", () => {
    // jsdom's navigator.platform is not mac, so ctrl is the Mod key here.
    expect(eventToChord(ev({ key: "1", ctrlKey: true }))).toBe("Mod+1");
  });
  it("orders modifiers Mod,Alt,Shift", () => {
    expect(eventToChord(ev({ key: "ArrowLeft", altKey: true }))).toBe(
      "Alt+ArrowLeft",
    );
  });
  it("upper-cases single letters", () => {
    expect(eventToChord(ev({ key: "p", metaKey: true, shiftKey: true }))).toBe(
      "Mod+Shift+P",
    );
  });

  // e.code-based resolution: Alt+letter on macOS produces a composed char in
  // e.key ("ƒ" for Alt+F) and non-US layouts move letters — the physical key
  // code must win for letters and digits.
  it("uses e.code for letters (Alt+F producing 'ƒ' still means F)", () => {
    expect(eventToChord(ev({ key: "ƒ", code: "KeyF", altKey: true }))).toBe(
      "Alt+F",
    );
  });
  it("uses e.code for digits", () => {
    expect(eventToChord(ev({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }))).toBe(
      "Mod+Shift+1",
    );
  });
  it("adds Shift for code-resolved letters", () => {
    expect(eventToChord(ev({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }))).toBe(
      "Mod+Shift+K",
    );
  });

  it("keeps bare '?'", () => {
    expect(eventToChord(ev({ key: "?", code: "Slash" }))).toBe("?");
  });
  it("does not add Shift for a shifted symbol like '?'", () => {
    expect(eventToChord(ev({ key: "?", code: "Slash", shiftKey: true }))).toBe("?");
  });
  it("keeps Shift for a named key", () => {
    expect(eventToChord(ev({ key: "Tab", shiftKey: true }))).toBe("Shift+Tab");
  });
  it("resolves comma with Mod", () => {
    expect(eventToChord(ev({ key: ",", code: "Comma", metaKey: true }))).toBe("Mod+,");
  });
  it("returns null for lone modifier keydown", () => {
    expect(eventToChord(ev({ key: "Shift", shiftKey: true }))).toBe(null);
    expect(eventToChord(ev({ key: "Meta", metaKey: true }))).toBe(null);
  });
});

describe("formatChord", () => {
  it("renders mac glyphs", () => {
    expect(formatChord("Mod+1", "mac")).toBe("⌘1");
    expect(formatChord("Alt+ArrowLeft", "mac")).toBe("⌥←");
    expect(formatChord("Mod+Shift+P", "mac")).toBe("⌘⇧P");
    expect(formatChord("Tab", "mac")).toBe("⇥");
  });
  it("renders non-mac words", () => {
    expect(formatChord("Mod+1", "other")).toBe("Ctrl+1");
    expect(formatChord("Alt+ArrowLeft", "other")).toBe("Alt+←");
    expect(formatChord("Shift+Tab", "other")).toBe("Shift+Tab");
  });
  it("renders the space chord as 'Space'", () => {
    expect(formatChord(" ", "mac")).toBe("Space");
    expect(formatChord(" ", "other")).toBe("Space");
  });
  it("renders DoubleShift", () => {
    expect(formatChord(DOUBLE_SHIFT, "mac")).toBe("⇧⇧");
    expect(formatChord(DOUBLE_SHIFT, "other")).toBe("Shift Shift");
  });
});
