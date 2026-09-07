/**
 * Assembling a bug report, and the URL that files it.
 *
 * Pure on purpose: no React, no IPC, no clipboard. Every branch here is
 * reachable from a unit test with no jsdom and no mocks, which matters because
 * one of the callers is the error boundary — a surface that runs when the React
 * tree below it has already been unmounted, and that therefore cannot be
 * exercised through the dialog at all.
 *
 * The one non-obvious rule is the SPLIT. A GitHub `issues/new?body=…` URL is
 * the obvious place to put the whole report, and it does not fit: GitHub
 * answers a long enough query string with HTTP 414, and the practical ceiling
 * is around 8 KB of URL, while `read_log_tail` returns up to `TAIL_CAP_BYTES`.
 * Putting the log in the URL therefore works in testing, where the log is
 * short, and fails on exactly the machine that has been running long enough to
 * have a bug worth reporting. So the small bounded facts go in the URL and the
 * unbounded report goes on the clipboard, with a marker in the body saying so.
 */

/** Where this app's own issues live. */
const ISSUES_URL = "https://github.com/jonassaa/platypusgit/issues/new";

/**
 * The ceiling the finished URL must stay under.
 *
 * 6000 rather than the ~8 KB where GitHub actually answers 414: the margin
 * covers a long environment line, and it covers GitHub moving the limit
 * without this app finding out from a 414 in someone else's browser.
 */
export const MAX_URL_LEN = 6000;

/** What the body asks the reporter to do with their clipboard. */
export const PASTE_MARKER =
  "<!-- Paste the diagnostics report from your clipboard here (Cmd/Ctrl+V) -->";

/**
 * The log section's rule.
 *
 * Deliberately does NOT say "last 500 lines": that count is `TAIL_LINES` in
 * `commands/diagnostics.rs`, and a second copy on this side is a constant that
 * silently stops being true.
 */
const LOG_RULE = "── log tail ──";

/** How long a title may get before GitHub's own field does the trimming. */
const MAX_TITLE_LEN = 120;

export interface ReportParts {
  /** The running build. */
  version: string;
  /** The startup `host os=… arch=… git=…` line. */
  environment: string;
  /** Absolute path the tail was read from — provenance for a pasted excerpt. */
  logPath: string;
  /** The tail itself, or `null` when it could not be read. */
  logTail: string | null;
  includeEnvironment: boolean;
  includeLog: boolean;
}

/**
 * The pasteable block, in the order a reader wants it.
 *
 * The version line is not one of the opt-outs: a report whose build is unknown
 * cannot be acted on. Everything else is the user's choice, and an excluded
 * section is ABSENT rather than present-and-empty — a `── log tail ──` rule
 * with nothing under it reads like an empty log rather than an unread one.
 */
export function buildReport(parts: ReportParts): string {
  const lines: string[] = [`platypusgit ${parts.version}`];
  if (parts.includeEnvironment) lines.push(parts.environment);
  if (parts.includeLog && parts.logTail) {
    lines.push(parts.logPath, "", LOG_RULE, parts.logTail);
  }
  return lines.join("\n");
}

/** `[bug] ` + the summary's first line, matching `bug_report.md`'s front matter. */
function issueTitle(summary: string): string {
  const first = summary.split("\n")[0]?.trim() ?? "";
  return first ? `[bug] ${first.slice(0, MAX_TITLE_LEN)}` : "[bug]";
}

/**
 * The body, mirroring `.github/ISSUE_TEMPLATE/bug_report.md`.
 *
 * Written here rather than fetched by passing `template=`: given both
 * `template` and `body`, the two contend for the same field, and which one
 * wins is GitHub's business rather than something this app should depend on.
 */
function issueBody(
  summary: string,
  version: string,
  environment: string,
): string {
  return [
    "## Describe the bug",
    "",
    summary || "<!-- What went wrong? -->",
    "",
    "## Steps to reproduce",
    "",
    "1. …",
    "2. …",
    "3. …",
    "",
    "## Expected behavior",
    "",
    "## Actual behavior",
    "",
    "## Environment",
    "",
    `- platypusgit version: ${version}`,
    `- ${environment}`,
    "",
    "## Additional context",
    "",
    PASTE_MARKER,
    "",
  ].join("\n");
}

function build(
  summary: string,
  opts: { version: string; environment: string },
): string {
  const u = new URL(ISSUES_URL);
  u.searchParams.set("labels", "bug");
  u.searchParams.set("title", issueTitle(summary));
  u.searchParams.set("body", issueBody(summary, opts.version, opts.environment));
  return u.toString();
}

/**
 * The prefilled issue URL, guaranteed to fit inside {@link MAX_URL_LEN}.
 *
 * The summary is the only unbounded part, so it is the only part trimmed. The
 * loop shrinks rather than computing a length: percent-encoding makes a
 * character's cost variable — a newline is three bytes and appears in BOTH the
 * title and the body — so arithmetic alone cannot land it in one pass.
 */
export function issueUrl(opts: {
  summary: string;
  version: string;
  environment: string;
}): string {
  const summary = opts.summary.trim();
  const full = build(summary, opts);
  if (full.length <= MAX_URL_LEN) return full;

  let keep = summary.length;
  while (keep > 0) {
    const candidate = build(`${summary.slice(0, keep)}…`, opts);
    if (candidate.length <= MAX_URL_LEN) return candidate;
    const over = candidate.length - MAX_URL_LEN;
    // Nine is the worst case for one character of UTF-8 in a query string
    // (three bytes, percent-encoded, in two fields), so this never overshoots
    // past the answer — it only ever needs another pass.
    keep = Math.max(0, keep - Math.max(1, Math.ceil(over / 9)));
  }
  return build("", opts);
}
