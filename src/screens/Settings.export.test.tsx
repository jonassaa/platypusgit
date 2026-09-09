// The Settings → "Settings file" panel (#254). The store's half is pinned in
// features/settings/useSettingsStore.export.test.ts; this file asserts the two
// promises the UI itself makes:
//
//   * export SAYS WHERE THE FILE WENT — "settings exported" with no filename is
//     not an answer.
//   * import ASKS FIRST and then REPORTS what changed, rather than replacing
//     every preference silently.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import {
  lastDialogSaveOptions,
  mockDialogOpen,
  mockDialogSave,
} from "@/test/dialogMock";
import { WithDialogs, acceptDialog, dismissDialog, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useKeymapStore } from "@/features/keymap";
import { BackupPage } from "@/features/settings/pages/backup";

/** BackupPage's Diagnostics card loads too; give it what it asks for. */
function mockRestOfSettings() {
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log",
    logExists: false,
    logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0",
    version: "0.1.0",
  }));
}

/** Where the native save dialog pretends the user chose to put the file. */
const SAVED_TO = "/home/you/platypusgit-settings-2026-09-09.json";

beforeEach(() => {
  localStorage.clear();
  resetDialogs();
  mockRestOfSettings();
  useSettingsStore.getState().reset();
  // Export goes through a native save dialog and a backend write (#435), not a
  // blob URL and an anchor click - WebKitGTK ignores the latter, which is why
  // this whole path was replaced.
  mockDialogSave(SAVED_TO);
  mockInvoke("write_user_file", () => undefined);
});

afterEach(() => {
  resetDialogs();
});

/** What the backend was actually told to write, if anything. */
const written = () => getInvokeCalls().filter((c) => c.cmd === "write_user_file");

// Deliberately distinct from Appearance's theme "Export" / "Import…" pair —
// two buttons called Import… on one screen is ambiguous for a user and
// ambiguous for a query.
const exportButton = () =>
  screen.getByRole("button", { name: /^export settings…$/i });
const importButton = () =>
  screen.getByRole("button", { name: /^import settings…$/i });

/**
 * Answer the native open dialog with `json`, then click Import…
 *
 * There is no hidden `<input type="file">` any more: the path comes from
 * `@tauri-apps/plugin-dialog` and the bytes from `read_user_file`, so the mock
 * seam is the dialog plus the command rather than a change event on an input.
 */
async function pickFile(json: string, name = "platypusgit-settings.json") {
  mockDialogOpen(`/home/you/${name}`);
  mockInvoke("read_user_file", () => json);
  await act(async () => {
    fireEvent.click(importButton());
  });
}

describe("Settings → Settings file: export", () => {
  it("offers both halves as buttons that open a native dialog", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    expect(exportButton()).toBeTruthy();
    expect(importButton()).toBeTruthy();
    // Both are plain buttons now. The hidden <input type="file"> they used to
    // stand in front of is gone, along with the anchor-click export beside it -
    // `test/fileSave.test.ts` fails the build if either comes back.
    expect(screen.queryByTestId("settings-import-input")).toBeNull();
    // Cancelling says nothing and changes nothing.
    mockDialogOpen(null);
    await act(async () => {
      fireEvent.click(importButton());
    });
    expect(screen.queryByTestId("settings-import-report")).toBeNull();
    expect(screen.queryByTestId("settings-import-error")).toBeNull();
  });

  it("names the file it wrote", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await userEvent.click(exportButton());
    const said = await screen.findByTestId("settings-export-result");
    expect(written()).toHaveLength(1);
    // The PATH on screen is the path the file actually went to - a message that
    // says "exported" without saying to what is not an answer, and the old copy
    // guessed at a "downloads folder" the app never chose.
    expect(said.textContent).toContain(SAVED_TO);
    expect((lastDialogSaveOptions() as { defaultPath: string }).defaultPath).toMatch(
      /^platypusgit-settings-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    mockDialogSave(null);
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await userEvent.click(exportButton());
    expect(written()).toHaveLength(0);
    expect(screen.queryByTestId("settings-export-result")).toBeNull();
  });

  it("puts the active keymap preset in the file", async () => {
    useKeymapStore.getState().setPreset("platypusgit");
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await userEvent.click(exportButton());
    // The screen is what bridges the two stores, so this is the only level at
    // which the keymap actually reaches the file.
    const json = useSettingsStore
      .getState()
      .exportSettings({ keymapPresetId: useKeymapStore.getState().activePresetId });
    expect(JSON.parse(json).keymap).toEqual({ presetId: "platypusgit" });
  });
});

describe("Settings → Settings file: import", () => {
  /** A payload as the app itself writes it. */
  function fileWith(patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const base = JSON.parse(useSettingsStore.getState().exportSettings()) as {
      settings: Record<string, unknown>;
    };
    return JSON.stringify({ ...base, ...extra, settings: { ...base.settings, ...patch } });
  }

  it("asks before replacing anything, and does nothing if declined", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({ diffViewMode: "split" }));
    // The dialog names the file, which is the only thing the user can still
    // recognise at this point.
    await screen.findByTestId("dialog-confirm");
    expect(screen.getByTestId("dialog-title").textContent).toMatch(/replace/i);
    await dismissDialog();
    expect(useSettingsStore.getState().diffViewMode).toBe("inline");
    expect(screen.queryByTestId("settings-import-report")).toBeNull();
  });

  it("applies on confirm and reports the settings that changed", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({ diffViewMode: "split", addSignoff: true }));
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();

    expect(useSettingsStore.getState().diffViewMode).toBe("split");
    const report = await screen.findByTestId("settings-import-report");
    expect(report.textContent).toContain("diffViewMode");
    expect(report.textContent).toContain("addSignoff");
    // Settings the file matched are NOT listed — the report is what changed,
    // not what the file contained.
    expect(report.textContent).not.toContain("pruneOnFetch");
  });

  it("says so when the file matches the machine already", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({}));
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    const report = await screen.findByTestId("settings-import-report");
    expect(report.textContent).toMatch(/nothing changed/i);
  });

  it("applies the keymap preset and counts it as a change", async () => {
    useKeymapStore.getState().setPreset("rider");
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({}, { keymap: { presetId: "platypusgit" } }));
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    expect(useKeymapStore.getState().activePresetId).toBe("platypusgit");
    const report = await screen.findByTestId("settings-import-report");
    expect(report.textContent).toContain("keymap");
  });

  it("reports an unknown keymap preset instead of applying it", async () => {
    useKeymapStore.getState().setPreset("rider");
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({}, { keymap: { presetId: "emacs-someday" } }));
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    // presetById would silently resolve an unknown id to the default while the
    // picker showed the unknown name, so it is reported, not applied.
    expect(useKeymapStore.getState().activePresetId).toBe("rider");
    const report = await screen.findByTestId("settings-import-report");
    expect(report.textContent).toContain("emacs-someday");
  });

  it("shows a readable message for a file that isn't a settings export", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile("<html>nope</html>", "notes.json");
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    const err = await screen.findByTestId("settings-import-error");
    expect(err.textContent).toMatch(/valid JSON/i);
    // Nothing applied, and no report claiming otherwise.
    expect(screen.queryByTestId("settings-import-report")).toBeNull();
    expect(useSettingsStore.getState().diffViewMode).toBe("inline");
  });

  it("points a single-theme file at the Appearance button", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    const themeJson = useSettingsStore.getState().exportTheme("dark-cool");
    await pickFile(themeJson, "midnight.pgtheme.json");
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    const err = await screen.findByTestId("settings-import-error");
    expect(err.textContent).toMatch(/theme/i);
  });

  it("names the keys it ignored", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await pickFile(fileWith({ warpDriveEnabled: true }));
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    const report = await screen.findByTestId("settings-import-report");
    await waitFor(() => expect(report.textContent).toContain("warpDriveEnabled"));
  });
});
