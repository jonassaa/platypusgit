# In-app issue reporter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user file a diagnosable GitHub bug report from inside the app — the report assembled for them, shown in full, copied to the clipboard, with a prefilled issue open in their browser.

**Architecture:** A new `src/features/report/` directory splits pure text assembly (`report.ts`) from side effects (`fileReport.ts`) from surface (`ReportIssueDialog.tsx` + `useReportStore.ts`). The log travels by clipboard because a GitHub `issues/new?body=` URL 414s far below the size of a log tail. Four entry points; three drive one dialog mounted in `AppShell`, and the error boundary — which sits *above* the dialog host and so cannot use it — calls `fileBugReport` through a new optional prop.

**Tech Stack:** React 19 + TypeScript, Zustand, vitest (`unit` jsdom project + `docs` node project), the existing `commands/diagnostics.rs` Tauri commands. No new backend code, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-issue-report-spec.md`

## Global Constraints

- **Toolchain.** Node 22 + pnpm at `~/Library/pnpm`, Rust at `~/.cargo/bin`. This session is worktree-isolated, so `export PATH=…` is refused — invoke `~/Library/pnpm/pnpm` by absolute path.
- **No new backend work.** `diagnostics_report`, `read_log_tail` and `open_url` already exist and are already wrapped in `src/lib/tauri.ts`. Do not add a Tauri command.
- **Repository slug is `jonassaa/platypusgit`.** Issues URL base: `https://github.com/jonassaa/platypusgit/issues/new`.
- **`MAX_URL_LEN = 6000`.** The finished URL must never exceed it (GitHub answers a long query string with HTTP 414).
- **Icons:** `src/design/icons.tsx` is the ONLY file that may import `lucide-react`, and every call-site string literal must be a declared `IconName` member (`test/iconSet.test.ts` fails the build for either).
- **No native `<select>`/`<option>`**, no `window.confirm`/`window.prompt`, no `Command::new` outside `proc.rs`. Guard tests enforce all three.
- **No hardcoded accent hue** — CSS vars / theme tokens only (`var(--fg-2)`, `var(--bg-1)`, …).
- **Escape** is the keymap's job: `useAction("app.closeOverlay", …)`, never a local capture-phase listener.
- **`src/design/` performs no IPC.** No file under `src/design/` may import `@/lib/tauri`. Check before committing: `grep -rn 'lib/tauri' src/design/` must stay empty.
- **Errors** surface via `pgFlash(appErrorMessage(e))`, matching the diagnostics buttons this feature sits beside.
- **Commit style:** `feat(report): …` / `test: …` / `docs: …`, imperative subject under 72 chars, optional `**Why:**` body, trailing `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Test commands:** `~/Library/pnpm/pnpm test` (whole suite), `~/Library/pnpm/pnpm vitest run <path>` (one file), `~/Library/pnpm/pnpm tsc --noEmit` (typecheck).

---

### Task 1: The pure report module

**Files:**
- Create: `src/features/report/report.ts`
- Test: `src/features/report/report.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ReportParts { version: string; environment: string; logPath: string; logTail: string | null; includeEnvironment: boolean; includeLog: boolean }`
  - `function buildReport(parts: ReportParts): string`
  - `function issueUrl(opts: { summary: string; version: string; environment: string }): string`
  - `const MAX_URL_LEN = 6000`
  - `const PASTE_MARKER: string`

- [ ] **Step 1: Write the failing test**

Create `src/features/report/report.test.ts`:

```ts
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
    expect(buildReport(PARTS)).toContain("host os=macos arch=aarch64 git=2.49.0");
    expect(
      buildReport({ ...PARTS, includeEnvironment: false }),
    ).not.toContain("host os=macos");
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
  const BASE = { version: "0.8.0", environment: "host os=linux arch=x86_64 git=2.43.0" };

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
    const body = new URL(
      issueUrl({ ...BASE, summary: "x" }),
    ).searchParams.get("body")!;
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

  it("stays inside the budget when the summary is all multi-byte escapes", () => {
    // A newline costs three URL bytes and appears in both title and body, so
    // shrinking by character count alone can undershoot.
    const url = issueUrl({ ...BASE, summary: "\n".repeat(9000) });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LEN);
  });

  it("fits the skeleton even with no summary at all", () => {
    // The truncation loop's floor. If this ever exceeds the budget, no amount
    // of trimming the summary can save it.
    expect(issueUrl({ ...BASE, summary: "" }).length).toBeLessThanOrEqual(
      MAX_URL_LEN,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/report.test.ts`
Expected: FAIL — `Failed to resolve import "./report"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/report/report.ts`:

```ts
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
 * The one unbounded input, and so the only thing ever trimmed.
 *
 * 6000 rather than the ~8 KB ceiling: the margin covers a long environment
 * line and GitHub moving the limit without this app finding out from a 414 in
 * someone else's browser.
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
function issueBody(summary: string, version: string, environment: string): string {
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
 * The prefilled issue URL, guaranteed to fit inside [`MAX_URL_LEN`].
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/report.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
~/Library/pnpm/pnpm tsc --noEmit
git add src/features/report/report.ts src/features/report/report.test.ts
git commit -m "$(cat <<'EOF'
feat(report): assemble a bug report and the URL that files it

**Why:** a GitHub issues/new?body= URL answers 414 well below the size of
a log tail, so the report splits by size — bounded facts in the URL, the
log on the clipboard. Pure and IPC-free because the error boundary needs
these builders on a surface that cannot mount a dialog.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The `bug` icon

**Files:**
- Modify: `src/design/icons.tsx` (the `lucide-react` import block, the `IconName` union, the `ICONS` record)

**Interfaces:**
- Consumes: nothing.
- Produces: `"bug"` as a member of `IconName`, renderable as `<PGIcon name="bug" />`.

- [ ] **Step 1: Run the existing guard to see it pass first**

Run: `~/Library/pnpm/pnpm vitest run test/iconSet.test.ts`
Expected: PASS. This is the baseline — the guard must still pass after the edit, and it is what will fail later if a call site names `"bug"` before the union declares it.

- [ ] **Step 2: Add the import**

In `src/design/icons.tsx`, add `Bug,` to the alphabetised `lucide-react` import block, between `BookMarked,` and `Check,`.

- [ ] **Step 3: Add the union member**

In the `IconName` union, extend the line that reads:

```ts
  | "dot" | "circle" | "warn" | "error" | "info" | "clock"
```

to:

```ts
  | "dot" | "circle" | "warn" | "error" | "info" | "clock" | "bug"
```

- [ ] **Step 4: Add the record entry**

In the `ICONS` record, add `bug: Bug,` beside the other status glyphs (`warn`, `error`, `info`).

- [ ] **Step 5: Verify the guard and the typecheck**

Run: `~/Library/pnpm/pnpm vitest run test/iconSet.test.ts && ~/Library/pnpm/pnpm tsc --noEmit`
Expected: PASS. The `Record<IconName, LucideIcon>` type makes a missing record entry a compile error, so the typecheck is the real assertion here.

- [ ] **Step 6: Commit**

```bash
git add src/design/icons.tsx
git commit -m "$(cat <<'EOF'
feat(design): add the bug icon

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The store and the side effects

**Files:**
- Create: `src/features/report/useReportStore.ts`
- Create: `src/features/report/fileReport.ts`
- Test: `src/features/report/fileReport.test.ts`

**Interfaces:**
- Consumes: `buildReport`, `issueUrl`, `ReportParts` from Task 1.
- Produces:
  - `useReportStore` — `{ open: boolean; seed: string; openReport(seed?: string): void; closeReport(): void }`
  - `interface ReportSources { version: string; environment: string; logPath: string; logTail: string | null }`
  - `function gatherReport(includeLog: boolean): Promise<ReportSources>`
  - `function copyAndOpenIssue(parts: ReportParts & { summary: string }): Promise<void>`
  - `function copyReport(parts: ReportParts): Promise<void>`
  - `function fileBugReport(summary: string): Promise<void>`

- [ ] **Step 1: Write the store**

Create `src/features/report/useReportStore.ts`:

```ts
import { create } from "zustand";

/**
 * Whether the report dialog is open, and what the summary box starts with.
 *
 * App-level rather than per-repo, so it stays out of `RepoSlice`/`emptySlice`:
 * those exist for state that must be DROPPED on a tab switch, and "is the
 * report dialog open" is not about a repository at all.
 *
 * `seed` exists because two of the four entry points know something the user
 * would otherwise retype — the error banner has the error text, and the error
 * boundary has the render throw's message.
 */
interface ReportState {
  open: boolean;
  seed: string;
  openReport: (seed?: string) => void;
  closeReport: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  open: false,
  seed: "",
  openReport: (seed = "") => set({ open: true, seed }),
  closeReport: () => set({ open: false }),
}));
```

- [ ] **Step 2: Write the failing test for the side effects**

Create `src/features/report/fileReport.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";

import { copyAndOpenIssue, fileBugReport, gatherReport } from "./fileReport";

const DIAG = {
  logPath: "/tmp/platypusgit.log",
  logExists: true,
  logSizeBytes: 4096,
  environment: "host os=linux arch=x86_64 git=2.43.0",
  version: "0.8.0",
};

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (t: string) => {
        written.push(t);
      }),
    },
  });
  mockInvoke("diagnostics_report", () => DIAG);
  mockInvoke("read_log_tail", () => "11:02 WARN invoke fetch slow: 1400ms");
  mockInvoke("open_url", () => undefined);
});

describe("gatherReport", () => {
  it("reads the log tail when asked", async () => {
    const src = await gatherReport(true);
    expect(src.version).toBe("0.8.0");
    expect(src.environment).toBe(DIAG.environment);
    expect(src.logPath).toBe(DIAG.logPath);
    expect(src.logTail).toContain("invoke fetch slow");
  });

  it("does not read the log tail when not asked", async () => {
    const src = await gatherReport(false);
    expect(src.logTail).toBeNull();
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("read_log_tail");
  });

  it("survives a log that cannot be read", async () => {
    // An unreadable log must not lose the environment: an environment-only
    // report is worth more than no report at all.
    mockInvoke("read_log_tail", () => {
      throw { kind: "Io", message: "no log file yet" };
    });
    const src = await gatherReport(true);
    expect(src.logTail).toBeNull();
    expect(src.environment).toBe(DIAG.environment);
  });
});

describe("copyAndOpenIssue", () => {
  const PARTS = {
    summary: "Fetch hangs",
    version: "0.8.0",
    environment: DIAG.environment,
    logPath: DIAG.logPath,
    logTail: "11:02 WARN invoke fetch slow",
    includeEnvironment: true,
    includeLog: true,
  };

  it("copies the report before opening the browser", async () => {
    await copyAndOpenIssue(PARTS);
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(written[0]).toContain("invoke fetch slow");
    // Order matters: by the time GitHub has loaded, the clipboard must already
    // hold what the body's paste marker asks for.
    const opened = getInvokeCalls().find((c) => c.cmd === "open_url");
    expect(opened).toBeTruthy();
    expect(written.length).toBe(1);
  });

  it("opens a URL inside the budget with no log in it", async () => {
    await copyAndOpenIssue(PARTS);
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args.url as string;
    expect(url).toContain("github.com/jonassaa/platypusgit/issues/new");
    expect(url).not.toContain("invoke+fetch+slow");
    expect(url.length).toBeLessThanOrEqual(6000);
  });

  it("does not open the browser when the clipboard write fails", async () => {
    // Opening GitHub with nothing on the clipboard sends the user to a form
    // whose instructions they cannot follow.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    await expect(copyAndOpenIssue(PARTS)).rejects.toThrow();
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("open_url");
  });

  it("reports a webview with no clipboard rather than pretending to copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await expect(copyAndOpenIssue(PARTS)).rejects.toThrow(/clipboard/i);
  });
});

describe("fileBugReport", () => {
  it("gathers, copies and opens in one call", async () => {
    // This is the error boundary's whole path: it has no dialog to mount and
    // no store subscriber, so one call has to do everything.
    await fileBugReport("Render error: x is not a function");
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(written[0]).toContain("invoke fetch slow");
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args.url as string;
    expect(decodeURIComponent(url)).toContain("Render error: x is not a function");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/fileReport.test.ts`
Expected: FAIL — `Failed to resolve import "./fileReport"`.

- [ ] **Step 4: Write the implementation**

Create `src/features/report/fileReport.ts`:

```ts
/**
 * The side effects: reading the diagnostics, writing the clipboard, opening
 * the browser.
 *
 * Split from `report.ts` so that the text assembly stays pure, and split from
 * `ReportIssueDialog` so that a caller with no React tree can still file a
 * report. That caller is `PGErrorBoundary`, which runs precisely when the tree
 * below it has been unmounted — see `fileBugReport`.
 */
import { diagnosticsReport, openUrl, readLogTail } from "@/lib/tauri";

import { buildReport, issueUrl, type ReportParts } from "./report";

/** Everything a report is assembled from, as read off this machine. */
export interface ReportSources {
  version: string;
  environment: string;
  logPath: string;
  /** `null` when the log could not be read — see `gatherReport`. */
  logTail: string | null;
}

/**
 * Read the facts a report is built from.
 *
 * A failing `read_log_tail` is NOT an error here. A fresh install has no log
 * file at all, and an environment-only report is worth more than no report, so
 * the tail degrades to `null` and `buildReport` drops the section.
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/fileReport.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
~/Library/pnpm/pnpm tsc --noEmit
git add src/features/report/useReportStore.ts src/features/report/fileReport.ts src/features/report/fileReport.test.ts
git commit -m "$(cat <<'EOF'
feat(report): gather the diagnostics, copy, then open the issue

**Why:** copy strictly before open — the issue body carries a paste
marker, so opening GitHub with an empty clipboard sends the reporter to
a form whose instructions they cannot follow. A failed read_log_tail
degrades to an environment-only report rather than an error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The dialog

**Files:**
- Create: `src/features/report/ReportIssueDialog.tsx`
- Test: `src/features/report/ReportIssueDialog.test.tsx`

**Interfaces:**
- Consumes: `useReportStore` and `gatherReport`/`copyReport`/`copyAndOpenIssue` from Task 3, `buildReport`/`ReportParts` from Task 1, `"bug"` from Task 2.
- Produces: `function ReportIssueDialog(): JSX.Element | null` — a self-contained overlay driven entirely by `useReportStore`, taking no props, mounted once by `AppShell` in Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/features/report/ReportIssueDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";

import { ReportIssueDialog } from "./ReportIssueDialog";
import { useReportStore } from "./useReportStore";

const DIAG = {
  logPath: "/tmp/platypusgit.log",
  logExists: true,
  logSizeBytes: 4096,
  environment: "host os=linux arch=x86_64 git=2.43.0",
  version: "0.8.0",
};

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (t: string) => void written.push(t)) },
  });
  mockInvoke("diagnostics_report", () => DIAG);
  mockInvoke("read_log_tail", () => "11:02 WARN invoke fetch slow: 1400ms");
  mockInvoke("open_url", () => undefined);
  useReportStore.setState({ open: false, seed: "" });
});

function openDialog(seed = "") {
  useReportStore.getState().openReport(seed);
}

describe("ReportIssueDialog", () => {
  it("renders nothing while closed", () => {
    render(<ReportIssueDialog />);
    expect(screen.queryByTestId("report-dialog")).toBeNull();
  });

  it("shows the exact text that will be copied", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    // Nothing leaves this app without being shown first — the preview is the
    // report itself, not a summary of it.
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).toHaveTextContent(
        "platypusgit 0.8.0",
      ),
    );
    expect(screen.getByTestId("report-preview")).toHaveTextContent(
      "invoke fetch slow: 1400ms",
    );
    expect(screen.getByTestId("report-preview")).toHaveTextContent(
      "host os=linux arch=x86_64 git=2.43.0",
    );
  });

  it("seeds the summary from the caller", async () => {
    render(<ReportIssueDialog />);
    openDialog("Network: could not resolve host");
    await waitFor(() =>
      expect(screen.getByTestId("report-summary")).toHaveValue(
        "Network: could not resolve host",
      ),
    );
  });

  it("drops the log from the preview when the box is unchecked", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog />);
    openDialog();
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).toHaveTextContent(
        "invoke fetch slow",
      ),
    );
    await user.click(screen.getByTestId("report-include-log"));
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
        "invoke fetch slow",
      ),
    );
    // Unchecking the log is the privacy control: it is what removes the paths.
    expect(screen.getByTestId("report-preview")).not.toHaveTextContent("/tmp/");
  });

  it("drops the environment from the preview when unchecked", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog />);
    openDialog();
    await waitFor(() => screen.getByTestId("report-preview"));
    await user.click(screen.getByTestId("report-include-env"));
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
        "host os=linux",
      ),
    );
  });

  it("copies without opening the browser on Copy report", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog />);
    openDialog();
    await waitFor(() => screen.getByTestId("report-copy"));
    await user.click(screen.getByTestId("report-copy"));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("open_url");
    // Copy-only leaves the dialog open: the user is mid-flow, filing by hand.
    expect(screen.getByTestId("report-dialog")).toBeTruthy();
  });

  it("copies and opens the prefilled issue on Copy & open", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog />);
    openDialog();
    await waitFor(() => screen.getByTestId("report-open"));
    await user.type(screen.getByTestId("report-summary"), "Fetch hangs");
    await user.click(screen.getByTestId("report-open"));
    await waitFor(() =>
      expect(getInvokeCalls().map((c) => c.cmd)).toContain("open_url"),
    );
    expect(written[0]).toContain("platypusgit 0.8.0");
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args
      .url as string;
    expect(decodeURIComponent(url)).toContain("Fetch hangs");
    expect(url).toContain("labels=bug");
  });

  it("still offers an environment report when the log cannot be read", async () => {
    mockInvoke("read_log_tail", () => {
      throw { kind: "Io", message: "no log file at /tmp/x yet" };
    });
    render(<ReportIssueDialog />);
    openDialog();
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).toHaveTextContent(
        "platypusgit 0.8.0",
      ),
    );
    expect(screen.getByTestId("report-preview")).toHaveTextContent(
      "host os=linux",
    );
    expect(screen.getByTestId("report-copy")).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/ReportIssueDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./ReportIssueDialog"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/report/ReportIssueDialog.tsx`:

```tsx
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

import {
  PGButton,
  PGCheckbox,
  PGModal,
  appErrorMessage,
  pgFlash,
} from "@/design";
import { useAction } from "@/features/keymap/useAction";

import { buildReport } from "./report";
import { copyAndOpenIssue, copyReport, gatherReport, type ReportSources } from "./fileReport";
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
  // box, and last time's text does not linger.
  React.useEffect(() => {
    if (open) {
      setSummary(seed);
      setSources(null);
    }
  }, [open, seed]);

  // Always read the log, whatever the checkbox says. It is what the PREVIEW
  // needs in order to show the user what they are about to include, and
  // re-reading it on every toggle would make the box feel slow for no gain.
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
      pgFlash(appErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PGModal onCancel={close} width={620} dismissable={!busy}>
      <div data-testid="report-dialog" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          This is copied to your clipboard — nothing is sent anywhere. Paste it
          into the issue GitHub opens.
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
          <PGButton size="sm" variant="ghost" onClick={close} disabled={busy}>
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
```

> **Note on `PGCheckbox`:** confirm its prop names against
> `src/design/primitives.tsx` (`checked`, `onChange`, `label`, `testId`) and
> whether `onChange` receives the next boolean or an event; adapt the two call
> sites if it differs. Same for `PGButton` accepting `data-testid` through its
> `...rest` spread — it does, but verify rather than assume.

- [ ] **Step 4: Run the test to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/features/report/ReportIssueDialog.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
~/Library/pnpm/pnpm tsc --noEmit
git add src/features/report/ReportIssueDialog.tsx src/features/report/ReportIssueDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(report): the Report an issue dialog

**Why:** the preview is the privacy story — this is the most revealing
text the app assembles in one place, so it renders the exact string that
will be copied and makes each part independently opt-out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The three in-tree entry points

**Files:**
- Modify: `src/AppShell.tsx` (mount the dialog beside `PGDialogHost` ~line 479; the `PGErrorBanner` call ~line 495; `AppTitlebar`'s `rightSlot` ~line 737)
- Modify: `src/design/error-banner.tsx` (new optional `onReport` prop)
- Modify: `src/screens/Reflog.tsx:182` (pass `onReport`)
- Modify: `src/features/settings/pages/backup.tsx` (a Diagnostics row + move `copyLog` onto `buildReport`)
- Test: `src/design/error-banner.test.tsx` (extend), `src/screens/settings.index.test.tsx` (existing gate — no edit expected)

**Interfaces:**
- Consumes: `ReportIssueDialog` and `useReportStore` from Tasks 3–4, `buildReport` from Task 1, `"bug"` from Task 2.
- Produces: `PGErrorBanner` gains `onReport?: () => void`; `<ReportIssueDialog />` is mounted exactly once in the app.

- [ ] **Step 1: Write the failing test for the banner's report action**

Add to `src/design/error-banner.test.tsx`:

```tsx
it("offers a report action only when a handler is given", async () => {
  const user = userEvent.setup();
  const onReport = vi.fn();
  const { rerender } = render(
    <PGErrorBanner
      error={{ kind: "Network", message: "could not resolve host" }}
      onDismiss={() => {}}
    />,
  );
  // Optional on the same terms as `compact`: a surface with no report flow
  // must not grow a dead button.
  expect(screen.queryByTestId("banner-report")).toBeNull();

  rerender(
    <PGErrorBanner
      error={{ kind: "Network", message: "could not resolve host" }}
      onDismiss={() => {}}
      onReport={onReport}
    />,
  );
  await user.click(screen.getByTestId("banner-report"));
  expect(onReport).toHaveBeenCalledTimes(1);
});
```

> Match the existing file's imports and its `AppError` fixture shape — read it
> before adding this, and reuse whatever error object the neighbouring tests
> use rather than inventing one.

- [ ] **Step 2: Run it to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/design/error-banner.test.tsx`
Expected: FAIL — no element with testid `banner-report`.

- [ ] **Step 3: Add the prop to the banner**

In `src/design/error-banner.tsx`, extend the props:

```tsx
  /** Offers "report" beside "dismiss". Optional on the same terms as
   *  `compact`: a surface with no report flow must not grow a dead button.
   *  A callback rather than the banner reaching for `useReportStore` —
   *  `src/design/` is the design system and performs no IPC. */
  onReport?: () => void;
```

and render it before the dismiss button, sharing its styling:

```tsx
      {onReport && (
        <button
          onClick={onReport}
          data-testid="banner-report"
          style={{
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: "var(--fs-11)",
            textDecoration: "underline",
          }}
        >
          report
        </button>
      )}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/design/error-banner.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Wire AppShell — mount, banner, titlebar**

In `src/AppShell.tsx`:

1. Import: `import { ReportIssueDialog } from "@/features/report/ReportIssueDialog";` and `import { useReportStore } from "@/features/report/useReportStore";`
2. Beside `<PGDialogHost />` (~line 479), add `<ReportIssueDialog />`.
3. At the `PGErrorBanner` call (~line 495), pass the seed:

```tsx
      {error && (
        <PGErrorBanner
          error={error}
          onDismiss={clearError}
          onReport={() =>
            useReportStore.getState().openReport(errorBannerText(error))
          }
        />
      )}
```

   Import `errorBannerText` from `@/lib/errors` if it is not already imported.
4. In `AppTitlebar`'s `rightSlot` (~line 737), before `<UpdateChip />`:

```tsx
            <PGButton
              size="sm"
              variant="ghost"
              icon="bug"
              title="Report an issue"
              onClick={() => useReportStore.getState().openReport()}
              data-testid="titlebar-report"
            />
```

   `getState()` rather than a hook subscription, for the reason the comment
   above `onFetch` already gives: this titlebar re-rendered on every store
   write once, and it is not doing that again.

- [ ] **Step 6: Add the Settings row and unify the report format**

In `src/features/settings/pages/backup.tsx`:

1. Add to `meta.cards`' diagnostics `rows` (the array that already holds
   `diagnostics.environment` and `diagnostics.log`):

```ts
        { id: "diagnostics.report", label: "Report an issue", keywords: "bug github issue report file feedback" },
```

   `settings.index.test.tsx` fails the build for a row rendered but not
   declared, and a word that lives only in a `hint` is not indexed — hence
   `keywords`.

2. Replace the hand-built header in `copyLog` with `buildReport`, so the two
   surfaces cannot drift:

```ts
  const copyLog = async () => {
    setDiagBusy(true);
    try {
      const tail = await readLogTail();
      // One report format, shared with the Report an issue dialog
      // (features/report/report.ts). This used to assemble its own header.
      await navigator.clipboard?.writeText(
        buildReport({
          version: diagReport?.version ?? "",
          environment: diagReport?.environment ?? "",
          logPath: diagReport?.logPath ?? "",
          logTail: tail,
          includeEnvironment: true,
          includeLog: true,
        }),
      );
      pgFlash("Log tail copied");
    } catch (e) {
      pgFlash(appErrorMessage(e));
    } finally {
      setDiagBusy(false);
    }
  };
```

3. Add the row inside the Diagnostics `SettingsCard`, after `diagnostics.log`:

```tsx
        <SettingsRow
          id="diagnostics.report"
          label="Report an issue"
          hint="Assembles the environment and the log tail, copies them, and opens a prefilled GitHub issue. Nothing is sent — you paste it."
          control={
            <PGButton
              size="sm"
              icon="bug"
              onClick={() => useReportStore.getState().openReport()}
            >
              Report an issue
            </PGButton>
          }
        />
```

- [ ] **Step 7: Pass the prop from Reflog**

In `src/screens/Reflog.tsx:182`, add `onReport` to the `PGErrorBanner` call, mirroring AppShell's:

```tsx
        <PGErrorBanner
          error={error}
          onDismiss={clearError}
          onReport={() =>
            useReportStore.getState().openReport(errorBannerText(error))
          }
          compact
        />
```

- [ ] **Step 8: Verify the whole unit suite and the guards**

Run: `~/Library/pnpm/pnpm test`
Expected: PASS. Watch specifically for `settings.index.test.tsx` (the row must be declared), `iconSet.test.ts` (`"bug"` must be in the union — it is, from Task 2), `AppShell.navroutes.test.tsx` and the startup-paint guard.

Also run: `grep -rn 'lib/tauri' src/design/` — expected: no output. The banner takes a callback precisely so this stays empty.

- [ ] **Step 9: Typecheck and commit**

```bash
~/Library/pnpm/pnpm tsc --noEmit
git add src/AppShell.tsx src/design/error-banner.tsx src/design/error-banner.test.tsx src/screens/Reflog.tsx src/features/settings/pages/backup.tsx
git commit -m "$(cat <<'EOF'
feat(report): reach the reporter from the titlebar, banner and Settings

**Why:** the banner takes an onReport callback rather than importing
useReportStore, because src/design/ is the design system and does not
reach into features/. Settings' Copy last 500 lines moves onto
buildReport so there is one report format rather than two.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The error boundary — the entry point that cannot use the dialog

**Files:**
- Modify: `src/design/error-boundary.tsx` (new optional `onReport` prop + button)
- Modify: `src/main.tsx` (wire it to `fileBugReport`)
- Test: `src/design/error-boundary.test.tsx` (extend)

**Interfaces:**
- Consumes: `fileBugReport` from Task 3.
- Produces: `PGErrorBoundary` gains `onReport?: (error: Error) => void`.

- [ ] **Step 1: Write the failing test**

Add to `src/design/error-boundary.test.tsx`:

```tsx
it("offers to report the throw, with no dialog host mounted", async () => {
  const user = userEvent.setup();
  const onReport = vi.fn();
  const Boom = () => {
    throw new Error("x is not a function");
  };
  // Deliberately NO <PGDialogHost /> and no <ReportIssueDialog />. This is the
  // real shape of the boundary's world: both mount inside AppShell, which
  // mounts inside this boundary, so a render throw has already unmounted them.
  // A report path that needs either of them does nothing at all here.
  render(
    <PGErrorBoundary onReport={onReport}>
      <Boom />
    </PGErrorBoundary>,
  );
  expect(screen.getByTestId("app-error-boundary")).toBeTruthy();
  await user.click(screen.getByTestId("boundary-report"));
  expect(onReport).toHaveBeenCalledTimes(1);
  // Seeded with the throw, so the reporter does not retype it.
  expect(onReport.mock.calls[0][0]).toBeInstanceOf(Error);
  expect((onReport.mock.calls[0][0] as Error).message).toBe(
    "x is not a function",
  );
});

it("shows no report button when no handler is given", () => {
  const Boom = () => {
    throw new Error("boom");
  };
  render(
    <PGErrorBoundary>
      <Boom />
    </PGErrorBoundary>,
  );
  expect(screen.getByTestId("app-error-boundary")).toBeTruthy();
  expect(screen.queryByTestId("boundary-report")).toBeNull();
});
```

> The existing file already renders a throwing child and silences
> `console.error`; follow its setup exactly rather than adding a second
> mechanism.

- [ ] **Step 2: Run it to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/design/error-boundary.test.tsx`
Expected: FAIL — no element with testid `boundary-report`.

- [ ] **Step 3: Add the prop and the button**

In `src/design/error-boundary.tsx`, extend `Props`:

```tsx
  /**
   * Files a bug report for the throw. Optional, and a CALLBACK rather than
   * work done here, for two reasons:
   *
   *   - Nothing in `src/design/` performs IPC, and this is not the place to
   *     start: a design-system component that reaches for `@/lib/tauri` cannot
   *     be tested without a bridge.
   *   - The boundary cannot use the report DIALOG under any circumstances.
   *     `PGDialogHost` and `ReportIssueDialog` both mount inside `AppShell`,
   *     which mounts inside this boundary, so by the time this renders React
   *     has unmounted them — `openReport()` would set a flag nobody reads.
   *
   * `main.tsx` wires it to `features/report/fileReport.ts::fileBugReport`,
   * which gathers, copies and opens in one call with no React tree involved.
   */
  onReport?: (error: Error) => void;
```

and render the button beside `Reload`, wrapping both in a flex row:

```tsx
        <div style={{ display: "flex", gap: 8 }}>
          {this.props.onReport && (
            <button
              data-testid="boundary-report"
              onClick={() => this.props.onReport?.(error)}
              style={{
                background: "var(--bg-2)",
                color: "var(--fg-0)",
                border: "1px solid var(--border-1)",
                borderRadius: 4,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: "var(--fs-12)",
              }}
            >
              Report this bug
            </button>
          )}
          <button
            onClick={() => {
              if (this.props.onReload) this.props.onReload();
              else window.location.reload();
            }}
            style={{
              background: "var(--accent)",
              color: "var(--bg-0)",
              border: "none",
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: "var(--fs-12)",
            }}
          >
            Reload
          </button>
        </div>
```

Keep the existing `Reload` button's markup and styling byte-for-byte — only its
wrapper is new.

- [ ] **Step 4: Run it to verify it passes**

Run: `~/Library/pnpm/pnpm vitest run src/design/error-boundary.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Wire it in main.tsx**

In `src/main.tsx`, import `fileBugReport` and pass it:

```tsx
import { fileBugReport } from "./features/report/fileReport";
```

```tsx
    <PGErrorBoundary
      onReport={(err) => {
        // Fire and forget: the boundary has no place to render a failure, and
        // `fileBugReport` already degrades a missing log to an
        // environment-only report.
        void fileBugReport(`Render error: ${err.message}`).catch((e) =>
          console.error("could not file a bug report", e),
        );
      }}
    >
      {isMergeWindow ? <MergeWindow /> : <App />}
    </PGErrorBoundary>
```

- [ ] **Step 6: Verify the startup-paint guard still holds**

Run: `~/Library/pnpm/pnpm vitest run test/startupPaint.test.ts src/design/error-boundary.test.tsx`
Expected: PASS. `main.tsx` is what `startupPaint.test.ts` reads — the reveal must
still be a sibling of the boundary, not a child, and this edit must not move it.

- [ ] **Step 7: Typecheck and commit**

```bash
~/Library/pnpm/pnpm tsc --noEmit
git add src/design/error-boundary.tsx src/design/error-boundary.test.tsx src/main.tsx
git commit -m "$(cat <<'EOF'
feat(report): report a render throw from the error boundary

**Why:** the boundary is the one entry point that cannot use the dialog —
PGDialogHost and ReportIssueDialog both mount inside AppShell, which
mounts inside the boundary, so a render throw has already unmounted them.
It takes an onReport callback (like onReload) and main.tsx wires it to
fileBugReport, which needs no React tree. Test asserts the no-host case.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docs, the privacy allow-list, and the e2e assertion

**Files:**
- Modify: `docs/dev/architecture.md` (the `src/features/` tree)
- Modify: `docs/dev/frontend.md` (a section on the reporter)
- Modify: `CLAUDE.md` (one convention line)
- Modify: `test/privacy.test.ts` (extend the `github.com` reason)
- Modify: `e2e/specs/settings.e2e.ts` (one assertion)

**Interfaces:**
- Consumes: everything above.
- Produces: a green `pnpm test` including `docs.test.ts` and `privacy.test.ts`.

- [ ] **Step 1: Prove the docs gate is live before satisfying it**

Run: `~/Library/pnpm/pnpm vitest run test/docs.test.ts`
Expected: **FAIL** — "Feature directories absent from the features/ tree in
docs/dev/architecture.md: report". Seeing this red first is the point: it proves
the gate covers the new directory rather than being assumed to.

- [ ] **Step 2: Add the features-tree entry**

In `docs/dev/architecture.md`'s `src/features/` tree, add an entry in the
app-level chrome neighbourhood (near `update/` / `windows/`), matching the
surrounding `├── name/` + aligned-prose format:

```
├── report/          In-app bug reporting. report.ts is PURE (buildReport +
│                    issueUrl, with a MAX_URL_LEN budget — a GitHub
│                    issues/new?body= URL 414s well below the size of a log
│                    tail, which is why the log travels by CLIPBOARD and the
│                    URL carries only the bounded facts plus a paste marker);
│                    fileReport.ts owns the side effects (gather → copy →
│                    open, in that order); ReportIssueDialog (mounted once by
│                    AppShell, so Settings and the error banner share it);
│                    useReportStore. PGErrorBoundary cannot use the dialog —
│                    it mounts ABOVE PGDialogHost — so it takes an onReport
│                    callback wired in main.tsx to fileBugReport
```

- [ ] **Step 3: Re-run the gate**

Run: `~/Library/pnpm/pnpm vitest run test/docs.test.ts`
Expected: PASS.

- [ ] **Step 4: Extend the privacy allow-list's reason**

In `test/privacy.test.ts`, replace the `github.com` entry's reason so the new
literal is argued for in public — the list exists to force exactly this review
checkpoint:

```ts
  [
    "github.com",
    "Two rendered strings, no request. (1) Placeholder text in the clone " +
      "dialog's URL field (`https://github.com/org/repo.git`), so the input " +
      "shows the shape it wants. (2) The base of the prefilled bug-report URL " +
      "(`features/report/report.ts`): the app builds an `issues/new?…` link " +
      "and hands it to `openUrl`, which is the USER'S OWN BROWSER. Nothing " +
      "here fetches anything, and the report itself never travels in the URL " +
      "— it goes on the clipboard, and only the user's paste puts it on " +
      "GitHub.",
  ],
```

- [ ] **Step 5: Add the frontend.md section**

In `docs/dev/frontend.md`, add a section covering: the four entry points; the
clipboard/URL split and why (414 vs `TAIL_CAP_BYTES`); the privacy rules
(preview shows the exact string, each part opt-out, no network call); and the
boundary trap (`PGDialogHost` mounts inside `AppShell` mounts inside
`PGErrorBoundary`, so the boundary takes `onReport` and calls `fileBugReport`).
Match the file's existing heading depth and prose register.

- [ ] **Step 6: Add the CLAUDE.md convention line**

In `CLAUDE.md`'s "Conventions — the load-bearing rules" list, after the error
banner bullet:

```markdown
- **One issue reporter — `features/report/`.** `report.ts` is PURE and
  `fileReport.ts` owns the side effects, because `PGErrorBoundary` mounts ABOVE
  `PGDialogHost` and so cannot open the dialog: it takes an `onReport` callback
  wired in `main.tsx`. The log travels by CLIPBOARD, never in the URL (a
  GitHub `issues/new?body=` URL 414s far below `TAIL_CAP_BYTES`), the preview
  shows the exact string that will be copied, and nothing is ever sent — the
  app writes the clipboard and hands a URL to the user's browser.
  (`docs/dev/frontend.md`)
```

- [ ] **Step 7: Read the e2e skill, then add one assertion**

**Read `.claude/skills/e2e-testing/SKILL.md` first** — this is mandatory before
writing or debugging any e2e spec.

Then, in `e2e/specs/settings.e2e.ts`, add an assertion that navigating to the
Diagnostics page and clicking the report button opens the dialog and renders a
non-empty preview. It must **not** click `report-open`: a spec that opens a
browser is a spec that hangs CI.

- [ ] **Step 8: Typecheck e2e and run the full unit suite**

```bash
~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit
~/Library/pnpm/pnpm tsc --noEmit
~/Library/pnpm/pnpm test
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add docs/ CLAUDE.md test/privacy.test.ts e2e/specs/settings.e2e.ts
git commit -m "$(cat <<'EOF'
docs(report): document the reporter and argue its github.com literal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final verification and PR

- [ ] **Step 1: Rebuild the e2e snapshot and run the touched specs**

`src/` changed, so the snapshot is stale and must be rebuilt first. One cold
container build at a time across ALL worktrees.

```bash
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
```

- [ ] **Step 2: Re-run the full unit suite AFTER the last edit**

```bash
~/Library/pnpm/pnpm test
~/Library/pnpm/pnpm tsc --noEmit
```

A green number only counts for the tree it ran on, so this comes after every
other change is in. Note the total test count in the PR body.

- [ ] **Step 3: Squash to one Conventional Commit**

The PR squash-merges anyway, so squash locally first for a clean message. Pin
`main`'s SHA rather than using the moving ref — a concurrent PR landing between
the fetch and the reset would otherwise be reverted:

```bash
git fetch origin
git rev-parse origin/main          # note the SHA
git reset --soft <that-sha>
git commit -m "$(cat <<'EOF'
feat(report): file a GitHub bug report from inside the app

Assembles the environment line and the log tail into one report, shows
the user every byte of it, copies it and opens a prefilled issue.
Reachable from the titlebar, the error banner, the error boundary and
Settings → Diagnostics.

**Why the clipboard:** a GitHub `issues/new?body=` URL answers HTTP 414
well below the size of a log tail, so the split is by size — bounded
facts (version, os, arch, git) in the URL, the report on the clipboard,
with a paste marker in the body. Copy happens strictly before open.

**Why the boundary is different:** PGDialogHost and ReportIssueDialog
both mount inside AppShell, which mounts inside PGErrorBoundary, so a
render throw has already unmounted them. The boundary takes an onReport
callback (like the onReload it already had) and main.tsx wires it to
fileBugReport, which needs no React tree.

No network call and no new backend command: this reuses
diagnostics_report and read_log_tail, writes the clipboard, and hands a
URL to the user's own browser.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/issue-report
```

Then `gh pr create --title "feat(report): file a GitHub bug report from inside the app" --body-file <path>` — a `--body-file`, never `--body "<prose>"`, which the worktree guard refuses. Before merging, check `gh pr view <N> --json closingIssuesReferences` — a body that merely mentions an issue number still closes it.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: *Why the clipboard* →
Task 1 (`MAX_URL_LEN`, the budget tests); *Privacy* → Task 4 (preview,
checkboxes) + Task 7 (allow-list prose); `report.ts` → Task 1; `fileReport.ts` +
`useReportStore.ts` → Task 3; `ReportIssueDialog.tsx` → Task 4; the four entry
points → Tasks 5–6; *The error boundary cannot use the dialog* → Task 6;
*The icon* → Task 2; *Testing* table → the test in each task; *Documentation* →
Task 7. *Not in scope* needs no task by construction.

**Placeholders.** None: every code step carries the actual code. Two steps
delegate prose to the implementer (Task 7's frontend.md section, Task 7's e2e
assertion) with the required content enumerated; both are documentation and
test-copy rather than logic, and the e2e one is gated behind reading the
project's e2e skill, which is the house rule.

**Type consistency.** `ReportParts` (Task 1) is consumed by `copyReport` /
`copyAndOpenIssue` (Task 3) and spread in Task 4's `parts` — same six fields
throughout. `ReportSources` (Task 3) has four fields and is spread into
`copyAndOpenIssue` alongside `summary` + the two `include*` flags, which is
exactly `ReportParts & { summary }`. `openReport(seed?)` is called with no
argument (titlebar, Settings) and with one (banner, boundary) — the default
`""` covers both. `onReport` is `() => void` on the banner and
`(error: Error) => void` on the boundary; the difference is deliberate and
noted in both places.
