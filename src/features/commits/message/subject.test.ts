// The subject line, and the two things that get composed onto it (#252): a
// conventional-commit `type(scope):` prefix and a ticket key.
//
// Everything here is a rewrite of PLAIN TEXT in the one message box. There is
// no structured draft behind the textarea and no second storage format — the
// picker reads the subject back out on every render, so typing `feat: x` by
// hand selects "feat" in the picker, and clearing the picker gives the typed
// text back rather than a form's idea of it.
import { describe, it, expect } from "vitest";
import {
  CONVENTIONAL_TYPES,
  insertTicket,
  parseConventionalPrefix,
  subjectOf,
  withConventionalPrefix,
} from "./subject";

describe("subjectOf", () => {
  it("is the first line, body or no body", () => {
    expect(subjectOf("feat: thing")).toBe("feat: thing");
    expect(subjectOf("feat: thing\n\nbody\nmore")).toBe("feat: thing");
    expect(subjectOf("")).toBe("");
  });
});

describe("parseConventionalPrefix", () => {
  it("reads a bare type", () => {
    expect(parseConventionalPrefix("feat: add a thing")).toEqual({
      type: "feat",
      scope: "",
      breaking: false,
      rest: "add a thing",
    });
  });

  it("reads a scope", () => {
    expect(parseConventionalPrefix("fix(commit): stop the crash")).toEqual({
      type: "fix",
      scope: "commit",
      breaking: false,
      rest: "stop the crash",
    });
  });

  it("reads the breaking-change marker without offering to set it", () => {
    // Parsed so a picker change PRESERVES it. The `!` toggle itself is out of
    // scope for this change — see the issue: a mandatory form here would be
    // worse than nothing.
    expect(parseConventionalPrefix("feat(api)!: drop v1")).toEqual({
      type: "feat",
      scope: "api",
      breaking: true,
      rest: "drop v1",
    });
  });

  it("reads a type nobody standardised", () => {
    expect(parseConventionalPrefix("wip: halfway")?.type).toBe("wip");
  });

  it("returns null for prose that merely contains a colon", () => {
    expect(parseConventionalPrefix("Merge branch 'x': tidy up")).toBeNull();
    expect(parseConventionalPrefix("See also: the README")).toBeNull();
    expect(parseConventionalPrefix("just a subject")).toBeNull();
  });

  it("returns null for a nested-paren scope it cannot round-trip", () => {
    expect(parseConventionalPrefix("feat(a(b)): thing")).toBeNull();
  });

  it("reads a half-typed prefix, so the picker is right while you type", () => {
    expect(parseConventionalPrefix("feat:")).toEqual({
      type: "feat",
      scope: "",
      breaking: false,
      rest: "",
    });
  });

  it("ships the conventional set the picker offers", () => {
    expect(CONVENTIONAL_TYPES).toContain("feat");
    expect(CONVENTIONAL_TYPES).toContain("fix");
    expect(CONVENTIONAL_TYPES).toContain("chore");
  });
});

describe("withConventionalPrefix", () => {
  it("prefixes a plain subject", () => {
    expect(withConventionalPrefix("add a thing", "feat", "")).toBe(
      "feat: add a thing",
    );
  });

  it("adds a scope", () => {
    expect(withConventionalPrefix("add a thing", "feat", "commit")).toBe(
      "feat(commit): add a thing",
    );
  });

  it("replaces an existing prefix instead of stacking one", () => {
    expect(withConventionalPrefix("feat(a): thing", "fix", "b")).toBe(
      "fix(b): thing",
    );
  });

  it("keeps the breaking marker across a type change", () => {
    expect(withConventionalPrefix("feat(api)!: drop v1", "fix", "api")).toBe(
      "fix(api)!: drop v1",
    );
  });

  it("removes the prefix when the type is cleared", () => {
    expect(withConventionalPrefix("feat(a): thing", "", "")).toBe("thing");
  });

  it("leaves the body untouched", () => {
    expect(
      withConventionalPrefix("add a thing\n\nWhy: because.", "feat", ""),
    ).toBe("feat: add a thing\n\nWhy: because.");
  });

  it("composes onto an empty box, ready to type into", () => {
    expect(withConventionalPrefix("", "feat", "")).toBe("feat: ");
    expect(withConventionalPrefix("", "feat", "ui")).toBe("feat(ui): ");
  });

  it("does not touch prose that looked like a prefix but is not", () => {
    expect(withConventionalPrefix("See also: the README", "docs", "")).toBe(
      "docs: See also: the README",
    );
  });
});

describe("insertTicket", () => {
  it("puts the ticket at the front of a plain subject", () => {
    expect(insertTicket("do the thing", "PROJ-1")).toBe("PROJ-1 do the thing");
  });

  it("goes AFTER a conventional prefix, not in front of it", () => {
    // `PROJ-1 feat: thing` is not a conventional commit; `feat: PROJ-1 thing`
    // is, and it is what commitlint accepts.
    expect(insertTicket("feat(ui): thing", "PROJ-1")).toBe(
      "feat(ui): PROJ-1 thing",
    );
  });

  it("is a no-op when the subject already names the ticket", () => {
    expect(insertTicket("feat: PROJ-1 thing", "PROJ-1")).toBe(
      "feat: PROJ-1 thing",
    );
    expect(insertTicket("PROJ-1 thing", "PROJ-1")).toBe("PROJ-1 thing");
  });

  it("seeds an empty box", () => {
    expect(insertTicket("", "PROJ-1")).toBe("PROJ-1 ");
  });

  it("leaves the body alone, and does not match a ticket found only there", () => {
    expect(insertTicket("thing\n\nRefs PROJ-1", "PROJ-1")).toBe(
      "PROJ-1 thing\n\nRefs PROJ-1",
    );
  });
});
