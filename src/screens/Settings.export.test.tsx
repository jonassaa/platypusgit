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
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, dismissDialog, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useKeymapStore } from "@/features/keymap";
import { BackupPage } from "@/features/settings/pages/backup";

// jsdom's Blob has no `text()`, and both file-import paths in Settings read the
// picked file with `file.text()` (the real WKWebView/WebKitGTK/WebView2 all have
// it). FileReader IS implemented, so bridge the two.
if (typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

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

let downloads: string[];
let origClick: () => void;
let origCreate: typeof URL.createObjectURL;
let origRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  resetDialogs();
  mockRestOfSettings();
  useSettingsStore.getState().reset();
  downloads = [];
  origClick = HTMLAnchorElement.prototype.click;
  origCreate = URL.createObjectURL;
  origRevoke = URL.revokeObjectURL;
  // jsdom has no blob-URL plumbing and no downloads; record what the anchor was
  // told to save instead.
  URL.createObjectURL = vi.fn(
    () => "blob:settings",
  ) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = origClick;
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
  resetDialogs();
});

// Deliberately distinct from Appearance's theme "Export" / "Import…" pair —
// two buttons called Import… on one screen is ambiguous for a user and
// ambiguous for a query.
const exportButton = () =>
  screen.getByRole("button", { name: /^export settings$/i });
const importButton = () =>
  screen.getByRole("button", { name: /^import settings…$/i });
const importInput = () =>
  screen.getByTestId("settings-import-input") as HTMLInputElement;

/**
 * Feed the hidden file input. `userEvent.upload` clicks the element first, and
 * this input is `display: none` (the visible control is the Import… button), so
 * the change event is dispatched directly.
 */
async function pickFile(json: string, name = "platypusgit-settings.json") {
  const file = new File([json], name, { type: "application/json" });
  await act(async () => {
    fireEvent.change(importInput(), { target: { files: [file] } });
  });
}

describe("Settings → Settings file: export", () => {
  it("offers both halves as buttons, with the file picker behind Import…", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    expect(exportButton()).toBeTruthy();
    // The visible control is a button; the <input type="file"> is hidden behind
    // it, so the section reads like the rest of Settings.
    expect(importButton()).toBeTruthy();
    expect(importInput().style.display).toBe("none");
    await userEvent.click(importButton());
  });

  it("names the file it wrote", async () => {
    render(
      <WithDialogs>
        <BackupPage />
      </WithDialogs>,
    );
    await userEvent.click(exportButton());
    const said = await screen.findByTestId("settings-export-result");
    expect(downloads).toHaveLength(1);
    // The filename on screen is the filename the browser was given — a message
    // that says "exported" without saying to what is not an answer.
    expect(said.textContent).toContain(downloads[0]);
    expect(downloads[0]).toMatch(/^platypusgit-settings-\d{4}-\d{2}-\d{2}\.json$/);
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
