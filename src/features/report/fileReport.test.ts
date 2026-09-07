import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

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
    expect(getInvokeCalls().find((c) => c.cmd === "open_url")).toBeTruthy();
    expect(written.length).toBe(1);
  });

  it("opens a URL inside the budget with no log in it", async () => {
    await copyAndOpenIssue(PARTS);
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args
      .url as string;
    expect(url).toContain("github.com/jonassaa/platypusgit/issues/new");
    // Read through searchParams, not decodeURIComponent: URLSearchParams
    // encodes a space as `+`, which decodeURIComponent leaves alone — so a
    // raw-string assertion about prose in the query is accidentally true.
    const body = new URL(url).searchParams.get("body")!;
    expect(body).not.toContain("invoke fetch slow");
    expect(body).toContain("Fetch hangs");
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
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("open_url");
  });
});

describe("fileBugReport", () => {
  it("gathers, copies and opens in one call", async () => {
    // This is the error boundary's whole path: it has no dialog to mount and
    // no store subscriber, so one call has to do everything.
    await fileBugReport("Render error: x is not a function");
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(written[0]).toContain("invoke fetch slow");
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args
      .url as string;
    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("[bug] Render error: x is not a function");
    expect(params.get("body")).toContain("Render error: x is not a function");
  });

  it("still files a report when there is no log to read", async () => {
    mockInvoke("read_log_tail", () => {
      throw { kind: "Io", message: "no log file yet" };
    });
    await fileBugReport("Render error: boom");
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(written[0]).toContain("host os=linux");
    // No dangling log section for a log that was never read.
    expect(written[0]).not.toContain("log tail");
    expect(getInvokeCalls().map((c) => c.cmd)).toContain("open_url");
  });
});
