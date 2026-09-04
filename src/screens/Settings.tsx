import React from "react";
import {
  PGButton,
  PGIcon,
  PGInput,
  PGToggle,
  pgConfirm,
  pgFlash,
} from "@/design";
import {
  useSettingsStore,
  type SettingsImportReport,
} from "@/features/settings/useSettingsStore";
import {
  SettingsCard,
  SettingsRow,
} from "@/features/settings/layout/SettingsCard";
import { AppearancePage } from "@/features/settings/pages/appearance";
import { CommitPage } from "@/features/settings/pages/commit";
import { DiffPage } from "@/features/settings/pages/diff";
import { IntegrationsPage } from "@/features/settings/pages/integrations";
import { KeyboardPage } from "@/features/settings/pages/keyboard";
import { RemotePage } from "@/features/settings/pages/remote";
import { UpdatesPage } from "@/features/settings/pages/updates";
import {
  cliShimStatus,
  diagnosticsReport,
  installCliShim,
  readLogTail,
  revealLogFile,
} from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type {
  CliPathState,
  CliShimStatus,
  DiagnosticsReport,
} from "@/lib/types";
import { BUILTIN_PRESETS, useKeymapStore } from "@/features/keymap";

export function SettingsScreen() {
  const s = useSettingsStore();

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          padding: "28px 32px 64px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <PGIcon name="settings" size={20} style={{ color: "var(--accent)" }} />
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-20)",
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.01em",
              color: "var(--fg-0)",
            }}
          >
            Settings
          </h1>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={s.reset}>
            Reset to defaults
          </PGButton>
        </div>
        <p
          style={{
            margin: "0 0 24px",
            color: "var(--fg-2)",
            fontSize: "var(--fs-12)",
          }}
        >
          Preferences are saved locally and apply to every repository.
        </p>

        <CommitPage />

        <AppearancePage />

        {/*
         * TASK 6 TRANSIENT STATE: this card is what remains of "Pull & fetch"
         * after Task 5 moved every other row into RemotePage. `workspace.watch`
         * and `workspace.shell` stay here — they belong on the Workspace page
         * Task 6 adds, not on Remote & sync — so this card is left with just its
         * header and these two rows until Task 6 empties it for good.
         */}
        <SettingsCard
          id="pull"
          title="Pull & fetch"
          subtitle="How platypusgit updates your local branches from their upstream."
        >
          <SettingsRow
            id="workspace.watch"
            label="Watch the working copy"
            hint="Notice edits made outside the app — in your editor or a terminal — and keep the file list and history up to date without a manual refresh. Ignored files are skipped, so a build directory costs nothing."
            control={
              <PGToggle
                data-testid="watch-filesystem"
                checked={s.watchFilesystem}
                onChange={(v) => s.set("watchFilesystem", v)}
              />
            }
          />
          <SettingsRow
            id="workspace.shell"
            label="Terminal shell"
            hint="The shell the built-in terminal runs, opened in the active repository's working directory. Leave blank to use the same shell as your own terminal ($SHELL, or PowerShell on Windows)."
            control={
              <PGInput
                data-testid="terminal-shell"
                value={s.terminalShell}
                placeholder="$SHELL"
                onChange={(v) => s.set("terminalShell", v)}
                style={{ width: 220 }}
              />
            }
          />
        </SettingsCard>

        <RemotePage />

        <DiffPage />

        <IntegrationsPage />
        <KeyboardPage />
        <CliSection />
        <UpdatesPage />
        <BackupSection />
        <DiagnosticsSection />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI SECTION — install/status for the `pgit` shim
// ═════════════════════════════════════════════════════════════════════════════

function CliSection() {
  const [status, setStatus] = React.useState<CliShimStatus | null>(null);
  const [manual, setManual] = React.useState<string | null>(null);
  const [pathState, setPathState] = React.useState<CliPathState | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    cliShimStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // No platform gate any more (#144): Windows writes a pgit.cmd and appends the
  // per-user PATH, so the old "not yet supported" row is gone rather than
  // conditional.
  React.useEffect(refresh, [refresh]);

  const install = async () => {
    setBusy(true);
    try {
      const out = await installCliShim();
      if (out.installed) {
        setManual(null);
        setPathState(out.pathState);
        // Deliberately doesn't repeat the shim path here — the status row
        // below shows it, and a toast echoing the same substring would
        // outlive the row's re-render (toast lives ~1.7s) and collide with
        // it in text queries.
        pgFlash("pgit installed");
        refresh();
      } else if (out.manualCommand) {
        setManual(out.manualCommand);
      }
    } catch {
      setManual(null);
    } finally {
      setBusy(false);
    }
  };

  const source = status?.source ?? "none";
  // A package manager owns the file — offering to overwrite it is the one thing
  // #144 says must not happen, so there is no button at all in that state.
  const packaged = source === "package";
  const effectivePathState = pathState ?? status?.pathState ?? null;

  return (
    <SettingsCard
      id="cli"
      title="Command line"
      subtitle="Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path]."
    >
      <SettingsRow
        id="cli.pgit"
        label="pgit command"
        hint={
          <>
            {packaged ? (
              <>
                Installed by your package manager at{" "}
                <Mono>{status?.shimPath}</Mono>. Updating platypusgit updates it
                too.
              </>
            ) : source === "app" ? (
              <>
                Installed at <Mono>{status?.shimPath}</Mono>
              </>
            ) : (
              <>
                Not installed.{" "}
                {source === "foreign" && (
                  <>
                    A different <Mono>pgit</Mono> is already on your PATH at{" "}
                    <Mono>{status?.shimPath}</Mono> — it will not be touched.{" "}
                  </>
                )}
                {manual && (
                  <>
                    Automatic install failed (permissions) — run:{" "}
                    <Mono selectable>{manual}</Mono>
                  </>
                )}
              </>
            )}
            <PathNote
              state={packaged ? null : effectivePathState}
              shimPath={status?.shimPath}
            />
          </>
        }
        control={
          packaged ? (
            <span />
          ) : (
            <PGButton size="sm" onClick={install} disabled={busy}>
              {source === "app" ? "Reinstall pgit" : "Install pgit"}
            </PGButton>
          )
        }
      />
    </SettingsCard>
  );
}

/**
 * Reaching the app's own log (#274).
 *
 * The log was always written and never reachable: diagnosing a report meant
 * telling someone an undocumented per-platform path and hoping. That failure
 * mode had a cost — a WSL repository that would not open produced four logged
 * sessions nobody could interpret, because the log could neither say which
 * machine wrote it nor that a call had been issued and never returned.
 *
 * So this panel does the three things a bug report needs: says where the log is,
 * opens it, and copies its tail with the environment header on top.
 */
function DiagnosticsSection() {
  const [report, setReport] = React.useState<DiagnosticsReport | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    diagnosticsReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  const copy = async () => {
    setBusy(true);
    try {
      const tail = await readLogTail();
      // The header goes ON the clipboard, not just on screen. A pasted tail may
      // not reach back far enough to include the startup `host …` line, and a
      // log whose platform is unknown is what made #274 hard to read in the
      // first place — so the copy carries its own provenance.
      const header = report
        ? `platypusgit ${report.version}\n${report.environment}\n${report.logPath}\n\n`
        : "";
      await navigator.clipboard?.writeText(`${header}${tail}`);
      pgFlash("Log tail copied");
    } catch (e) {
      pgFlash(appErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    try {
      await revealLogFile();
    } catch (e) {
      pgFlash(appErrorMessage(e));
    }
  };

  return (
    <SettingsCard
      id="diagnostics"
      title="Diagnostics"
      subtitle="The app's log — what to attach to a bug report."
    >
      <SettingsRow
        id="diagnostics.environment"
        label="Environment"
        hint={
          report ? (
            <Mono selectable>{report.environment}</Mono>
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
          report ? (
            <>
              <Mono selectable>{report.logPath}</Mono>
              {!report.logExists && " — not written yet"}
            </>
          ) : (
            "Reading…"
          )
        }
        control={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PGButton
              size="sm"
              onClick={copy}
              disabled={busy || !report?.logExists}
            >
              Copy last 500 lines
            </PGButton>
            <PGButton
              size="sm"
              onClick={reveal}
              disabled={!report?.logExists}
            >
              Show file
            </PGButton>
          </div>
        }
      />
    </SettingsCard>
  );
}

function Mono({
  children,
  selectable,
}: {
  children: React.ReactNode;
  selectable?: boolean;
}) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        ...(selectable ? { userSelect: "all" as const } : null),
      }}
    >
      {children}
    </code>
  );
}

/**
 * The PATH half of the answer. A shim in a directory the shell cannot see is
 * installed but unusable, so the state is surfaced with the line that fixes it
 * rather than hidden behind a successful install.
 */
function PathNote({
  state,
  shimPath,
}: {
  state: CliPathState | null;
  shimPath?: string;
}) {
  if (state === null || state === "onPath") return null;
  // dirname, without importing a path helper for one call.
  const dir = shimPath?.replace(/[/\\][^/\\]*$/, "") ?? "";
  if (state === "pathAdded") {
    return (
      <div style={{ marginTop: 4 }}>
        Added <Mono>{dir}</Mono> to your PATH — open a new terminal.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <Mono>{dir}</Mono> is not on your PATH. Add it:{" "}
      <Mono selectable>{`export PATH="${dir}:$PATH"`}</Mono>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BACKUP SECTION — export / import every setting as one file (#254)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The keymap lives in `useKeymapStore` under its own localStorage key, so this
 * screen is what bridges the two stores: it hands the active preset to the
 * export and applies the one an import reports. The settings store cannot read
 * it directly — `keymap/actions.ts` imports the settings store, so the reverse
 * import would be a cycle.
 */
function BackupSection() {
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

  return (
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
