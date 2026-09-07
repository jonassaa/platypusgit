import React from "react";
import { PGButton, pgConfirm, pgFlash } from "@/design";
import { BUILTIN_PRESETS, useKeymapStore } from "@/features/keymap";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { Mono } from "@/features/settings/layout/text";
import type { SettingsPageMeta } from "@/features/settings/nav/types";
import {
  useSettingsStore,
  type SettingsImportReport,
} from "@/features/settings/useSettingsStore";
import { appErrorMessage } from "@/lib/errors";
import { diagnosticsReport, readLogTail, revealLogFile } from "@/lib/tauri";
import type { DiagnosticsReport } from "@/lib/types";

export const meta: SettingsPageMeta = {
  id: "advanced.backup",
  group: "advanced",
  title: "Backup & diagnostics",
  icon: "info",
  cards: [
    {
      id: "backup",
      title: "Settings file",
      subtitle: "Move every preference to another machine, or share a house style with your team.",
      rows: [
        { id: "backup.export", label: "Export settings", keywords: "save file json share house style backup" },
        { id: "backup.import", label: "Import settings", keywords: "load file json restore" },
      ],
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      subtitle: "The app's log — what to attach to a bug report.",
      rows: [
        { id: "diagnostics.environment", label: "Environment", keywords: "version os arch git bug report" },
        { id: "diagnostics.log", label: "Log file", keywords: "tail reveal path debug troubleshoot" },
      ],
    },
  ],
};

/**
 * The keymap lives in `useKeymapStore` under its own localStorage key, so this
 * screen is what bridges the two stores: it hands the active preset to the
 * export and applies the one an import reports. The settings store cannot read
 * it directly — `keymap/actions.ts` imports the settings store, so the reverse
 * import would be a cycle.
 *
 * Two cards, one component: "Settings file" (export/import every preference,
 * #254) and "Diagnostics" (the app's log, #274) share nothing but a page —
 * they are kept together here rather than split because neither is large
 * enough on its own to earn a file.
 */
export function BackupPage() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [exportedTo, setExportedTo] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<
    (SettingsImportReport & { keymapApplied: string | null }) | null
  >(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const onExport = () => {
    setReport(null);
    setFailure(null);
    const name = useSettingsStore.getState().downloadSettings({
      keymapPresetId: useKeymapStore.getState().activePresetId,
    });
    setExportedTo(name);
    pgFlash(`Exported ${name}`);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExportedTo(null);
    setReport(null);
    setFailure(null);
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setFailure(appErrorMessage(err));
      return;
    }
    // Asked before applying, not after: an import replaces every preference at
    // once, and the file is the one thing the user can still recognise here.
    if (
      !(await pgConfirm({
        title: "Replace your settings with this file?",
        body: (
          <>
            Every preference in <Mono>{file.name}</Mono> is applied to this
            machine. Nothing in your repositories changes, and what changed is
            listed afterwards.
          </>
        ),
        confirmLabel: "Import settings",
      }))
    )
      return;

    let result: SettingsImportReport;
    try {
      result = useSettingsStore.getState().importSettings(text);
    } catch (err) {
      setFailure(appErrorMessage(err));
      return;
    }

    // The keymap half. An id this build has no preset for is reported as
    // ignored rather than applied — `presetById` would silently resolve it to
    // the default while the picker showed the unknown name.
    const keymap = useKeymapStore.getState();
    let keymapApplied: string | null = null;
    const ignored = [...result.ignored];
    if (result.keymapPresetId) {
      const known = BUILTIN_PRESETS.some((p) => p.id === result.keymapPresetId);
      if (!known) {
        ignored.push(`keymap: ${result.keymapPresetId}`);
      } else if (result.keymapPresetId !== keymap.activePresetId) {
        keymap.setPreset(result.keymapPresetId);
        keymapApplied = result.keymapPresetId;
      }
    }
    setReport({ ...result, ignored, keymapApplied });
    // The toast is the immediate answer; the report row below is the detail,
    // because a list of key names outlives a 1.7s toast.
    const count = result.changed.length + (keymapApplied ? 1 : 0);
    pgFlash(
      count === 0
        ? "Settings already match this file"
        : `Imported ${count} ${count === 1 ? "setting" : "settings"}`,
    );
  };

  const [diagReport, setDiagReport] = React.useState<DiagnosticsReport | null>(null);
  const [diagBusy, setDiagBusy] = React.useState(false);

  React.useEffect(() => {
    diagnosticsReport()
      .then(setDiagReport)
      .catch(() => setDiagReport(null));
  }, []);

  const copyLog = async () => {
    setDiagBusy(true);
    try {
      const tail = await readLogTail();
      // The header goes ON the clipboard, not just on screen. A pasted tail may
      // not reach back far enough to include the startup `host …` line, and a
      // log whose platform is unknown is what made #274 hard to read in the
      // first place — so the copy carries its own provenance.
      const header = diagReport
        ? `platypusgit ${diagReport.version}\n${diagReport.environment}\n${diagReport.logPath}\n\n`
        : "";
      await navigator.clipboard?.writeText(`${header}${tail}`);
      pgFlash("Log tail copied");
    } catch (e) {
      pgFlash(appErrorMessage(e));
    } finally {
      setDiagBusy(false);
    }
  };

  const revealLog = async () => {
    try {
      await revealLogFile();
    } catch (e) {
      pgFlash(appErrorMessage(e));
    }
  };

  return (
    <>
      <SettingsCard
        id="backup"
        title="Settings file"
        subtitle="Move every preference to another machine, or share a house style with your team."
      >
        <SettingsRow
          id="backup.export"
          label="Export settings"
          hint={
            exportedTo ? (
              <span data-testid="settings-export-result">
                Saved <Mono>{exportedTo}</Mono> to your downloads folder.
              </span>
            ) : (
              <>
                One JSON file with every preference and every custom theme.
                Forge tokens and git credentials are never in it, and neither is
                anything specific to this machine.
              </>
            )
          }
          control={
            <PGButton size="sm" icon="download" onClick={onExport}>
              Export settings
            </PGButton>
          }
        />
        <SettingsRow
          id="backup.import"
          label="Import settings"
          hint={
            failure ? (
              <span
                data-testid="settings-import-error"
                style={{ color: "var(--git-removed)" }}
              >
                {failure}
              </span>
            ) : report ? (
              <ImportReport report={report} />
            ) : (
              <>
                Reads a file exported here. Settings it does not mention are left
                as they are, and you will see exactly what changed.
              </>
            )
          }
          control={
            <PGButton
              size="sm"
              icon="upload"
              onClick={() => fileInputRef.current?.click()}
            >
              Import settings…
            </PGButton>
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onImportFile}
          data-testid="settings-import-input"
          style={{ display: "none" }}
        />
      </SettingsCard>

      <SettingsCard
        id="diagnostics"
        title="Diagnostics"
        subtitle="The app's log — what to attach to a bug report."
      >
        <SettingsRow
          id="diagnostics.environment"
          label="Environment"
          hint={
            diagReport ? (
              <Mono selectable>{diagReport.environment}</Mono>
            ) : (
              "Reading…"
            )
          }
          control={<span />}
        />
        <SettingsRow
          id="diagnostics.log"
          label="Log file"
          hint={
            diagReport ? (
              <>
                <Mono selectable>{diagReport.logPath}</Mono>
                {!diagReport.logExists && " — not written yet"}
              </>
            ) : (
              "Reading…"
            )
          }
          control={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PGButton
                size="sm"
                onClick={copyLog}
                disabled={diagBusy || !diagReport?.logExists}
              >
                Copy last 500 lines
              </PGButton>
              <PGButton
                size="sm"
                onClick={revealLog}
                disabled={!diagReport?.logExists}
              >
                Show file
              </PGButton>
            </div>
          }
        />
      </SettingsCard>
    </>
  );
}

/** What the import changed. Key names, not prose labels: this is a developer
 *  tool, the names are what the file contains, and a second table of friendly
 *  labels would be a second thing to keep in step with the schema. */
function ImportReport({
  report,
}: {
  report: SettingsImportReport & { keymapApplied: string | null };
}) {
  const changed = [
    ...report.changed,
    ...(report.keymapApplied ? [`keymap → ${report.keymapApplied}`] : []),
  ];
  return (
    <span data-testid="settings-import-report">
      {changed.length === 0 ? (
        <>Nothing changed — this machine already matches the file.</>
      ) : (
        <>
          Changed {changed.length}{" "}
          {changed.length === 1 ? "setting" : "settings"}:{" "}
          <Mono>{changed.join(", ")}</Mono>.
        </>
      )}
      {report.ignored.length > 0 && (
        <>
          {" "}
          Ignored (not a portable setting in this version):{" "}
          <Mono>{report.ignored.join(", ")}</Mono>.
        </>
      )}
      {report.fromNewerVersion && (
        <> The file was written by a newer version of platypusgit.</>
      )}
    </span>
  );
}
