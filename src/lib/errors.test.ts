import { describe, it, expect } from "vitest";
import { appErrorMessage, describeError, type AppError } from "./errors";

/**
 * #146: every backend failure reached the log file as `[object Object]`, so the
 * one artifact a bug reporter can hand over carried no reason at all. These
 * tests pin the two contracts that gap broke:
 *
 *  - NOTHING, for any input shape, may render as `[object Object]`.
 *  - An `AppError`'s `kind` must survive into the logged string, because that
 *    discriminant is what makes a log greppable and tells you which of ~25
 *    failure modes you are looking at.
 */

const OBJ = "[object Object]";

describe("describeError", () => {
  it("keeps an AppError's kind and its message", () => {
    const e: AppError = { kind: "InvalidPath", message: "file not found: old.ts" };
    const s = describeError(e);
    expect(s).toContain("InvalidPath");
    expect(s).toContain("file not found: old.ts");
    expect(s).not.toContain(OBJ);
  });

  it("renders a kind whose message is absent as just the kind", () => {
    expect(describeError({ kind: "Unborn" })).toBe("Unborn");
    expect(describeError({ kind: "NotImplemented", message: undefined })).toBe(
      "NotImplemented",
    );
  });

  it("renders Auth's structured payload instead of stringifying it", () => {
    // `Auth.message` is an object, not prose — the exact shape that produced
    // `[object Object]` twice over.
    const e: AppError = {
      kind: "Auth",
      message: { host: "github.com", kind: "Https" },
    };
    const s = describeError(e);
    expect(s).toContain("Auth");
    expect(s).toContain("github.com");
    expect(s).not.toContain(OBJ);
  });

  it("keeps a thrown Error's name and message", () => {
    const s = describeError(new TypeError("x is not a function"));
    expect(s).toContain("TypeError");
    expect(s).toContain("x is not a function");
    expect(s).not.toContain(OBJ);
  });

  it("passes a string through", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("names an empty string rather than logging nothing", () => {
    expect(describeError("")).toBe("<empty string>");
  });

  it("names undefined and null rather than an empty line", () => {
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError(null)).toBe("null");
  });

  it("serialises a plain object instead of [object Object]", () => {
    const s = describeError({ code: 7, why: "nope" });
    expect(s).not.toContain(OBJ);
    expect(s).toContain("7");
    expect(s).toContain("nope");
  });

  it("survives a circular object", () => {
    const a: Record<string, unknown> = { name: "loop" };
    a.self = a;
    const s = describeError(a);
    expect(s).not.toContain(OBJ);
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
  });

  it("handles primitives", () => {
    expect(describeError(42)).toBe("42");
    expect(describeError(false)).toBe("false");
  });

  it("never returns an empty string, for any shape", () => {
    const shapes: unknown[] = [
      { kind: "Git", message: "bad object" },
      { kind: "Unborn" },
      new Error("boom"),
      "s",
      "",
      undefined,
      null,
      0,
      false,
      {},
      [],
      Symbol("sym"),
      () => {},
    ];
    for (const s of shapes) {
      const out = describeError(s);
      expect(out, `shape ${String(typeof s)}`).not.toContain(OBJ);
      expect(out.length, `shape ${String(typeof s)}`).toBeGreaterThan(0);
    }
  });
});

describe("appErrorMessage", () => {
  it("still renders a sentence, without the kind prefix a log wants", () => {
    // The banner contract is unchanged: prose only, no discriminant.
    expect(appErrorMessage({ kind: "Git", message: "bad object" })).toBe("bad object");
  });

  it("does not render a non-AppError object as [object Object]", () => {
    expect(appErrorMessage({ code: 7 })).not.toContain(OBJ);
  });
});
