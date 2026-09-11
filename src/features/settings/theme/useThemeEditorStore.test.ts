import { beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";

import { NO_LOCKS, inferTraits } from "./palette";
import { useThemeEditorStore } from "./useThemeEditorStore";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

const rootVar = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

const ed = () => useThemeEditorStore.getState();

describe("useThemeEditorStore", () => {
  beforeEach(() => {
    useThemeEditorStore.getState().close();
    useSettingsStore.getState().reset();
  });

  it("opens a new draft seeded from the source theme, with a distinct name", () => {
    ed().openNew(dark);
    expect(ed().open?.mode).toBe("new");
    expect(ed().colors).toEqual(dark.colors);
    expect(ed().themeMode).toBe("dark");
    expect(ed().name).not.toBe(dark.name);
    expect(ed().name).toContain(dark.name);
  });

  it("previews the draft on :root as it is edited", () => {
    ed().openNew(dark);
    ed().patchColors({ bg0: "#123456" });
    expect(rootVar("--bg-0")).toBe("#123456");
  });

  it("does not claim to BE a theme while previewing a draft", () => {
    ed().openNew(dark);
    ed().patchColors({ bg0: "#123456" });
    // An unsaved draft stamping `data-theme=dark-cool` would let anything
    // keyed off the active theme mistake it for the saved one.
    expect(document.documentElement.dataset.theme).toBe("__draft__");
  });

  it("restores the theme that was live when it opened, on close", () => {
    useSettingsStore.getState().setActiveThemeId("light");
    const before = rootVar("--bg-0");
    ed().openNew(light);
    ed().patchColors({ bg0: "#123456" });
    expect(rootVar("--bg-0")).toBe("#123456");

    ed().close();

    expect(rootVar("--bg-0")).toBe(before);
    expect(ed().open).toBeNull();
  });

  it("close is a no-op when nothing is open", () => {
    useSettingsStore.getState().setActiveThemeId("nord");
    const before = rootVar("--bg-0");
    ed().close();
    ed().close();
    expect(rootVar("--bg-0")).toBe(before);
  });

  it("saves a new theme, activates it, and leaves the editor", () => {
    ed().openNew(dark);
    ed().setName("My theme");
    ed().patchColors({ accent: "#ff8800" });

    const saved = ed().save();

    expect(saved?.name).toBe("My theme");
    expect(saved?.colors.accent).toBe("#ff8800");
    const store = useSettingsStore.getState();
    expect(store.customThemes.some((t) => t.id === saved!.id)).toBe(true);
    expect(store.getActiveTheme().id).toBe(saved!.id);
    expect(ed().open).toBeNull();
    // The saved theme stays on screen — save() must NOT restore.
    expect(rootVar("--accent")).toBe("#ff8800");
  });

  it("a close after a save cannot undo it", () => {
    ed().openNew(dark);
    ed().setName("My theme");
    ed().patchColors({ accent: "#ff8800" });
    ed().save();
    ed().close();
    expect(rootVar("--accent")).toBe("#ff8800");
  });

  it("refuses to save an empty name, staying open", () => {
    ed().openNew(dark);
    ed().setName("   ");
    expect(ed().save()).toBeNull();
    expect(ed().open).not.toBeNull();
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("saves the draft's own mode, not the source's", () => {
    // The mode decides which half of the light/dark pairing this theme is, so
    // a draft flipped to light must not be saved as dark.
    ed().openNew(dark);
    ed().setName("Mine");
    ed().setThemeMode("light");
    const saved = ed().save();
    expect(saved?.mode).toBe("light");
    expect(useSettingsStore.getState().customThemes[0].mode).toBe("light");
  });

  it("edits an existing custom theme in place rather than adding one", () => {
    ed().openNew(dark);
    ed().setName("Mine");
    const created = ed().save()!;

    ed().openEdit(
      useSettingsStore.getState().customThemes.find((t) => t.id === created.id)!,
    );
    ed().patchColors({ accent: "#00ddaa" });
    ed().save();

    const customs = useSettingsStore.getState().customThemes;
    expect(customs).toHaveLength(1);
    expect(customs[0].colors.accent).toBe("#00ddaa");
  });

  it("applyBase swaps the whole palette and fixes the ink", () => {
    ed().openNew(dark);
    ed().applyBase("light", "#8844cc");
    expect(ed().colors.bg0).toBe(light.colors.bg0);
    expect(ed().colors.accent).toBe("#8844cc");
    expect(ed().themeMode).toBe("light");
    expect(ed().baseId).toBe("light");
  });

  it("applyBase ignores a theme id that does not exist", () => {
    ed().openNew(dark);
    ed().applyBase("no-such-theme", "#8844cc");
    expect(ed().colors).toEqual(dark.colors);
  });

  it("renames an untouched new draft after the theme it now starts from", () => {
    // "Add theme" opens on the active theme, so the base picker is how you
    // choose what to start from — a draft left named after a palette it no
    // longer uses is the whole reason that flow felt wrong.
    ed().openNew(dark);
    expect(ed().name).toBe(`${dark.name} (custom)`);
    ed().applyBase("light", ed().colors.accent);
    expect(ed().name).toBe(`${light.name} (custom)`);
  });

  it("never overwrites a name the user typed when the base changes", () => {
    ed().openNew(dark);
    ed().setName("Midnight");
    ed().applyBase("light", ed().colors.accent);
    expect(ed().name).toBe("Midnight");
  });

  it("leaves the name alone when re-basing while editing an existing theme", () => {
    ed().openNew(dark);
    ed().setName("Mine");
    const created = ed().save()!;

    ed().openEdit(
      useSettingsStore.getState().customThemes.find((t) => t.id === created.id)!,
    );
    ed().applyBase("light", ed().colors.accent);
    expect(ed().name).toBe("Mine");
  });

  it("keeps renaming after a re-base, while the name is still automatic", () => {
    ed().openNew(dark);
    ed().applyBase("light", ed().colors.accent);
    ed().applyBase("nord", ed().colors.accent);
    expect(ed().name).toBe("Nord (custom)");
  });

  it("revert returns the draft to the source it opened from", () => {
    ed().openNew(dark);
    ed().patchColors({ bg0: "#123456" });
    ed().setThemeMode("light");
    ed().revert();
    expect(ed().colors).toEqual(dark.colors);
    expect(ed().themeMode).toBe("dark");
    expect(rootVar("--bg-0")).toBe(dark.colors.bg0);
  });
});

describe("palette traits", () => {
  beforeEach(() => {
    useThemeEditorStore.getState().close();
    useSettingsStore.getState().reset();
  });

  it("opens a draft on traits that regenerate it unchanged", () => {
    ed().openEdit(dark);
    expect(ed().traits.baseId).toBe(dark.id);
    expect(ed().traits.seed).toBe(dark.colors.accent);
    expect(ed().traits.strength).toBe(0);
    expect(ed().colors).toEqual(dark.colors);
  });

  it("regenerates the palette when a trait moves", () => {
    ed().openEdit(dark);
    ed().setTrait("strength", 0.6);
    expect(ed().colors.bg0).not.toBe(dark.colors.bg0);
    // The ramp moved; the accent the user picked did not.
    expect(ed().colors.accent).toBe(dark.colors.accent);
  });

  it("leaves a locked trait alone through a shuffle", () => {
    ed().openEdit(dark);
    ed().toggleLock("seed");
    const seed = ed().traits.seed;
    for (let i = 0; i < 20; i++) ed().shuffle();
    expect(ed().traits.seed).toBe(seed);
    expect(ed().colors.accent).toBe(seed);
  });

  it("actually changes the palette when nothing is locked", () => {
    ed().openEdit(dark);
    const before = { ...ed().colors };
    ed().shuffle();
    expect(ed().colors).not.toEqual(before);
  });

  it("paints a shuffled palette straight onto :root", () => {
    ed().openEdit(dark);
    ed().shuffle();
    expect(rootVar("--bg-0")).toBe(ed().colors.bg0);
  });

  it("does not regenerate over a hand-edited slot", () => {
    // patchColors is the eighteen-slot path. It writes, and nothing more.
    ed().openEdit(dark);
    ed().patchColors({ border1: "#ff00ff" });
    expect(ed().colors.border1).toBe("#ff00ff");
  });

  it("keeps the shuffled base in step with the mode the draft is in", () => {
    ed().openEdit(light);
    for (let i = 0; i < 20; i++) ed().shuffle();
    expect(ed().themeMode).toBe("light");
  });

  it("revert puts the traits back too, not just the colours", () => {
    // Otherwise the palette is the source's again while the traits still
    // describe the abandoned generation, and the section reads "Custom" against
    // a palette it could regenerate exactly.
    ed().openEdit(dark);
    ed().setTrait("strength", 0.8);
    ed().setTrait("rule", "complementary");
    ed().revert();
    expect(ed().colors).toEqual(dark.colors);
    expect(ed().traits).toEqual(inferTraits(dark));
  });

  it("clears traits and locks on close", () => {
    ed().openEdit(dark);
    ed().toggleLock("rule");
    ed().close();
    expect(ed().locks).toEqual(NO_LOCKS);
  });
});
