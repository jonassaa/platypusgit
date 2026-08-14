import { describe, expect, it } from "vitest";
import { LANG_LOADERS, langForPath } from "./langs";

describe("langForPath", () => {
  it("maps by extension", () => {
    expect(langForPath("src/a.ts")).toBe("typescript");
    expect(langForPath("src/a.tsx")).toBe("tsx");
    expect(langForPath("main.rs")).toBe("rust");
    expect(langForPath("x/y/z.py")).toBe("python");
  });

  it("maps files that have no extension by name", () => {
    expect(langForPath("Dockerfile")).toBe("docker");
    expect(langForPath("deploy/Dockerfile")).toBe("docker");
    expect(langForPath("Makefile")).toBe("make");
  });

  it("is case-insensitive on the basename", () => {
    expect(langForPath("README.MD")).toBe("markdown");
    expect(langForPath("DOCKERFILE")).toBe("docker");
  });

  it("returns null for unknown or extension-less files", () => {
    expect(langForPath("LICENSE")).toBeNull();
    expect(langForPath("a.unknownext")).toBeNull();
    expect(langForPath("")).toBeNull();
  });

  it("has a loader for every language it can return", () => {
    const langs = [
      "typescript", "tsx", "javascript", "jsx", "rust", "python", "go",
      "java", "kotlin", "swift", "c", "cpp", "csharp", "ruby", "php",
      "lua", "sql", "shellscript", "json", "yaml", "toml", "xml", "html",
      "css", "scss", "markdown", "docker", "make", "graphql", "ini", "diff",
    ] as const;
    for (const l of langs) {
      expect(typeof LANG_LOADERS[l]).toBe("function");
    }
  });

  it("never maps a path to a language with no loader", () => {
    for (const p of ["a.ts", "a.tsx", "a.rs", "Dockerfile", "Makefile", "a.toml", "a.sh"]) {
      const l = langForPath(p);
      expect(l).not.toBeNull();
      expect(LANG_LOADERS[l!]).toBeDefined();
    }
  });
});
