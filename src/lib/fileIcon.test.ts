import { describe, expect, it } from "vitest";
import { GENERIC_FILE_ICON, fileIconSpec } from "./fileIcon";

describe("fileIconSpec", () => {
  it("resolves by extension, case-insensitively", () => {
    expect(fileIconSpec("src/lib/tree.ts").icon).toBe("fileCode");
    expect(fileIconSpec("README.MD").icon).toBe("fileDoc");
    expect(fileIconSpec("a/b/style.SCSS").icon).toBe("fileStyle");
  });

  it("tints same-category languages differently", () => {
    // Glyph is per category, color is per language — that pairing is the whole
    // point of the map, so a regression that collapses either is caught here.
    const ts = fileIconSpec("main.ts");
    const js = fileIconSpec("main.js");
    expect(ts.icon).toBe(js.icon);
    expect(ts.color).not.toBe(js.color);
  });

  it("prefers an exact basename over the extension", () => {
    // package-lock.json is a lockfile, not JSON.
    expect(fileIconSpec("package-lock.json").icon).toBe("fileLock");
    expect(fileIconSpec("package.json").icon).toBe("fileData");
    expect(fileIconSpec("Dockerfile").icon).toBe("fileConfig");
    expect(fileIconSpec(".gitignore").icon).toBe("fileGit");
  });

  it("only inspects the basename", () => {
    expect(fileIconSpec("some.rs.dir/notes.md").icon).toBe("fileDoc");
  });

  it("falls back to the generic file glyph", () => {
    expect(fileIconSpec("mystery.qqq")).toEqual(GENERIC_FILE_ICON);
    expect(fileIconSpec("Makefile.unknownsuffixthing")).toEqual(GENERIC_FILE_ICON);
    expect(fileIconSpec("noextension")).toEqual(GENERIC_FILE_ICON);
    // A leading-dot file with no second dot has no extension to read.
    expect(fileIconSpec(".bashrc")).toEqual(GENERIC_FILE_ICON);
  });

  it("tolerates the trailing slash libgit2 puts on an embedded repo", () => {
    expect(fileIconSpec("vendor/thing/")).toEqual(GENERIC_FILE_ICON);
    expect(fileIconSpec("vendor/notes.md/").icon).toBe("fileDoc");
  });

  it("returns only themeable CSS custom properties as colors", () => {
    for (const p of ["a.ts", "a.js", "a.png", "a.zip", "Cargo.lock", "x.unknown"]) {
      expect(fileIconSpec(p).color).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});
