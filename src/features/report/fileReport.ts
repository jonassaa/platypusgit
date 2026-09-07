/**
 * The side effects: reading the diagnostics, writing the clipboard, opening
 * the browser.
 *
 * Split from `report.ts` so that the text assembly stays pure, and split from
 * `ReportIssueDialog` so that a caller with no React tree can still file a
 * report. That caller is `PGErrorBoundary`, which runs precisely when the tree
 * below it has been unmounted — see {@link fileBugReport}.
 *
 * Nothing here makes a network request. The clipboard is written and a URL is
 * handed to `openUrl`, which is the user's own browser.
 */
import { diagnosticsReport, openUrl, readLogTail } from "@/lib/tauri";

import { buildReport, issueUrl, type ReportParts } from "./report";

/** Everything a report is assembled from, as read off this machine. */
export interface ReportSources {
  version: string;
  environment: string;
  logPath: string;
  /** `null` when the log could not be read — see {@link gatherReport}. */
  logTail: string | null;
}

/**
 * Read the facts a report is built from.
 *
 * A failing `read_log_tail` is NOT an error here. A fresh install has no log
 * file at all, and an environment-only report is worth more than no report, so
 * the tail degrades to `null` and `buildReport` drops the section rather than
 * emitting a header with nothing under it.
 */
export async function gatherReport(includeLog: boolean): Promise<ReportSources> {
  const diag = await diagnosticsReport();
  let logTail: string | null = null;
  if (includeLog) {
    try {
      logTail = await readLogTail();
    } catch {
      logTail = null;
    }
  }
  return {
    version: diag.version,
    environment: diag.environment,
    logPath: diag.logPath,
    logTail,
  };
}

/** Put the assembled report on the clipboard. Throws if it cannot. */
export async function copyReport(parts: ReportParts): Promise<void> {
  const clip = navigator.clipboard;
  // Not optional-chained into silence: a caller that is told the copy
  // succeeded will send the user to a form asking them to paste.
  if (!clip) throw new Error("This webview has no clipboard access");
  await clip.writeText(buildReport(parts));
}

/**
 * Copy the report, then open the prefilled issue. In that order.
 *
 * The order is the feature: the body carries a marker asking the reporter to
 * paste, so the clipboard has to be loaded before GitHub is on screen. A
 * failed copy therefore does NOT open the browser — that would send someone to
 * a form whose instructions they cannot follow.
 */
export async function copyAndOpenIssue(
  parts: ReportParts & { summary: string },
): Promise<void> {
  await copyReport(parts);
  await openUrl(
    issueUrl({
      summary: parts.summary,
      version: parts.version,
      environment: parts.environment,
    }),
  );
}

/**
 * Gather, copy and open — the whole flow in one call, with everything included.
 *
 * For a caller that cannot render the dialog. `PGDialogHost` and
 * `ReportIssueDialog` both mount inside `AppShell`, which mounts inside
 * `PGErrorBoundary`; after a render throw React has unmounted that whole
 * subtree, so there is no dialog to open and nothing subscribed to
 * `useReportStore`. Calling `openReport()` from the boundary would set a flag
 * nobody reads.
 */
export async function fileBugReport(summary: string): Promise<void> {
  const src = await gatherReport(true);
  await copyAndOpenIssue({
    ...src,
    summary,
    includeEnvironment: true,
    includeLog: src.logTail !== null,
  });
}
