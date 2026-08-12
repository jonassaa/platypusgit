import { describe, it, expect } from "vitest";
import { deriveRepoName } from "./deriveRepoName";

describe("deriveRepoName", () => {
  it("takes the last path segment and strips .git", () => {
    expect(deriveRepoName("https://github.com/org/repo.git")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo")).toBe("repo");
  });

  it("handles the scp-like SSH form", () => {
    expect(deriveRepoName("git@github.com:org/repo.git")).toBe("repo");
    expect(deriveRepoName("ssh://git@github.com/org/repo.git")).toBe("repo");
  });

  it("ignores trailing slashes", () => {
    expect(deriveRepoName("https://github.com/org/repo.git/")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo//")).toBe("repo");
  });

  it("ignores query strings and fragments", () => {
    expect(deriveRepoName("https://github.com/org/repo.git?ref=x")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo#readme")).toBe("repo");
  });

  it("handles local paths", () => {
    expect(deriveRepoName("/srv/git/repo.git")).toBe("repo");
    expect(deriveRepoName("file:///srv/git/repo.git")).toBe("repo");
  });

  it("returns empty string when there is nothing to derive", () => {
    expect(deriveRepoName("")).toBe("");
    expect(deriveRepoName("   ")).toBe("");
    expect(deriveRepoName("https://github.com/")).toBe("");
    expect(deriveRepoName("https://github.com")).toBe("");
  });

  it("keeps dots that are part of the repository name", () => {
    // These regressed once due to a heuristic that filtered out any segment
    // with a dot that wasn't .git. Dots are valid in repo names.
    expect(deriveRepoName("https://github.com/vercel/next.js")).toBe("next.js");
    expect(deriveRepoName("https://github.com/socketio/socket.io")).toBe("socket.io");
    expect(deriveRepoName("git@github.com:org/my.repo")).toBe("my.repo");
  });

  it("handles URLs with ports", () => {
    // Port numbers are followed by / or end-of-string; must not be treated as scp-like form
    expect(deriveRepoName("https://gitlab.example.com:8443")).toBe("");
    expect(deriveRepoName("https://gitlab.example.com:8443/")).toBe("");
    expect(deriveRepoName("https://gitlab.example.com:8443/org/repo.git")).toBe("repo");
    expect(deriveRepoName("ssh://git@host:2222/org/repo.git")).toBe("repo");
  });

  it("handles URLs with userinfo (user:pass@host)", () => {
    // Userinfo must be stripped before checking for colons
    expect(deriveRepoName("https://user:pass@gitlab.example.com")).toBe("");
    expect(deriveRepoName("https://user:pass@host/org/repo.git")).toBe("repo");
  });

  it("handles Windows paths with backslashes", () => {
    expect(deriveRepoName("C:\\Users\\me\\repos\\repo.git")).toBe("repo");
    expect(deriveRepoName("C:/Users/me/repos/repo.git")).toBe("repo");
  });
});
