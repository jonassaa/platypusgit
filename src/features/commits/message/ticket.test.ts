// Ticket / issue prefix derived from the branch name (#252).
//
// The default pattern is deliberately UPPERCASE-only. A permissive
// `[A-Za-z][A-Za-z0-9]+-\d+` matches `fix-404` in `feature/fix-404-page` and
// `add-2` in `feat/add-2fa-login`, and a one-click insert that offers garbage
// is worse than one that offers nothing. Teams whose branches carry lowercase
// keys change the pattern; the cost of being wrong runs the other way.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TICKET_PATTERN,
  extractTicket,
  isValidTicketPattern,
} from "./ticket";

describe("extractTicket with the default pattern", () => {
  it.each([
    ["feat/PROJ-123-thing", "PROJ-123"],
    ["PROJ-123", "PROJ-123"],
    ["bugfix/ABC-7", "ABC-7"],
    ["users/ada/DEV-1042-retry-logic", "DEV-1042"],
    ["release/PLAT-99/hotfix", "PLAT-99"],
    ["feat/AB1-23-mixed-key", "AB1-23"],
  ])("finds a ticket in %s", (branch, ticket) => {
    expect(extractTicket(branch)).toBe(ticket);
  });

  it.each([
    ["feat/add-commit-help"],
    ["main"],
    ["feature/fix-404-page"],
    ["feat/add-2fa-login"],
    ["chore/bump-deps-2026"],
  ])("finds nothing in %s", (branch) => {
    expect(extractTicket(branch)).toBeNull();
  });

  it("has nothing to offer on a detached HEAD", () => {
    expect(extractTicket(null)).toBeNull();
    expect(extractTicket(undefined)).toBeNull();
    expect(extractTicket("")).toBeNull();
  });

  it("takes the first match when a branch names two tickets", () => {
    expect(extractTicket("feat/PROJ-1-and-PROJ-2")).toBe("PROJ-1");
  });
});

describe("extractTicket with a custom pattern", () => {
  it("uses capture group 1 when the pattern has one", () => {
    // Lets a team match around the ticket without inserting the surroundings.
    expect(extractTicket("issue-42-do-the-thing", "issue-(\\d+)")).toBe("42");
  });

  it("uses the whole match when the pattern has no group", () => {
    expect(extractTicket("gh-777-fix", "gh-\\d+")).toBe("gh-777");
  });

  it("survives a pattern that is not a valid regex", () => {
    // A half-typed pattern in Settings must not take the commit screen down.
    expect(extractTicket("feat/PROJ-1", "([unclosed")).toBeNull();
  });

  it("treats an empty pattern as no pattern", () => {
    expect(extractTicket("feat/PROJ-1", "")).toBeNull();
    expect(extractTicket("feat/PROJ-1", "   ")).toBeNull();
  });
});

describe("isValidTicketPattern", () => {
  it("accepts the default", () => {
    expect(isValidTicketPattern(DEFAULT_TICKET_PATTERN)).toBe(true);
  });

  it("rejects a pattern that will not compile", () => {
    expect(isValidTicketPattern("([unclosed")).toBe(false);
  });

  it("accepts an empty pattern — that is 'off', not 'broken'", () => {
    expect(isValidTicketPattern("")).toBe(true);
  });
});
