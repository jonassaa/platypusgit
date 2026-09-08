import { describe, expect, it } from "vitest";

import { fullCommitMessage } from "./commitMessageText";

describe("fullCommitMessage", () => {
  it("joins summary and body with a blank line", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: "Why: y" })).toBe(
      "feat: x\n\nWhy: y",
    );
  });

  it("is the summary alone when there is no body", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: null })).toBe("feat: x");
  });

  it("treats a whitespace-only body as no body", () => {
    expect(fullCommitMessage({ summary: "feat: x", body: "  \n\n " })).toBe("feat: x");
  });

  it("trims trailing whitespace off the body but keeps its internal blank lines", () => {
    expect(fullCommitMessage({ summary: "s", body: "one\n\ntwo\n\n" })).toBe(
      "s\n\none\n\ntwo",
    );
  });
});
