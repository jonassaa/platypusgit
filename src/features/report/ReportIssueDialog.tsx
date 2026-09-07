/**
 * The Report an issue dialog.
 *
 * Mounted ONCE, by `AppShell`, beside `PGDialogHost`. Settings is a screen
 * inside `AppShell`, so that single mount serves three of the four entry points
 * (titlebar, error banner, Settings). The fourth — `PGErrorBoundary` — sits
 * ABOVE this mount and cannot use it at all; see `fileReport.ts::fileBugReport`.
 *
 * The preview is the point. This is the most revealing text the app ever
 * assembles in one place — a log tail carries repository paths, branch names,
 * remote URLs and hook output — so the dialog renders the exact string that
 * will be copied, in full, and each part is independently opt-out. Nothing is
 * ever sent anywhere: the clipboard is written and a URL is handed to the
 * user's own browser.
 */
import React from "react";

import { PGButton, PGCheckbox, PGModal, pgFlash } from "@/design";
import { appErrorMessage } from "@/lib/errors";
import { useAction } from "@/features/keymap/useAction";

import { buildReport } from "./report";
import {
  copyAndOpenIssue,
  copyReport,
  gatherReport,
  type ReportSources,
} from "./fileReport";
import { useReportStore } from "./useReportStore";

export function ReportIssueDialog() {
  const open = useReportStore((s) => s.open);
  const seed = useReportStore((s) => s.seed);
  const close = useReportStore((s) => s.closeReport);

  const [summary, setSummary] = React.useState("");
  const [withEnv, setWithEnv] = React.useState(true);
  const [withLog, setWithLog] = React.useState(true);
  const [sources, setSources] = React.useState<ReportSources | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Escape goes through the keymap so it stays in the cheat sheet and honours
  // rebinding — never a local capture-phase listener (issue #47's rule).
  useAction(
    "app.closeOverlay",
    () => {
      if (!open) return false;
      close();
      return true;
    },
    [open, close],
  );

  // A fresh open is a fresh report: whatever the entry point knows goes in the
  // box, last time's text does not linger, and the diagnostics are re-read
  // rather than served from a snapshot of an earlier session.
  React.useEffect(() => {
    if (open) {
      setSummary(seed);
      setSources(null);
      setWithEnv(true);
      setWithLog(true);
    }
  }, [open, seed]);

  // The log is read whatever the checkbox says, because the PREVIEW is what
  // the checkbox filters: the user has to be able to see what they are about
  // to include before deciding. Re-reading on every toggle would make the box
  // feel slow for no gain.
  React.useEffect(() => {
    if (!open || sources) return;
    let live = true;
    gatherReport(true)
      .then((s) => {
        if (live) setSources(s);
      })
      .catch((e) => {
        if (live) pgFlash(appErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [open, sources]);

  if (!open) return null;

  const parts = {
    version: sources?.version ?? "",
    environment: sources?.environment ?? "",
    logPath: sources?.logPath ?? "",
    logTail: sources?.logTail ?? null,
    includeEnvironment: withEnv,
    includeLog: withLog,
  };
  const preview = sources ? buildReport(parts) : "Reading diagnostics…";

  const onCopy = async () => {
    setBusy(true);
    try {
      await copyReport(parts);
      pgFlash("Report copied");
    } catch (e) {
      pgFlash(appErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onCopyAndOpen = async () => {
    setBusy(true);
    try {
      await copyAndOpenIssue({ ...parts, summary });
      close();
    } catch (e) {
      // Deliberately stays open on failure: the report is still assembled and
      // still copyable by hand, and closing would throw away what was typed.
      pgFlash(appErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PGModal onCancel={close} width={620} dismissable={!busy}>
      <div
        data-testid="report-dialog"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>
          Report an issue
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}>
            What went wrong?
          </span>
          <textarea
            data-testid="report-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            style={{
              resize: "vertical",
              background: "var(--bg-1)",
              color: "var(--fg-0)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-2)",
              padding: 8,
              fontSize: "var(--fs-12)",
              fontFamily: "inherit",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 16 }}>
          <PGCheckbox
            checked={withEnv}
            onChange={setWithEnv}
            label="Include environment"
            testId="report-include-env"
          />
          <PGCheckbox
            checked={withLog}
            onChange={setWithLog}
            label="Include log tail"
            testId="report-include-log"
          />
        </div>

        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
          This goes on your clipboard — nothing is sent anywhere. Paste it into
          the issue GitHub opens.
        </div>
        <pre
          data-testid="report-preview"
          style={{
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            background: "var(--bg-1)",
            border: "1px solid var(--border-0)",
            borderRadius: "var(--r-2)",
            padding: 8,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {preview}
        </pre>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <PGButton
            size="sm"
            variant="ghost"
            onClick={close}
            disabled={busy}
            data-testid="report-cancel"
          >
            Cancel
          </PGButton>
          <PGButton
            size="sm"
            icon="copy"
            onClick={onCopy}
            disabled={busy || !sources}
            data-testid="report-copy"
          >
            Copy report
          </PGButton>
          <PGButton
            size="sm"
            variant="primary"
            icon="external"
            onClick={onCopyAndOpen}
            disabled={busy || !sources}
            data-testid="report-open"
          >
            Copy &amp; open GitHub
          </PGButton>
        </div>
      </div>
    </PGModal>
  );
}
