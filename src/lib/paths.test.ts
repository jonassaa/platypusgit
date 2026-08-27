// Path arithmetic for "Copy path" / "Copy relative path" (#245). Pure, so every
// platform's separator and every degenerate input is testable from any host.
import { describe, expect, it } from "vitest";

import {
  absoluteInWorkdir,
  isAbsolutePath,
  normalizeSeparators,
  relativeToWorkdir,
} from "./paths";

describe("normalizeSeparators", () => {
  it("turns backslashes into forward slashes", () => {
    expect(normalizeSeparators("src\\lib\\paths.ts")).toBe("src/lib/paths.ts");
    expect(normalizeSeparators("C:\\repo\\a.txt")).toBe("C:/repo/a.txt");
  });

  it("collapses repeated separators and drops trailing ones", () => {
    expect(normalizeSeparators("src//lib/")).toBe("src/lib");
    expect(normalizeSeparators("src\\lib\\\\")).toBe("src/lib");
    expect(normalizeSeparators("/repo/")).toBe("/repo");
  });

  it("keeps a lone root", () => {
    expect(normalizeSeparators("/")).toBe("/");
    expect(normalizeSeparators("\\")).toBe("/");
  });

  it("passes the empty string through", () => {
    expect(normalizeSeparators("")).toBe("");
  });
});

describe("isAbsolutePath", () => {
  it("recognises posix, drive-letter and UNC roots", () => {
    expect(isAbsolutePath("/repo/a.txt")).toBe(true);
    expect(isAbsolutePath("C:\\repo\\a.txt")).toBe(true);
    expect(isAbsolutePath("c:/repo/a.txt")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\a.txt")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolutePath("src/a.txt")).toBe(false);
    expect(isAbsolutePath("src\\a.txt")).toBe(false);
    expect(isAbsolutePath("./a.txt")).toBe(false);
    expect(isAbsolutePath("../a.txt")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
  });
});

describe("relativeToWorkdir", () => {
  it("strips the workdir prefix from an absolute path", () => {
    expect(relativeToWorkdir("/repo", "/repo/src/a.txt")).toBe("src/a.txt");
  });

  it("tolerates trailing separators on either side", () => {
    expect(relativeToWorkdir("/repo/", "/repo/src/a.txt")).toBe("src/a.txt");
    expect(relativeToWorkdir("/repo", "/repo/src/")).toBe("src");
  });

  it("normalises Windows separators on both sides", () => {
    expect(relativeToWorkdir("C:\\repo", "C:\\repo\\src\\a.txt")).toBe(
      "src/a.txt",
    );
    expect(relativeToWorkdir("C:\\repo\\", "C:/repo/src/a.txt")).toBe(
      "src/a.txt",
    );
  });

  it("compares Windows paths case-insensitively, posix paths exactly", () => {
    expect(relativeToWorkdir("C:\\Repo", "c:\\repo\\a.txt")).toBe("a.txt");
    // Case matters on a posix workdir — /Repo and /repo are two directories.
    expect(relativeToWorkdir("/Repo", "/repo/a.txt")).toBeNull();
  });

  it("returns a path that is already relative unchanged (normalised)", () => {
    expect(relativeToWorkdir("/repo", "src/a.txt")).toBe("src/a.txt");
    expect(relativeToWorkdir("/repo", "src\\a.txt")).toBe("src/a.txt");
    expect(relativeToWorkdir("/repo", "./src/a.txt")).toBe("src/a.txt");
  });

  it("returns null for an absolute path outside the workdir", () => {
    expect(relativeToWorkdir("/repo", "/etc/passwd")).toBeNull();
    expect(relativeToWorkdir("/repo", "/repo-other/a.txt")).toBeNull();
    // The sibling-prefix trap: /repository must not become "sitory/a.txt".
    expect(relativeToWorkdir("/repo", "/repository/a.txt")).toBeNull();
  });

  it("returns the empty string for the workdir itself", () => {
    expect(relativeToWorkdir("/repo", "/repo")).toBe("");
    expect(relativeToWorkdir("/repo", "/repo/")).toBe("");
  });

  it("returns null when there is no workdir to measure against", () => {
    expect(relativeToWorkdir(undefined, "/repo/a.txt")).toBeNull();
    expect(relativeToWorkdir(null, "/repo/a.txt")).toBeNull();
    expect(relativeToWorkdir("", "/repo/a.txt")).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(relativeToWorkdir("/repo", "")).toBeNull();
  });
});

describe("absoluteInWorkdir", () => {
  it("joins a relative path onto a posix workdir", () => {
    expect(absoluteInWorkdir("/repo", "src/a.txt")).toBe("/repo/src/a.txt");
    expect(absoluteInWorkdir("/repo/", "src/a.txt")).toBe("/repo/src/a.txt");
  });

  it("joins with backslashes when the workdir is a Windows path", () => {
    expect(absoluteInWorkdir("C:\\repo", "src/a.txt")).toBe(
      "C:\\repo\\src\\a.txt",
    );
    expect(absoluteInWorkdir("C:/repo", "src\\a.txt")).toBe(
      "C:\\repo\\src\\a.txt",
    );
    expect(absoluteInWorkdir("\\\\server\\share", "a.txt")).toBe(
      "\\\\server\\share\\a.txt",
    );
  });

  it("drops trailing separators on the input path", () => {
    expect(absoluteInWorkdir("/repo", "src/")).toBe("/repo/src");
  });

  it("returns an already-absolute path unchanged", () => {
    expect(absoluteInWorkdir("/repo", "/elsewhere/a.txt")).toBe(
      "/elsewhere/a.txt",
    );
    expect(absoluteInWorkdir("/repo", "C:\\x\\a.txt")).toBe("C:\\x\\a.txt");
  });

  it("returns the workdir itself for an empty relative path", () => {
    expect(absoluteInWorkdir("/repo", "")).toBe("/repo");
    expect(absoluteInWorkdir("/repo/", "")).toBe("/repo");
  });

  it("returns null when there is no workdir and the path is relative", () => {
    expect(absoluteInWorkdir(undefined, "src/a.txt")).toBeNull();
    expect(absoluteInWorkdir("", "src/a.txt")).toBeNull();
  });
});
