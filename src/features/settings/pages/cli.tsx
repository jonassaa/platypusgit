import React from "react";
import { PGButton, pgFlash } from "@/design";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import { Mono, PathNote } from "@/features/settings/layout/text";
import type { SettingsPageMeta } from "@/features/settings/nav/types";
import { cliShimStatus, installCliShim } from "@/lib/tauri";
import type { CliPathState, CliShimStatus } from "@/lib/types";

export const meta: SettingsPageMeta = {
  id: "advanced.cli",
  group: "advanced",
  title: "Command line",
  icon: "terminal",
  cards: [
    {
      id: "cli",
      title: "Command line",
      subtitle: "Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path].",
      rows: [{ id: "cli.pgit", label: "pgit command", keywords: "shim install path terminal launch binary symlink" }],
    },
  ],
};

export function CliPage() {
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
