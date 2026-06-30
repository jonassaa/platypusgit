import { describe, it, expect } from "vitest";
import { eventToChord, formatChord } from "./chord";

const ev = (p: Partial<KeyboardEvent>) =>
  ({
    key: "",
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
  it("keeps bare '?'", () => {
    expect(eventToChord(ev({ key: "?" }))).toBe("?");
  });
  it("does not add Shift for a shifted symbol like '?'", () => {
    expect(eventToChord(ev({ key: "?", shiftKey: true }))).toBe("?");
  });
  it("keeps Shift for a named key", () => {
    expect(eventToChord(ev({ key: "Tab", shiftKey: true }))).toBe("Shift+Tab");
  });
  it("returns null for lone modifier keydown", () => {
    expect(eventToChord(ev({ key: "Shift", shiftKey: true }))).toBe(null);
  });
});

describe("formatChord", () => {
  it("renders mac glyphs", () => {
    expect(formatChord("Mod+1", "mac")).toBe("⌘1");
    expect(formatChord("Alt+ArrowLeft", "mac")).toBe("⌥←");
    expect(formatChord("Mod+Shift+P", "mac")).toBe("⌘⇧P");
  });
  it("renders non-mac words", () => {
    expect(formatChord("Mod+1", "other")).toBe("Ctrl+1");
    expect(formatChord("Alt+ArrowLeft", "other")).toBe("Alt+←");
  });
});
