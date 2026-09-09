import { beforeEach, describe, expect, it } from "vitest";

import { lastDialogSaveOptions, mockDialogOpen, mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

import { openTextFile, saveTextFile, THEME_FILE_FILTERS } from "./userFile";

describe("saveTextFile", () => {
  beforeEach(() => {
    mockDialogSave(null);
  });

  it("returns null and writes nothing when the user cancels", async () => {
    mockDialogSave(null);
    const path = await saveTextFile({
      defaultName: "my-theme.pgtheme.json",
      contents: "{}",
    });
    expect(path).toBeNull();
    expect(getInvokeCalls().some((c) => c.cmd === "write_user_file")).toBe(false);
  });

  it("writes the contents to the chosen path and returns it", async () => {
    mockDialogSave("/home/you/my-theme.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);

    const path = await saveTextFile({
      defaultName: "my-theme.pgtheme.json",
      contents: '{"name":"My theme"}',
      filters: THEME_FILE_FILTERS,
    });

    expect(path).toBe("/home/you/my-theme.pgtheme.json");
    const call = getInvokeCalls().find((c) => c.cmd === "write_user_file");
    expect(call?.args).toEqual({
      path: "/home/you/my-theme.pgtheme.json",
      contents: '{"name":"My theme"}',
    });
  });

  it("offers the default name to the dialog", async () => {
    mockDialogSave("/home/you/x.json");
    mockInvoke("write_user_file", () => undefined);
    await saveTextFile({ defaultName: "dark-cool.pgtheme.json", contents: "{}" });
    expect(lastDialogSaveOptions()).toMatchObject({
      defaultPath: "dark-cool.pgtheme.json",
    });
  });
});

describe("openTextFile", () => {
  it("returns null when the user cancels", async () => {
    mockDialogOpen(null);
    expect(await openTextFile()).toBeNull();
  });

  it("reads the chosen file and returns its path and contents", async () => {
    mockDialogOpen("/home/you/theme.pgtheme.json");
    mockInvoke("read_user_file", () => '{"name":"From disk"}');

    const got = await openTextFile({ filters: THEME_FILE_FILTERS });

    expect(got).toEqual({
      path: "/home/you/theme.pgtheme.json",
      contents: '{"name":"From disk"}',
    });
  });

  it("takes the first path when the dialog answers with an array", async () => {
    // `open()` returns string[] when multiple:true. We never ask for multiple,
    // but the plugin's type admits it, and reading [0] is cheaper than
    // trusting a cast.
    mockDialogOpen(["/home/you/a.json", "/home/you/b.json"]);
    mockInvoke("read_user_file", () => "{}");

    const got = await openTextFile();
    expect(got?.path).toBe("/home/you/a.json");
  });
});
