import { beforeEach, describe, expect, it } from "vitest";

import { lastDialogSaveOptions, mockDialogOpen, mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

import { useSettingsStore } from "./useSettingsStore";
import {
  exportSettingsToFile,
  exportThemeToFile,
  importThemeFromFile,
  readSettingsFile,
  themeFileName,
} from "./themeFiles";

describe("themeFileName", () => {
  it("slugs the theme name and keeps the double extension", () => {
    expect(themeFileName("My Cool Theme")).toBe("my-cool-theme.pgtheme.json");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(themeFileName("  Dark · Cool!!  ")).toBe("dark-cool.pgtheme.json");
  });

  it("falls back to a usable name when the slug empties out", () => {
    expect(themeFileName("···")).toBe("theme.pgtheme.json");
  });
});

describe("exportThemeToFile", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("offers the slugged filename and writes the exported JSON", async () => {
    mockDialogSave("/home/you/dark-cool.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);

    const path = await exportThemeToFile("dark-cool");

    expect(path).toBe("/home/you/dark-cool.pgtheme.json");
    expect(lastDialogSaveOptions()).toMatchObject({
      defaultPath: "dark-cool.pgtheme.json",
    });
    const call = getInvokeCalls().find((c) => c.cmd === "write_user_file");
    const written = JSON.parse((call?.args as { contents: string }).contents);
    expect(written.name).toBe("Dark · Cool");
    expect(written.colors.accent).toBe("#5aa8e8");
  });

  it("returns null and writes nothing when the user cancels", async () => {
    mockDialogSave(null);
    expect(await exportThemeToFile("dark-cool")).toBeNull();
    expect(getInvokeCalls().some((c) => c.cmd === "write_user_file")).toBe(false);
  });

  it("exports a custom theme by its own name", async () => {
    const created = useSettingsStore.getState().duplicateTheme("nord", "My Nord");
    mockDialogSave("/home/you/my-nord.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);

    await exportThemeToFile(created.id);

    expect(lastDialogSaveOptions()).toMatchObject({
      defaultPath: "my-nord.pgtheme.json",
    });
  });
});

describe("exportSettingsToFile", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("offers a dated filename and writes the whole bundle", async () => {
    mockDialogSave("/home/you/platypusgit-settings-2026-09-09.json");
    mockInvoke("write_user_file", () => undefined);

    const path = await exportSettingsToFile();

    expect(path).toBe("/home/you/platypusgit-settings-2026-09-09.json");
    // Date, not timestamp: this is a file people keep and re-read, so a name
    // they can recognise beats a name that is unique.
    expect((lastDialogSaveOptions() as { defaultPath: string }).defaultPath).toMatch(
      /^platypusgit-settings-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const call = getInvokeCalls().find((c) => c.cmd === "write_user_file");
    const written = JSON.parse((call?.args as { contents: string }).contents);
    expect(written.settings).toBeTruthy();
    expect(written.settings.customThemes).toEqual([]);
  });

  it("returns null and writes nothing when the user cancels", async () => {
    mockDialogSave(null);
    expect(await exportSettingsToFile()).toBeNull();
    expect(getInvokeCalls().some((c) => c.cmd === "write_user_file")).toBe(false);
  });
});

describe("readSettingsFile", () => {
  it("hands back the path and contents WITHOUT applying them", async () => {
    useSettingsStore.getState().reset();
    mockDialogOpen("/home/you/settings.json");
    mockInvoke("read_user_file", () => '{"settings":{"uiSpacing":"comfortable"}}');

    const picked = await readSettingsFile();

    expect(picked?.path).toBe("/home/you/settings.json");
    // Read, not applied: the Backup page confirms first, so nothing may change
    // before the user has answered. Still the post-reset DEFAULT ("cozy"), not
    // the fixture's "comfortable" — proof the file's contents never touched
    // the store.
    expect(useSettingsStore.getState().uiSpacing).toBe("cozy");
  });

  it("returns null when the user cancels", async () => {
    mockDialogOpen(null);
    expect(await readSettingsFile()).toBeNull();
  });
});

describe("importThemeFromFile", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("adds the theme in the file to the store and returns it", async () => {
    const colors = { ...useSettingsStore.getState().getActiveTheme().colors };
    mockDialogOpen("/home/you/from-disk.pgtheme.json");
    mockInvoke("read_user_file", () =>
      JSON.stringify({ version: 1, name: "From disk", mode: "dark", colors }),
    );

    const theme = await importThemeFromFile();

    expect(theme?.name).toBe("From disk");
    expect(
      useSettingsStore.getState().customThemes.some((t) => t.name === "From disk"),
    ).toBe(true);
  });

  it("returns null when the user cancels, leaving the store alone", async () => {
    mockDialogOpen(null);
    expect(await importThemeFromFile()).toBeNull();
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("throws a readable message for a file that is not a theme", async () => {
    mockDialogOpen("/home/you/not-a-theme.json");
    mockInvoke("read_user_file", () => '{"hello":"world"}');
    await expect(importThemeFromFile()).rejects.toThrow(/colors/i);
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });
});
