import { describe, it, expect } from "vitest";
import { fileIcon } from "./fileIcons";

describe("fileIcon", () => {
  it("maps code extensions to the code glyph and accent-2", () => {
    expect(fileIcon("src/App.tsx")).toEqual({
      icon: "fileCode",
      tint: "var(--accent-2)",
    });
    expect(fileIcon("src-tauri/src/lib.rs").icon).toBe("fileCode");
  });

  it("maps style, config, doc, image families", () => {
    expect(fileIcon("src/index.css")).toEqual({
      icon: "fileStyle",
      tint: "var(--accent-4)",
    });
    expect(fileIcon("tauri.conf.json")).toEqual({
      icon: "fileConfig",
      tint: "var(--accent-3)",
    });
    expect(fileIcon("README.md")).toEqual({
      icon: "fileDoc",
      tint: "var(--fg-2)",
    });
    expect(fileIcon("assets/logo.png")).toEqual({
      icon: "fileImage",
      tint: "var(--accent-5)",
    });
  });

  it("is case-insensitive on the extension", () => {
    expect(fileIcon("A.TSX").icon).toBe("fileCode");
    expect(fileIcon("Logo.PNG").icon).toBe("fileImage");
  });

  it("matches whole-filename special cases before the extension", () => {
    // pnpm-lock.yaml must be a lock, not config-via-.yaml
    expect(fileIcon("pnpm-lock.yaml").icon).toBe("lock");
    expect(fileIcon("Cargo.lock").icon).toBe("lock");
    expect(fileIcon("Dockerfile").icon).toBe("fileConfig");
    expect(fileIcon("Makefile").icon).toBe("fileConfig");
  });

  it("treats a leading-dot file's suffix as its extension", () => {
    expect(fileIcon(".env").icon).toBe("fileConfig");
    expect(fileIcon(".gitignore").icon).toBe("fileConfig");
  });

  it("falls back for unknown and extensionless names", () => {
    expect(fileIcon("weird.qqq")).toEqual({ icon: "file", tint: "var(--fg-2)" });
    expect(fileIcon("NOTICE").icon).toBe("file");
    // Embedded-repo entries arrive with a trailing slash and no basename.
    expect(fileIcon("vendor/lib/").icon).toBe("file");
  });
});
