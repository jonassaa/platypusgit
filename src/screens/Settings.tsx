import React from "react";
import {
  PGButton,
  PGButtonGroup,
  PGIcon,
  PGIconButton,
  PGInput,
  PGSelect,
  PGToggle,
  pgConfirm,
  pgFlash,
} from "@/design";
import {
  BUILTIN_THEMES,
  DENSITY_STEP_PX,
  THEME_COLOR_FIELDS,
  ZOOM_MAX,
  ZOOM_MIN,
  applyTheme,
  isValidDiffToolName,
  useSettingsStore,
  type SettingsImportReport,
  type ThemeColors,
  type ThemeDef,
  type ThemeFollowMode,
  type UpdateChannel,

  type UpdateCheckMode,
} from "@/features/settings/useSettingsStore";
import {
  DEFAULT_TICKET_PATTERN,
  isValidTicketPattern,
} from "@/features/commits/message";
import type { UpdateRefsMode } from "@/lib/types";
import { CustomActionsSettings } from "@/features/actions/CustomActionsSettings";
import { IdentityForm } from "@/features/commits/identity/IdentityForm";
import { SavedIdentities } from "@/features/commits/identity/SavedIdentities";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { HeadMarksControl } from "@/features/settings/HeadMarksControl";
import { ForgeSettings } from "@/features/forge/ForgeSettings";
import {
  cliShimStatus,
  diagnosticsReport,
  installCliShim,
  readLogTail,
  revealLogFile,
  type PullMode,
} from "@/lib/tauri";
import { relativeTime } from "@/lib/derive";
import { appErrorMessage } from "@/lib/errors";
import { STORE_MANAGED_NOTE } from "@/features/update/packageHint";
import {
  updatesManagedExternally,
  useUpdateStore,
} from "@/features/update/useUpdateStore";
import type {
  CliPathState,
  CliShimStatus,
  DiagnosticsReport,
} from "@/lib/types";
import { BUILTIN_PRESETS, useKeymapStore } from "@/features/keymap";

export function SettingsScreen() {
  const s = useSettingsStore();
  const active = s.getActiveTheme();

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

        <IdentitySection />
        <CustomActionsSection />

        <AppearanceSection active={active} />

        <Section
          title="Pull & fetch"
          subtitle="How platypusgit updates your local branches from their upstream."
        >
          <Row
            label="Default pull mode"
            hint={
              <>
                <strong>Rebase</strong> replays your local commits on top of
                origin (linear history).{" "}
                <strong>Merge</strong> creates a merge commit.{" "}
                <strong>Fast-forward only</strong> refuses to pull if your branch has diverged.
              </>
            }
            control={
              <PGButtonGroup
                size="sm"
                value={s.defaultPullMode}
                onChange={(v) => s.set("defaultPullMode", v as PullMode)}
                options={[
                  { value: "Rebase", label: "Rebase" },
                  { value: "Merge", label: "Merge" },
                  { value: "FastForward", label: "FF-only" },
                ]}
              />
            }
          />
          <Row
            label="Auto-stash before pull"
            hint="Stash dirty changes, pull, then pop the stash. Prevents the 'uncommitted changes' error."
            control={
              <PGToggle
                checked={s.autoStashBeforePull}
                onChange={(v) => s.set("autoStashBeforePull", v)}
              />
            }
          />
          <Row
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
          <Row
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
          <Row
            label="Auto-fetch"
            hint="Periodically run fetch in the background so ahead/behind counts stay fresh."
            control={
              <PGToggle
                checked={s.autoFetchEnabled}
                onChange={(v) => s.set("autoFetchEnabled", v)}
              />
            }
          />
          <Row
            label="Auto-fetch interval"
            hint="Minutes between background fetches."
            control={
              <PGInput
                type="number"
                value={String(s.autoFetchMinutes)}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(60, parseInt(v, 10) || 5));
                  s.set("autoFetchMinutes", n);
                }}
                style={{ width: 72 }}
                disabled={!s.autoFetchEnabled}
              />
            }
          />
          <Row
            label="Move dependent branches"
            hint="When rebasing, also move branches whose tips sit inside the range being replayed — git's rebase --update-refs, the thing that keeps a stack of small PRs from being orphaned. Follow git config uses this repository's own rebase.updateRefs. You are always asked first, and told which branches will move."
            control={
              <PGSelect
                data-testid="rebase-update-refs"
                value={s.rebaseUpdateRefs}
                onChange={(v) => s.set("rebaseUpdateRefs", v as UpdateRefsMode)}
                options={[
                  { value: "config", label: "Follow git config" },
                  { value: "always", label: "Always" },
                  { value: "never", label: "Never" },
                ]}
              />
            }
          />
          <Row
            label="Prune on fetch"
            hint="Remove local refs whose upstream branches have been deleted on the remote."
            control={
              <PGToggle
                checked={s.pruneOnFetch}
                onChange={(v) => s.set("pruneOnFetch", v)}
              />
            }
          />
        </Section>

        <Section
          title="Push safety"
          subtitle="Guardrails around destructive remote operations."
        >
          <Row
            label="Confirm force-push"
            hint="Ask for confirmation before a force or force-with-lease push."
            control={
              <PGToggle
                checked={s.confirmForcePush}
                onChange={(v) => s.set("confirmForcePush", v)}
              />
            }
          />
        </Section>

        <Section
          title="Commit"
          subtitle="Defaults applied when creating a new commit."
        >
          <Row
            label="Append Signed-off-by"
            hint="Appends a DCO-style trailer to every commit message."
            control={
              <PGToggle
                checked={s.addSignoff}
                onChange={(v) => s.set("addSignoff", v)}
              />
            }
          />
          <Row
            label="Ticket pattern"
            hint={
              <>
                Regular expression run over the BRANCH NAME to find a ticket key
                the commit composer offers as a one-click insert (#252). Capture
                group 1 wins when the pattern has one, so{" "}
                <code>issue-(\d+)</code> inserts just the number. Leave it empty
                for no chip. Nothing is inserted automatically.
              </>
            }
            control={
              <PGInput
                value={s.commitTicketPattern}
                onChange={(v) => s.set("commitTicketPattern", v)}
                // A pattern that will not compile means no chip and no
                // explanation, so the field says so while it is being typed.
                // `aria-invalid` alongside `error` because PGInput's `error` is
                // a border colour and nothing more — adding the attribute to the
                // shared primitive would restate the semantics of every input in
                // the app in a change that is not about that.
                error={!isValidTicketPattern(s.commitTicketPattern)}
                aria-invalid={!isValidTicketPattern(s.commitTicketPattern)}
                mono
                size="sm"
                placeholder={DEFAULT_TICKET_PATTERN}
                style={{ width: 220 }}
                data-testid="settings-ticket-pattern"
              />
            }
          />
          <Row
            label="Sign commits"
            hint="Uses gpg.format, user.signingkey and gpg.program. Following git config respects commit.gpgsign per repository; a signing failure fails the commit rather than producing an unsigned one."
            control={
              <PGSelect
                value={s.signCommits}
                onChange={(v) =>
                  s.set("signCommits", v as "config" | "always" | "never")
                }
                options={[
                  { value: "config", label: "Follow git config" },
                  { value: "always", label: "Always" },
                  { value: "never", label: "Never" },
                ]}
              />
            }
          />
        </Section>

        <Section title="Diff" subtitle="How diffs are rendered across the app.">
          <Row
            label="Layout"
            hint="Inline shows one column with added and removed lines interleaved. Split shows the old and new file side by side."
            control={
              <PGSelect
                value={s.diffViewMode}
                onChange={(v) => s.set("diffViewMode", v as "inline" | "split")}
                options={[
                  { value: "inline", label: "Inline" },
                  { value: "split", label: "Split" },
                ]}
              />
            }
          />
          <Row
            label="Show"
            hint="Whole file reads the file top to bottom with each change in place. Changed chunks shows only the hunks and their context lines. Either way, staging still applies exactly the hunks git would."
            control={
              <PGSelect
                value={s.diffContextMode}
                onChange={(v) =>
                  s.set("diffContextMode", v as "wholeFile" | "chunks")
                }
                options={[
                  { value: "wholeFile", label: "Whole file" },
                  { value: "chunks", label: "Changed chunks" },
                ]}
              />
            }
          />
          <Row
            label="Context lines"
            hint="Unchanged lines shown around each hunk in the changed-chunks view. Also the context every hunk stage/discard is computed against, so it applies in both views."
            control={
              <PGInput
                type="number"
                value={String(s.diffContextLines)}
                onChange={(v) => {
                  const n = Math.max(0, Math.min(20, parseInt(v, 10) || 3));
                  s.set("diffContextLines", n);
                }}
                style={{ width: 72 }}
              />
            }
          />
          <Row
            label="Ignore whitespace"
            hint="Hide whitespace-only changes when reviewing reformatted code. Hunk staging is unavailable while this is on — the filtered hunks aren't the ones git would apply."
            control={
              <PGToggle
                checked={s.ignoreWhitespaceInDiff}
                onChange={(v) => s.set("ignoreWhitespaceInDiff", v)}
              />
            }
          />
          <Row
            label="External diff tool"
            hint={
              <>
                Which tool &quot;Open in external diff tool&quot; hands a file
                to. Leave it empty and git decides, from{" "}
                <code>diff.guitool</code>, <code>diff.tool</code> or{" "}
                <code>merge.tool</code> — so anyone who has already configured
                one needs nothing here. A tool NAME, not a command line
                (<code>meld</code>, <code>bc</code>, <code>vimdiff</code>, or one
                you defined with <code>difftool.&lt;tool&gt;.cmd</code>).
              </>
            }
            control={
              <PGInput
                value={s.externalDiffTool}
                onChange={(v) => s.set("externalDiffTool", v)}
                // A command line here would fail inside git with a message
                // about a tool nobody configured, so the field says so while it
                // is being typed — same treatment as the ticket pattern above.
                error={!isValidDiffToolName(s.externalDiffTool)}
                aria-invalid={!isValidDiffToolName(s.externalDiffTool)}
                mono
                size="sm"
                placeholder="git decides"
                style={{ width: 220 }}
                data-testid="settings-external-diff-tool"
              />
            }
          />
        </Section>

        <ForgeSettings />
        <KeyboardSection />
        <CliSection />
        <UpdatesSection />
        <BackupSection />
        <DiagnosticsSection />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SECTION — keymap preset picker
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `user.name` / `user.email` (#212) — the one thing on this screen that is NOT
 * a platypusgit preference.
 *
 * It is here anyway, and first, because it is the only setting the app cannot
 * work without: git refuses to record a commit until both are set, and until
 * #212 there was nowhere in the app to set them. The subtitle says out loud
 * that this writes git's own config, since the page's own header promises
 * "preferences are saved locally".
 *
 * Reachable with no repository open, which is why `repoId` is optional all the
 * way down: a user who lands in Settings before opening anything still gets a
 * true answer, from the global + system chain.
 */
/**
 * User-defined commands (#225).
 *
 * Its own section rather than a row under something else: it is the one
 * Settings surface that spawns a process, and burying it would make the
 * "not a shell line" explanation easy to miss.
 */
function CustomActionsSection() {
  return (
    <Section
      title="Custom actions"
      subtitle="Your own commands, available from the command palette."
    >
      <Row label="Actions" stacked control={<CustomActionsSettings />} />
    </Section>
  );
}

function IdentitySection() {
  const repo = useRepoStore((s) => s.current);
  return (
    <Section
      title="Identity"
      subtitle="Who your commits are recorded as. Unlike everything else here, this is written to your git config — the same user.name and user.email git itself reads."
    >
      <Row
        label="Commit author"
        hint="git refuses to record a commit without both. The scope control decides whether saving writes this repository's own config or your global one."
        stacked
        control={<IdentityForm repoId={repo?.id ?? null} />}
      />
      <Row
        label="Saved identities"
        hint="Keep the identities you switch between — a work address and a personal one. Applying one writes it to the OPEN repository's config, so git and every hook agree with what you see here. Editing or removing an entry does not change repositories that already use it."
        stacked
        control={<SavedIdentities repoId={repo?.id ?? null} />}
      />
    </Section>
  );
}

function KeyboardSection() {
  const activePresetId = useKeymapStore((k) => k.activePresetId);
  return (
    <Section
      title="Keyboard"
      subtitle="Choose a keymap preset. Press ? anywhere to see the active bindings."
    >
      <Row
        label="Keymap"
        hint="Bindings apply across every screen. More presets coming."
        control={
          <PGSelect
            value={activePresetId}
            onChange={(v) => useKeymapStore.getState().setPreset(v)}
            options={BUILTIN_PRESETS.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            data-testid="keymap-preset-select"
          />
        }
      />
    </Section>
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
    <Section
      title="Command line"
      subtitle="Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path]."
    >
      <Row
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
    </Section>
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
    <Section
      title="Diagnostics"
      subtitle="The app's log — what to attach to a bug report."
    >
      <Row
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
      <Row
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
    </Section>
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

function UpdatesSection() {
  const settings = useSettingsStore();
  const status = useUpdateStore((s) => s.status);
  const info = useUpdateStore((s) => s.info);
  const error = useUpdateStore((s) => s.error);
  const openPanel = useUpdateStore((s) => s.openPanel);
  const check = useUpdateStore((s) => s.check);
  // Single source: the store owns the running version (seeded from getVersion,
  // and confirmed by check() from the backend's env!("CARGO_PKG_VERSION")).
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const loadCurrentVersion = useUpdateStore((s) => s.loadCurrentVersion);
  const loadCapability = useUpdateStore((s) => s.loadCapability);
  const capability = useUpdateStore((s) => s.capability);
  const off = settings.updateCheckMode === "never";
  const storeManaged = updatesManagedExternally(capability);

  React.useEffect(() => {
    void loadCurrentVersion();
    // Loaded HERE and not left to `check()` (#360): on a Microsoft Store install
    // this section must render no update controls at all, and with
    // `updateCheckMode: "never"` no check ever runs to discover that.
    void loadCapability();
  }, [loadCurrentVersion, loadCapability]);

  let statusNode: React.ReactNode = null;
  if (status === "up-to-date") {
    statusNode = <>You're on the latest version.</>;
  } else if (status === "available" && info) {
    statusNode = (
      <>
        Update available:{" "}
        <button
          type="button"
          onClick={openPanel}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--accent)",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          {info.latestVersion}
        </button>
      </>
    );
  } else if (status === "error" && error) {
    statusNode = <span style={{ color: "var(--git-removed)" }}>{error}</span>;
  }

  // A Microsoft Store install gets the version and nothing else (#360).
  //
  // Not a disabled version of the normal section, and not a hidden one either.
  // Disabled controls would still be three statements ABOUT updates from
  // outside the Store — "Automatically asks GitHub", a release channel, a
  // "Check for updates" button — which is what policy 10.2.5 is about; the
  // v0.4.0 submission failed on a notification, having installed nothing.
  // Removing the section entirely would leave the user who came here looking
  // for their version with no answer and no explanation of why the setting
  // other installs have is missing. So: the version, and one line naming who
  // does the updating.
  //
  // `updateCheckMode` and `updateChannel` keep their persisted values
  // untouched. They are portable preferences (#254 exports them) and this
  // install is simply not consulting them — the same reasoning that leaves the
  // channel control enabled when checks are off.
  if (storeManaged) {
    return (
      <div data-testid="settings-updates">
        <Section title="Updates">
          <Row
            label="Current version"
            hint={<div data-testid="update-store-managed">{STORE_MANAGED_NOTE}</div>}
            control={<Mono>{currentVersion || "…"}</Mono>}
          />
        </Section>
      </div>
    );
  }

  return (
    <div data-testid="settings-updates">
      <Section
        title="Updates"
        subtitle="Check whether a newer PlatypusGit release is available."
      >
        <Row
          label="Check for updates"
          hint={
            <>
              <strong>Automatically</strong> asks GitHub shortly after launch.{" "}
              <strong>Only when I ask</strong> never checks on its own — the
              button below still works. <strong>Never</strong> makes no request
              at all, from any part of the app.
            </>
          }
          control={
            <PGSelect
              data-testid="update-check-mode"
              value={settings.updateCheckMode}
              onChange={(v) =>
                settings.set("updateCheckMode", v as UpdateCheckMode)
              }
              options={[
                { value: "auto", label: "Automatically" },
                { value: "manual", label: "Only when I ask" },
                { value: "never", label: "Never" },
              ]}
            />
          }
        />
        <Row
          label="Release channel"
          hint={
            <>
              <strong>Stable</strong> offers published releases only.{" "}
              <strong>Include prereleases</strong> also offers release
              candidates — newer, and not yet shipped to everyone. It adds
              prereleases to what you are offered rather than restricting you to
              them, so a stable release still wins whenever it is the newest
              thing published. Switching back to Stable does not downgrade an
              install; it just stops offering the next candidate.
              {/*
                Left enabled when checks are off. The preference is still real —
                it persists and travels in a settings export — and a control
                that appeared and disappeared as the row above changed would be
                worse than one that is simply not consulted right now.
              */}
            </>
          }
          control={
            <PGSelect
              data-testid="update-channel"
              value={settings.updateChannel}
              onChange={(v) => settings.set("updateChannel", v as UpdateChannel)}
              options={[
                { value: "stable", label: "Stable" },
                { value: "prerelease", label: "Include prereleases" },
              ]}
            />
          }
        />
        <Row
          label="Current version"
          hint={
            <>
              <code style={{ fontFamily: "var(--font-mono)" }}>
                {currentVersion || "…"}
              </code>
              {statusNode && <> — {statusNode}</>}
              <div data-testid="update-last-checked" style={{ marginTop: 3 }}>
                {off ? (
                  // Not a dead end: the reason the button is disabled names the
                  // setting one row up, which is one click from "Only when I
                  // ask".
                  <>Update checks are turned off.</>
                ) : (
                  <>
                    Last checked:{" "}
                    {lastCheckedAt
                      ? relativeTime(Math.floor(lastCheckedAt / 1000))
                      : "never"}
                  </>
                )}
              </div>
            </>
          }
          control={
            <PGButton
              size="sm"
              onClick={() => check(true)}
              loading={status === "checking"}
              disabled={off}
              title={
                off ? "Update checks are turned off in Settings" : undefined
              }
            >
              Check for updates
            </PGButton>
          }
        />
      </Section>
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
    <Section
      title="Settings file"
      subtitle="Move every preference to another machine, or share a house style with your team."
    >
      <Row
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
      <Row
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
    </Section>
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

// ═════════════════════════════════════════════════════════════════════════════
// APPEARANCE SECTION — theme picker + color editor + import/export
// ═════════════════════════════════════════════════════════════════════════════

function AppearanceSection({ active }: { active: ThemeDef }) {
  const s = useSettingsStore();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isBuiltin = !!active.builtin;

  const [editor, setEditor] = React.useState<
    { kind: "new"; source: ThemeDef } | { kind: "edit"; id: string } | null
  >(null);

  const themeOptions = React.useMemo(() => {
    const builtins = BUILTIN_THEMES.map((t) => ({
      value: t.id,
      label: t.name,
    }));
    const customs = s.customThemes.map((t) => ({
      value: t.id,
      label: `★ ${t.name}`,
    }));
    return [...builtins, ...customs];
  }, [s.customThemes]);

  // Each half of the pairing may only name a theme of its own mode — offering
  // a dark theme as "the light one" would let the user build a pairing that
  // never switches.
  const pairOptions = React.useMemo(() => {
    const of = (mode: "dark" | "light") => [
      ...BUILTIN_THEMES.filter((t) => t.mode === mode).map((t) => ({
        value: t.id,
        label: t.name,
      })),
      ...s.customThemes
        .filter((t) => t.mode === mode)
        .map((t) => ({ value: t.id, label: `★ ${t.name}` })),
    ];
    return { light: of("light"), dark: of("dark") };
  }, [s.customThemes]);

  const following = s.themePreference.mode === "system";

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const theme = s.importThemeJson(text);
      pgFlash(`Imported "${theme.name}"`);
    } catch (err) {
      pgFlash(`Import failed: ${appErrorMessage(err)}`);
    }
  };

  const onDelete = async () => {
    if (
      !(await pgConfirm({
        title: `Delete theme "${active.name}"?`,
        body: "Custom themes aren't recoverable unless you exported the file.",
        danger: true,
        confirmLabel: "Delete theme",
      }))
    )
      return;
    s.deleteTheme(active.id);
  };

  return (
    <Section
      title="Appearance"
      subtitle="Pick a theme, or customize every color and export it as a sharable file."
    >
      <Row
        label="Appearance"
        hint={
          following
            ? `Follows the OS — currently ${
                s.systemAppearance === "light" ? "light" : "dark"
              }. Pick the theme each half uses below.`
            : "One theme, always. Switch to “Follow system” to pair a light theme with a dark one."
        }
        control={
          <PGButtonGroup
            size="sm"
            value={s.themePreference.mode}
            onChange={(v) => s.setThemeFollowMode(v as ThemeFollowMode)}
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "system", label: "Follow system" },
            ]}
          />
        }
      />

      {following ? (
        <>
          <Row
            label="Light theme"
            hint="Applied while the OS is in light appearance."
            control={
              <PGSelect
                value={s.themePreference.lightId}
                onChange={(v) => s.setPairedThemeId("light", v)}
                options={pairOptions.light}
                size="sm"
                style={{ minWidth: 200 }}
              />
            }
          />
          <Row
            label="Dark theme"
            hint="Applied while the OS is in dark appearance."
            control={
              <PGSelect
                value={s.themePreference.darkId}
                onChange={(v) => s.setPairedThemeId("dark", v)}
                options={pairOptions.dark}
                size="sm"
                style={{ minWidth: 200 }}
              />
            }
          />
        </>
      ) : (
        <Row
          label="Theme"
          hint={
            isBuiltin
              ? "Built-in themes are read-only. Click “New custom theme” to fork and edit."
              : "Custom theme. Click “Edit custom theme” to change its colors."
          }
          control={
            <PGSelect
              value={active.id}
              onChange={(v) => s.setActiveThemeId(v)}
              options={themeOptions}
              size="sm"
              style={{ minWidth: 200 }}
            />
          }
        />
      )}

      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          background: "var(--bg-0)",
        }}
      >
        {!isBuiltin && (
          <PGButton
            size="sm"
            variant="primary"
            icon="edit"
            onClick={() => setEditor({ kind: "edit", id: active.id })}
          >
            Edit custom theme…
          </PGButton>
        )}
        <PGButton
          size="sm"
          variant={isBuiltin ? "primary" : "default"}
          icon="plus"
          onClick={() => setEditor({ kind: "new", source: active })}
          title="Create a new custom theme starting from the active one"
        >
          New custom theme…
        </PGButton>
        {!isBuiltin && (
          <PGButton
            size="sm"
            variant="default"
            icon="trash"
            onClick={() => void onDelete()}
          >
            Delete
          </PGButton>
        )}
        <div style={{ flex: 1 }} />
        <PGButton
          size="sm"
          variant="default"
          icon="download"
          onClick={() => s.downloadTheme(active.id)}
          title="Download as .pgtheme.json"
        >
          Export
        </PGButton>
        <PGButton
          size="sm"
          variant="default"
          icon="upload"
          onClick={onImportClick}
          title="Import a .pgtheme.json file"
        >
          Import…
        </PGButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json,.pgtheme.json"
          onChange={onImportFile}
          style={{ display: "none" }}
        />
      </div>

      <Row
        label="UI density"
        hint={`Compact matches the dense IDE feel; comfortable gives every list row ${DENSITY_STEP_PX.comfortable}px more breathing room.`}
        control={
          <PGButtonGroup
            size="sm"
            value={s.uiDensity}
            onChange={(v) => s.set("uiDensity", v as "compact" | "comfortable")}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
        }
      />

      <Row
        stacked
        label="Current position (HEAD)"
        hint="How History marks the commit you are on. Pick any combination of marks, then set how hard they hit — the preview is the real History row."
        control={<HeadMarksControl />}
      />

      <Row
        label="Zoom"
        hint={`Scales the whole window — ${Math.round(ZOOM_MIN * 100)}% to ${Math.round(
          ZOOM_MAX * 100,
        )}%. Also on ⌘/Ctrl with + and −, reset with ⌘/Ctrl 0.`}
        control={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PGIconButton
              icon="minus"
              size="md"
              title="Zoom out"
              onClick={() => s.stepZoom(-1)}
            />
            <span
              data-testid="settings-zoom-value"
              style={{
                minWidth: 48,
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--fg-1)",
              }}
            >
              {Math.round(s.uiZoom * 100)}%
            </span>
            <PGIconButton
              icon="plus"
              size="md"
              title="Zoom in"
              onClick={() => s.stepZoom(1)}
            />
            <PGButton
              size="sm"
              variant="ghost"
              disabled={s.uiZoom === 1}
              onClick={() => s.set("uiZoom", 1)}
            >
              Reset
            </PGButton>
          </div>
        }
      />

      {editor && (
        <ThemeEditorDialog
          mode={editor.kind}
          sourceTheme={
            editor.kind === "new"
              ? editor.source
              : (s.customThemes.find((t) => t.id === editor.id) ?? active)
          }
          onClose={() => setEditor(null)}
        />
      )}
    </Section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// THEME EDITOR DIALOG — color pickers live here, behind Add/Edit buttons.
// ═════════════════════════════════════════════════════════════════════════════

function ThemeEditorDialog({
  mode,
  sourceTheme,
  onClose,
}: {
  mode: "new" | "edit";
  sourceTheme: ThemeDef;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(
    mode === "new" ? `${sourceTheme.name} (custom)` : sourceTheme.name,
  );
  const [themeMode, setThemeMode] = React.useState<"dark" | "light">(sourceTheme.mode);
  const [colors, setColors] = React.useState<ThemeColors>({ ...sourceTheme.colors });

  // Capture the theme that was active on open, so Cancel can restore it.
  const originalActiveRef = React.useRef<ThemeDef | null>(null);
  if (originalActiveRef.current === null) {
    originalActiveRef.current = useSettingsStore.getState().getActiveTheme();
  }

  // Live preview: apply draft to CSS vars whenever it changes.
  React.useEffect(() => {
    applyTheme({
      id: "__draft__",
      name,
      mode: themeMode,
      colors,
    });
  }, [name, themeMode, colors]);

  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    // Restore the theme that was active before the dialog opened.
    const orig = originalActiveRef.current;
    if (orig) applyTheme(orig);
    onClose();
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      pgFlash("Theme name can't be empty");
      return;
    }
    const store = useSettingsStore.getState();
    if (mode === "new") {
      // Create a new custom theme, make it active.
      // First switch to source so saveAsNewTheme copies right colors — but we
      // have our own draft, so inject directly.
      const created = store.saveAsNewTheme(trimmed);
      // Overwrite its colors/mode with the draft.
      useSettingsStore.setState((st) => ({
        customThemes: st.customThemes.map((t) =>
          t.id === created.id
            ? { ...t, name: trimmed, mode: themeMode, colors: { ...colors } }
            : t,
        ),
      }));
      // Through the store, not just `setState`: the draft's dark/light toggle
      // may have flipped the mode the duplicate inherited, and in "follow the
      // system" mode that decides WHICH half of the pairing this theme is.
      useSettingsStore.getState().setActiveThemeId(created.id);
      // Re-apply so the saved version is what's showing.
      applyTheme({
        ...created,
        name: trimmed,
        mode: themeMode,
        colors,
      });
      pgFlash(`Saved "${trimmed}"`);
    } else {
      // Edit existing custom theme.
      useSettingsStore.setState((st) => ({
        customThemes: st.customThemes.map((t) =>
          t.id === sourceTheme.id
            ? { ...t, name: trimmed, mode: themeMode, colors: { ...colors } }
            : t,
        ),
      }));
      useSettingsStore.getState().setActiveThemeId(sourceTheme.id);
      applyTheme({
        ...sourceTheme,
        name: trimmed,
        mode: themeMode,
        colors,
      });
      pgFlash(`Saved "${trimmed}"`);
    }
    onClose();
  };

  const handleResetColors = () => {
    setColors({ ...sourceTheme.colors });
    setThemeMode(sourceTheme.mode);
  };

  const patch = (p: Partial<ThemeColors>) =>
    setColors((c) => ({ ...c, ...p }));

  return (
    <div
      onClick={handleCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "new" ? "New custom theme" : "Edit custom theme"}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-5)",
          boxShadow: "var(--shadow-3)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-0)",
            background: "var(--bg-2)",
          }}
        >
          <PGIcon name="edit" size={14} style={{ color: "var(--accent)" }} />
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--fg-1)",
              fontWeight: 600,
            }}
          >
            {mode === "new" ? "New custom theme" : "Edit custom theme"}
          </div>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={handleResetColors}>
            Revert changes
          </PGButton>
        </header>

        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-0)" }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                minWidth: 240,
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-12)",
                  color: "var(--fg-2)",
                  width: 48,
                  flexShrink: 0,
                }}
              >
                Name
              </span>
              <PGInput
                value={name}
                onChange={setName}
                placeholder="My cool theme"
                style={{ flex: 1 }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}>
                Mode
              </span>
              <PGButtonGroup
                size="sm"
                value={themeMode}
                onChange={(v) => setThemeMode(v as "dark" | "light")}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </div>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
            }}
          >
            Changes preview live. Cancel to discard, Save to keep.
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <ColorEditor colors={colors} onPatch={patch} />
        </div>

        <footer
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-0)",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: "var(--bg-2)",
          }}
        >
          <PGButton
            size="sm"
            variant="default"
            icon="download"
            onClick={() => {
              // Export the current draft without saving.
              const payload = JSON.stringify(
                {
                  $schema: "https://platypusgit.dev/theme.schema.json",
                  version: 1,
                  name,
                  mode: themeMode,
                  colors,
                },
                null,
                2,
              );
              const slug = (name || "theme")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");
              const blob = new Blob([payload], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${slug || "theme"}.pgtheme.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            Export draft
          </PGButton>
          <div style={{ flex: 1 }} />
          <PGButton size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </PGButton>
          <PGButton size="sm" variant="primary" icon="check" onClick={handleSave}>
            {mode === "new" ? "Create theme" : "Save changes"}
          </PGButton>
        </footer>
      </div>
    </div>
  );
}

function ColorEditor({
  colors,
  onPatch,
}: {
  colors: ThemeColors;
  onPatch: (p: Partial<ThemeColors>) => void;
}) {
  const groups: Array<{
    title: string;
    group: "background" | "foreground" | "border" | "accent" | "logo";
  }> = [
    { title: "Backgrounds", group: "background" },
    { title: "Text", group: "foreground" },
    { title: "Borders", group: "border" },
    { title: "Accent", group: "accent" },
    { title: "Logo", group: "logo" },
  ];

  return (
    <div style={{ padding: "14px 16px 18px" }}>
      {groups.map((g) => (
        <div key={g.group} style={{ marginTop: g.group === "background" ? 0 : 16 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-10)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--fg-2)",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {g.title}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 8,
            }}
          >
            {THEME_COLOR_FIELDS.filter((f) => f.group === g.group).map((f) => (
              <ColorField
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={colors[f.key]}
                onChange={(v) =>
                  onPatch({ [f.key]: v } as Partial<ThemeColors>)
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const commitHex = (v: string) => {
    const normalized = normalizeHex(v);
    if (!normalized) return;
    onChange(normalized);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-1)",
      }}
      title={hint}
    >
      <label
        style={{
          position: "relative",
          width: 28,
          height: 28,
          borderRadius: "var(--r-3)",
          border: "1px solid var(--border-1)",
          background: value,
          cursor: "pointer",
          flexShrink: 0,
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            border: "none",
          }}
        />
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div style={{ marginTop: 2 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitHex(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitHex(draft);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setDraft(value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-11)",
              padding: 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function normalizeHex(v: string): string | null {
  const raw = v.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

// ─── Shared layout helpers ───────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: 20,
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-4)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border-0)",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--fg-1)",
            fontWeight: 600,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--fs-12)",
              color: "var(--fg-3)",
            }}
          >
            {subtitle}
          </div>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

/**
 * `stacked` puts the control on its own full-width line under the label. The
 * inline layout gives the control whatever width it asks for (`flexShrink: 0`),
 * which is right for a button group or a select but crushes the label column to
 * a word per line once the control is intrinsically wide — a live preview of a
 * real History row, say.
 */
function Row({
  label,
  hint,
  control,
  stacked,
}: {
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "flex-start",
        gap: stacked ? 10 : 16,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-13)",
            color: "var(--fg-0)",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 3,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={stacked ? { minWidth: 0 } : { flexShrink: 0, paddingTop: 2 }}>{control}</div>
    </div>
  );
}

