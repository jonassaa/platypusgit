import { describe, it, expect } from "vitest";
import {
  appErrorMessage,
  describeError,
  isCancelledError,
  toAppError,
  type AppError,
} from "./errors";

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

/**
 * The three shapes the original 13 tests skipped, all reachable TODAY: every one
 * of them goes through `appErrorDetail`, whose `e.message ?? ""` assumed a
 * string. `isAppError` accepts any object carrying a string `kind`, so a foreign
 * object qualifies — and the moment Rust grows a second struct-payload variant
 * (`Auth` is the first) a real one does too.
 */
describe("an AppError whose message is not a string", () => {
  const nested = { kind: "Git", message: { nested: true } };

  it("does not reach the log as [object Object]", () => {
    // Pre-fix this returned literally "Git: [object Object]" — the one string
    // describeError's own docstring says it can never return.
    const s = describeError(nested);
    expect(s).not.toContain(OBJ);
    expect(s).toContain("Git");
    expect(s).toContain("nested");
  });

  it("does not reach a banner as a non-string", () => {
    // Pre-fix this returned the OBJECT itself from a function typed `: string`
    // — "Objects are not valid as a React child" in a banner, "[object Object]"
    // in a template.
    const m = appErrorMessage(nested);
    expect(typeof m).toBe("string");
    expect(m).not.toContain(OBJ);
  });

  it("says something even when the kind itself is empty", () => {
    // `isAppError` accepts `kind: ""` — it only checks the TYPE — so an empty
    // kind and an empty message together used to compose the empty string the
    // docstring promises never to return.
    expect(describeError({ kind: "", message: "" })).not.toBe("");
    expect(appErrorMessage({ kind: "", message: "" })).not.toBe("");
    // A real message still wins, with no stray ": " prefix from the empty kind.
    expect(describeError({ kind: "", message: "boom" })).toBe("boom");
  });

  it("keeps a struct payload's own rendering for the variants that have one", () => {
    // The shape guards must not cost Auth its sentence.
    expect(appErrorMessage({ kind: "Auth", message: { host: "h", kind: "Https" } })).toContain(
      "h",
    );
    expect(appErrorMessage({ kind: "BranchExists", message: "feat/x" })).toContain("feat/x");
  });
});

describe("an AppError whose message getter throws", () => {
  const hostile = () => ({
    kind: "Git",
    get message(): string {
      throw new Error("payload is a trap");
    },
  });

  /**
   * The dangerous one. `invoke` logs BEFORE it rethrows, so an exception raised
   * INSIDE the logger replaces the original rejection: `isAuthError` downstream
   * then fails to narrow and no credential prompt is raised — a network op just
   * fails instead of asking for a password.
   */
  it("does not propagate out of describeError", () => {
    let s = "";
    expect(() => {
      s = describeError(hostile());
    }).not.toThrow();
    expect(s).toContain("Git");
    expect(s).not.toContain(OBJ);
  });

  it("does not propagate out of appErrorMessage either", () => {
    let m = "";
    expect(() => {
      m = appErrorMessage(hostile());
    }).not.toThrow();
    expect(m.length).toBeGreaterThan(0);
  });
});

describe("toAppError", () => {
  it("passes a rejected command through with its identity intact", () => {
    // Identity, not just shape: five `is*Error` narrowings key off `kind`, and a
    // rewrapped Internal would defeat every one of them.
    const app: AppError = { kind: "Auth", message: { host: "h", kind: "Https" } };
    expect(toAppError(app)).toBe(app);
  });

  it("wraps anything else as Internal with the banner's wording", () => {
    expect(toAppError(new TypeError("x is not a function"))).toEqual({
      kind: "Internal",
      message: "x is not a function",
    });
  });

  it("never wraps a plain object as [object Object] — the #146 bug", () => {
    const wrapped = toAppError({ code: 7, why: "nope" });
    expect(wrapped.message).not.toContain(OBJ);
    expect(wrapped.message).toContain("nope");
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

describe("HookRejected (#232)", () => {
  it("names the hook rather than rendering the struct", () => {
    const e: AppError = {
      kind: "HookRejected",
      message: { hook: "pre-commit", output: "eslint: 2 problems" },
    };
    const text = appErrorMessage(e);
    expect(text).toContain("pre-commit");
    // The struct must never reach a banner as an object.
    expect(text).not.toContain("[object Object]");
  });

  it("keeps the hook's output out of the one-line message", () => {
    // The output belongs in the dedicated block, not a banner: a forty-line
    // eslint dump inside a toast is the bug this feature exists to fix.
    const e: AppError = {
      kind: "HookRejected",
      message: { hook: "commit-msg", output: "line1\nline2\nline3" },
    };
    expect(appErrorMessage(e)).not.toContain("line2");
  });

  it("renders safely when the payload has the wrong shape", () => {
    // A future Rust change that made the payload a plain string must not put
    // "[object Object]" in front of the user, and must not throw.
    const e = {
      kind: "HookRejected",
      message: "not a struct",
    } as unknown as AppError;
    expect(() => appErrorMessage(e)).not.toThrow();
    expect(appErrorMessage(e)).not.toContain("[object Object]");
  });

  it("still names the hook when the hook printed nothing", () => {
    // A hook can exit 1 in silence; the name is then the only clue there is.
    const e: AppError = {
      kind: "HookRejected",
      message: { hook: "pre-commit", output: "" },
    };
    expect(appErrorMessage(e)).toContain("pre-commit");
  });
});

describe("isCancelledError (#234)", () => {
  it("narrows a cancel", () => {
    expect(isCancelledError({ kind: "Cancelled" })).toBe(true);
  });

  it("does not narrow anything else", () => {
    // Especially not `Network`, which is what a killed git would look like if
    // the backend ever stopped claiming the cancel first.
    for (const e of [
      { kind: "Network", message: "connection reset" },
      { kind: "Auth", message: { host: "github.com", kind: "Https" } },
      { kind: "Io", message: "broken pipe" },
      new Error("cancelled"),
      "Cancelled",
      null,
      undefined,
    ]) {
      expect(isCancelledError(e)).toBe(false);
    }
  });

  it("still renders as SOMETHING if a surface does show it", () => {
    // The variant carries no message, so this is the no-prose fallback path —
    // a blank banner would be worse than a terse one.
    const e: AppError = { kind: "Cancelled" };
    expect(appErrorMessage(e)).toBe("Cancelled");
    expect(describeError(e)).toBe("Cancelled");
    expect(toAppError(e)).toBe(e);
  });
});
