import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One file save/open path (#435).
 *
 * Theme and settings export used to write its file with a `Blob`, an
 * `<a download>` and a synthetic click; import used a hidden
 * `<input type="file">`. WebKitGTK ignores the download attribute, so on Linux
 * every export button did nothing — silently, which is why the bug survived a
 * release.
 *
 * Both are browser affordances in an app that has native dialogs, so this is a
 * guard in the same family as the `Command::new` and native `<select>` guards:
 * the rule is only as good as the test that fails the build for breaking it.
 */

const SRC = join(process.cwd(), "src");

/** Every shipped `.ts`/`.tsx` under `src/`, tests and the test harness excluded. */
function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // `src/test/` is the unit suite's own harness, not shipped code.
      if (entry === "test") continue;
      shippedFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

const rel = (f: string) => f.slice(process.cwd().length + 1);

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  {
    pattern: /URL\.createObjectURL/,
    what: "a blob URL for a download — WebKitGTK ignores <a download>",
  },
  {
    pattern: /\.download\s*=/,
    what: "an <a download> assignment — use saveTextFile from @/lib/userFile",
  },
  {
    pattern: /type=["']file["']/,
    what: 'an <input type="file"> — use openTextFile from @/lib/userFile',
  },
];

describe("one file save/open path", () => {
  const files = shippedFiles(SRC);

  it("finds shipped source to check", () => {
    // A traversal bug that returned [] would make every assertion below pass
    // while asserting nothing.
    expect(files.length).toBeGreaterThan(100);
  });

  for (const { pattern, what } of FORBIDDEN) {
    it(`no shipped file under src/ uses ${what}`, () => {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(
        offenders.map(rel),
        "Use src/lib/userFile.ts (saveTextFile / openTextFile) instead. See docs/dev/frontend.md.",
      ).toEqual([]);
    });
  }

  it("lib/userFile.ts is the only module that imports the dialog plugin's save()", () => {
    // The IMPORT CLAUSE, not the whole file: `createPatch.ts` legitimately
    // imports `open` for a directory picker and says "Save patch to" in the
    // dialog's title, and a body-wide search for the word reads that as a
    // violation.
    const clause = /import\s*\{([^}]*)\}\s*from\s*["']@tauri-apps\/plugin-dialog["']/;
    const importers = files.filter((f) => {
      const m = clause.exec(readFileSync(f, "utf8"));
      if (!m) return false;
      return m[1]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
        .includes("save");
    });
    expect(importers.map(rel)).toEqual(["src/lib/userFile.ts"]);
  });
});
