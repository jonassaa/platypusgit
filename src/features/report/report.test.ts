import { describe, expect, it } from "vitest";

import {
  buildReport,
  issueUrl,
  MAX_URL_LEN,
  PASTE_MARKER,
  type ReportParts,
} from "./report";

const PARTS: ReportParts = {
  version: "0.8.0",
  environment: "host os=macos arch=aarch64 git=2.49.0",
  logPath: "/Users/x/Library/Logs/com.platypusgit.app/platypusgit.log",
  logTail: "11:02 INFO open_repo /tmp/r\n11:02 WARN invoke fetch slow: 1400ms",
  includeEnvironment: true,
  includeLog: true,
};

describe("buildReport", () => {
  it("always names the build, whatever else is excluded", () => {
    const text = buildReport({
      ...PARTS,
      includeEnvironment: false,
      includeLog: false,
    });
    expect(text).toContain("platypusgit 0.8.0");
    // A report whose build is unknown cannot be acted on, so the version line
    // is not one of the opt-outs.
    expect(text).not.toContain("host os=macos");
    expect(text).not.toContain("invoke fetch");
  });

  it("includes the environment line only when asked", () => {
    expect(buildReport(PARTS)).toContain(
      "host os=macos arch=aarch64 git=2.49.0",
    );
    expect(buildReport({ ...PARTS, includeEnvironment: false })).not.toContain(
      "host os=macos",
    );
  });

  it("includes the log tail and its path only when asked", () => {
    const withLog = buildReport(PARTS);
    expect(withLog).toContain("invoke fetch slow: 1400ms");
    expect(withLog).toContain(PARTS.logPath);

    const without = buildReport({ ...PARTS, includeLog: false });
    expect(without).not.toContain("invoke fetch slow");
    expect(without).not.toContain(PARTS.logPath);
  });

  it("omits the log section entirely when the tail could not be read", () => {
    // A failed `read_log_tail` must not produce a section header with nothing
    // under it — that reads like an empty log rather than an unread one.
    const text = buildReport({ ...PARTS, logTail: null });
    expect(text).not.toContain(PARTS.logPath);
    expect(text).toContain("platypusgit 0.8.0");
    expect(text).toContain("host os=macos");
  });

  it("does not hardcode the backend's tail line count", () => {
    // TAIL_LINES lives in commands/diagnostics.rs. Repeating "500" here is a
    // second copy of a constant this side cannot see change.
    expect(buildReport(PARTS)).not.toContain("500");
  });
});

describe("issueUrl", () => {
  const BASE = {
    version: "0.8.0",
    environment: "host os=linux arch=x86_64 git=2.43.0",
  };

  it("targets the project's issue tracker with the bug label", () => {
    const u = new URL(issueUrl({ ...BASE, summary: "Fetch hangs" }));
    expect(u.origin + u.pathname).toBe(
      "https://github.com/jonassaa/platypusgit/issues/new",
    );
    expect(u.searchParams.get("labels")).toBe("bug");
  });

  it("titles the issue from the summary's first line, template-style", () => {
    const u = new URL(
      issueUrl({ ...BASE, summary: "Fetch hangs forever\nand then crashes" }),
    );
    expect(u.searchParams.get("title")).toBe("[bug] Fetch hangs forever");
  });

  it("still produces a usable title for an empty summary", () => {
    const u = new URL(issueUrl({ ...BASE, summary: "" }));
    expect(u.searchParams.get("title")).toBe("[bug]");
  });

  it("mirrors the bug_report.md headings and carries the paste marker", () => {
    const body = new URL(
      issueUrl({ ...BASE, summary: "Fetch hangs" }),
    ).searchParams.get("body")!;
    for (const heading of [
      "## Describe the bug",
      "## Steps to reproduce",
      "## Expected behavior",
      "## Actual behavior",
      "## Environment",
      "## Additional context",
    ]) {
      expect(body).toContain(heading);
    }
    expect(body).toContain("Fetch hangs");
    expect(body).toContain(PASTE_MARKER);
  });

  it("prefills Environment with the small, bounded facts", () => {
    const body = new URL(issueUrl({ ...BASE, summary: "x" })).searchParams.get(
      "body",
    )!;
    expect(body).toContain("0.8.0");
    expect(body).toContain("host os=linux arch=x86_64 git=2.43.0");
  });

  it("never carries a log tail — that is what the clipboard is for", () => {
    const url = issueUrl({ ...BASE, summary: "x" });
    expect(url).not.toContain("invoke");
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LEN);
  });

  it("stays inside the URL budget however long the summary is", () => {
    // GitHub answers a long enough query string with 414, so the button must
    // not be able to produce one. 40k of prose is a plausible paste.
    const url = issueUrl({ ...BASE, summary: "wall of text ".repeat(4000) });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LEN);
    expect(new URL(url).searchParams.get("body")).toContain("…");
  });

  it("stays inside the budget when the summary is mostly escapes", () => {
    // A newline costs three URL bytes and appears in both title and body, so
    // shrinking by character count alone can undershoot. `a\n` rather than a
    // bare `\n`: a summary of pure whitespace trims to empty and never reaches
    // the truncation loop at all, which would make this assertion vacuous.
    const summary = "a\n".repeat(9000);
    expect(summary.trim().length).toBeGreaterThan(MAX_URL_LEN);
    const url = issueUrl({ ...BASE, summary });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LEN);
    expect(new URL(url).searchParams.get("body")).toContain("…");
  });

  it("truncates rather than dropping the summary wholesale", () => {
    // The loop must land on a real prefix. Shrinking straight to "" would also
    // satisfy the budget, and would silently throw away what the user wrote.
    const url = issueUrl({
      ...BASE,
      summary: `Fetch hangs forever. ${"detail ".repeat(3000)}`,
    });
    const body = new URL(url).searchParams.get("body")!;
    expect(body).toContain("Fetch hangs forever.");
    expect(body).toContain("detail");
    expect(url.length).toBeGreaterThan(MAX_URL_LEN - 500);
  });

  it("fits the skeleton even with no summary at all", () => {
    // The truncation loop's floor. If this ever exceeds the budget, no amount
    // of trimming the summary can save it.
    expect(issueUrl({ ...BASE, summary: "" }).length).toBeLessThanOrEqual(
      MAX_URL_LEN,
    );
  });
});
