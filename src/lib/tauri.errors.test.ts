// The shared invoke() wrapper logs a failure and then RETHROWS it. Those two
// steps are in that order, so anything the logger can throw replaces the
// rejection every caller downstream narrows on — `isAuthError` stops matching
// and the credential dialog is never raised (#146 follow-up).
import { describe, it, expect, vi } from "vitest";
import { error as logError } from "@tauri-apps/plugin-log";

import { mockInvoke } from "@/test/invokeMock";
import { getStatus } from "./tauri";

describe("invoke's failure logging", () => {
  it("rethrows the ORIGINAL rejection even for an error the logger cannot read", async () => {
    const hostile = {
      kind: "Auth",
      get message(): never {
        throw new Error("payload is a trap");
      },
    };
    mockInvoke("get_status", () => {
      throw hostile;
    });

    // Identity, not shape: the caller must get the very object the command
    // rejected with, or narrowing on it is meaningless.
    await expect(getStatus("r1")).rejects.toBe(hostile);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logError).mock.calls[0][0]).toContain("get_status");
  });

  it("logs a plain rejected object with its reason, not [object Object]", async () => {
    mockInvoke("get_status", () => {
      throw { kind: "InvalidPath", message: "file not found: old.ts" };
    });

    await expect(getStatus("r1")).rejects.toBeTruthy();
    const line = String(vi.mocked(logError).mock.calls[0][0]);
    expect(line).toContain("InvalidPath");
    expect(line).toContain("file not found: old.ts");
    expect(line).not.toContain("[object Object]");
  });
});
