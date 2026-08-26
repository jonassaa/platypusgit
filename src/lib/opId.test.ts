// Op ids for cancellable backend operations (#234). Small surface, but a
// collision means a cancel stops somebody else's operation, and a throw means
// the click that starts a fetch never starts it.
import { describe, expect, it } from "vitest";

import { newOpId } from "./opId";

describe("newOpId", () => {
  it("never repeats, even called in a tight loop", () => {
    // Two fetches started in the same millisecond must not share an id: the
    // second cancel would kill the first op's child, which by then may be a pid
    // the OS has reissued.
    const ids = new Set(Array.from({ length: 2000 }, () => newOpId("fetch")));
    expect(ids.size).toBe(2000);
  });

  it("carries the kind, so a log line or IPC trace is readable", () => {
    expect(newOpId("clone").startsWith("clone-")).toBe(true);
    expect(newOpId("push").startsWith("push-")).toBe(true);
  });

  it("does not depend on crypto.randomUUID", () => {
    // The whole reason this helper exists: `randomUUID` is only defined in a
    // secure context, and whether a webview treats the app's custom protocol as
    // one is a per-platform detail. A throw here would cost the fetch.
    const original = globalThis.crypto;
    // Deliberately removed for the duration of the test: `newOpId` must not
    // reach for it, so its absence must not change the answer.
    delete (globalThis as { crypto?: unknown }).crypto;
    try {
      expect(newOpId("fetch")).toMatch(/^fetch-/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
