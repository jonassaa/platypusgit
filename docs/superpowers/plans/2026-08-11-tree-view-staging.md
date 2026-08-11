# Tree View Staging (#61 A4/A5/A6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the file tree a real staging surface — per-file-type icons, tri-state staging checkboxes with folder stage/discard, and a tree ⇄ flat toggle in both RepoBrowser and CommitPanel.

**Architecture:** Pure logic lands in `src/lib/` (`fileIcons.ts` for extension→glyph/tint, `tree.ts` for the staging rollup and a shared `expandTreeKeys`). `src/design/` primitives gain optional props and stay dumb — they read state off the node, never import app logic. A new presentational `src/features/repo/ChangeTree.tsx` picks tree-vs-flat rendering; the two screens keep owning selection, keyboard and store calls.

**Tech Stack:** React 18 + TypeScript, Zustand, Tailwind v4 (CSS-var tokens), vitest + React Testing Library, WebdriverIO for e2e.

**Spec:** `docs/superpowers/specs/2026-08-11-tree-view-staging-design.md`

## Global Constraints

- Run `pnpm`/`cargo` with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` prefixed — the tool shell does not inherit the interactive rc.
- Work only in this worktree: `/Users/jonas/dev/fun/platypusgit/.claude/worktrees/tree-view-61`, branch `feat/tree-view-staging`. Never `cd` to the primary checkout.
- Never commit to `main`. Conventional Commits (`feat(scope):` / `fix(scope):` / `test:` / `docs:`), imperative subject under 72 chars, trailing `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Import UI primitives from `@/design` (the barrel), never per-file. Use the `@/` alias, not relative `../../`.
- `src/design/` must not import from `src/features/` or `src/lib/` except **type-only** imports. Runtime app logic stays out of the design system.
- Colors come from CSS vars (`var(--accent-2)`, `var(--fg-3)`, …). No literal hex or `oklch()` values in new code.
- Do not change `--row-h`. New checkboxes are 14px inside the existing 22px row.
- Every existing `PGFileTree` / `PGChangeRow` / `PGFileTreeRow` mount site must render unchanged when the new optional props are omitted.
- Frontend never calls `invoke()` directly — go through `@/lib/tauri` wrappers. This slice adds no backend ops.

---

### Task 1: File-type icons

**Files:**
- Create: `src/lib/fileIcons.ts`
- Create: `src/lib/fileIcons.test.ts`
- Modify: `src/design/icons.tsx` (the `IconName` union near line 3, and the `ICONS` record)

**Interfaces:**
- Consumes: `IconName` from `@/design`.
- Produces: `fileIcon(path: string): FileIcon` where `interface FileIcon { icon: IconName; tint: string }`. Task 2 calls it; Task 5 calls it for flat rows.

`fileCode` and `lock` already exist in the icon set — reuse them. Seven new glyphs are needed: `fileMarkup`, `fileStyle`, `fileConfig`, `fileDoc`, `fileImage`, `fileArchive`, `fileBinary`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fileIcons.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/fileIcons.test.ts
```

Expected: FAIL — cannot resolve `./fileIcons`.

- [ ] **Step 3: Add the seven glyphs to the icon set**

In `src/design/icons.tsx`, extend the `IconName` union — the line currently reading
`| "folder" | "folderOpen" | "file" | "fileCode"` becomes:

```tsx
  | "folder" | "folderOpen" | "file" | "fileCode"
  | "fileMarkup" | "fileStyle" | "fileConfig" | "fileDoc"
  | "fileImage" | "fileArchive" | "fileBinary"
```

Then add these entries to the `ICONS` record, next to the existing `fileCode` entry. They are 16×16 stroke glyphs matching the set's existing style (the sheet renders with `fill="none"` + `stroke="currentColor"`):

```tsx
  fileMarkup: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <path d="M6.5 8.5 5 10l1.5 1.5M9.5 8.5 11 10l-1.5 1.5" />
  </>,
  fileStyle: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <path d="M8 8.25 9.75 10 8 11.75 6.25 10 8 8.25z" />
  </>,
  fileConfig: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <circle cx="8" cy="10" r="1.5" />
    <path d="M8 7.5v1M8 11.5v1M6 10H5M11 10h-1" />
  </>,
  fileDoc: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <path d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3" />
  </>,
  fileImage: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <circle cx="6.25" cy="9" r="0.75" />
    <path d="M4.5 12.5 7 10l1.5 1.5L10 10l2 2.5" />
  </>,
  fileArchive: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <path d="M6.5 2v2M7.5 4v2M6.5 6v2M7.5 8v2" />
    <rect x="6.25" y="10" width="2" height="2.5" rx="0.5" />
  </>,
  fileBinary: <>
    <path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
    <path d="M5.5 8.5h1.5v4H5.5zM9 8.5h1.5v4H9z" />
  </>,
```

- [ ] **Step 4: Write the mapping module**

Create `src/lib/fileIcons.ts`:

```ts
import type { IconName } from "@/design";

export interface FileIcon {
  /** Glyph from the design system's icon set. */
  icon: IconName;
  /** CSS var expression for the glyph color. */
  tint: string;
}

const FALLBACK: FileIcon = { icon: "file", tint: "var(--fg-2)" };

const CODE: FileIcon = { icon: "fileCode", tint: "var(--accent-2)" };
const MARKUP: FileIcon = { icon: "fileMarkup", tint: "var(--accent-2)" };
const STYLE: FileIcon = { icon: "fileStyle", tint: "var(--accent-4)" };
const CONFIG: FileIcon = { icon: "fileConfig", tint: "var(--accent-3)" };
const DOC: FileIcon = { icon: "fileDoc", tint: "var(--fg-2)" };
const IMAGE: FileIcon = { icon: "fileImage", tint: "var(--accent-5)" };
const LOCK: FileIcon = { icon: "lock", tint: "var(--fg-3)" };
const ARCHIVE: FileIcon = { icon: "fileArchive", tint: "var(--fg-3)" };
const BINARY: FileIcon = { icon: "fileBinary", tint: "var(--fg-3)" };

const BY_EXT: Record<string, FileIcon> = {
  ts: CODE, tsx: CODE, js: CODE, jsx: CODE, mjs: CODE, cjs: CODE,
  rs: CODE, py: CODE, go: CODE, rb: CODE, java: CODE, kt: CODE,
  c: CODE, h: CODE, cpp: CODE, hpp: CODE, cs: CODE, swift: CODE,
  sh: CODE, bash: CODE, zsh: CODE, fish: CODE, sql: CODE, lua: CODE,
  html: MARKUP, htm: MARKUP, xml: MARKUP, svg: MARKUP, vue: MARKUP, svelte: MARKUP,
  css: STYLE, scss: STYLE, sass: STYLE, less: STYLE,
  json: CONFIG, jsonc: CONFIG, toml: CONFIG, yaml: CONFIG, yml: CONFIG,
  ini: CONFIG, env: CONFIG, conf: CONFIG, cfg: CONFIG, properties: CONFIG,
  gitignore: CONFIG, gitattributes: CONFIG, editorconfig: CONFIG,
  md: DOC, mdx: DOC, txt: DOC, rst: DOC, adoc: DOC, pdf: DOC,
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE,
  ico: IMAGE, avif: IMAGE, bmp: IMAGE,
  lock: LOCK,
  zip: ARCHIVE, tar: ARCHIVE, gz: ARCHIVE, tgz: ARCHIVE, bz2: ARCHIVE,
  xz: ARCHIVE, rar: ARCHIVE, "7z": ARCHIVE,
  exe: BINARY, dll: BINARY, so: BINARY, dylib: BINARY, a: BINARY,
  bin: BINARY, wasm: BINARY, woff: BINARY, woff2: BINARY, ttf: BINARY, otf: BINARY,
};

/**
 * Whole-filename matches, checked BEFORE the extension. `pnpm-lock.yaml` is a
 * lockfile, not a YAML config, and `Dockerfile` has no extension at all.
 */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: CONFIG,
  makefile: CONFIG,
  "cargo.lock": LOCK,
  "pnpm-lock.yaml": LOCK,
  "package-lock.json": LOCK,
  "yarn.lock": LOCK,
  license: DOC,
  notice: DOC,
};

/**
 * Resolve a repo-relative path to a glyph + tint. Unknown extensions fall back
 * to the generic `file` glyph, so a new file type is never a blank row.
 */
export function fileIcon(path: string): FileIcon {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  // dot === 0 is a leading-dot file (".env") — its suffix IS the extension.
  if (dot < 0) return FALLBACK;
  return BY_EXT[name.slice(dot + 1)] ?? FALLBACK;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/fileIcons.test.ts && pnpm tsc --noEmit
```

Expected: PASS, and a clean type-check.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fileIcons.ts src/lib/fileIcons.test.ts src/design/icons.tsx
git commit -m "feat(tree): file-type icon families + 7 glyphs (#61 A4)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Staging rollup on the tree

**Files:**
- Modify: `src/lib/tree.ts` (`MutableNode` ~line 5, `buildStatusTree` ~line 44)
- Modify: `src/design/git-components.tsx` (`PGFileTreeNode` interface, line 19-25)
- Modify: `src/lib/tree.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `fileIcon` from Task 1; `isStaged` / `isUnstaged` from `@/lib/derive`.
- Produces: `export type StageState = "none" | "some" | "all"`. `PGFileTreeNode` gains `staged?: StageState`, `icon?: IconName`, `iconColor?: string`. Tasks 4-7 read these.

Rollup runs **after** compaction, so a merged `src/features/repo` node reports its real descendants rather than a pre-merge intermediate.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tree.test.ts`:

```ts
function staged(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Modified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

function partial(path: string): FileStatus {
  return { ...staged(path), worktree: { kind: "Modified" } };
}

describe("buildStatusTree — staging rollup (A5)", () => {
  it("marks a fully staged leaf 'all' and an unstaged leaf 'none'", () => {
    const tree = buildStatusTree([staged("a.ts"), file("b.ts")]);
    const byName = Object.fromEntries(tree.map((n) => [n.name, n]));
    expect(byName["a.ts"].staged).toBe("all");
    expect(byName["b.ts"].staged).toBe("none");
  });

  it("marks a partially staged leaf 'some'", () => {
    const tree = buildStatusTree([partial("a.ts")]);
    expect(tree[0].staged).toBe("some");
  });

  it("rolls a folder up to 'all' when every changed child is staged", () => {
    const tree = buildStatusTree([staged("src/a.ts"), staged("src/b.ts")]);
    expect(tree[0].name).toBe("src");
    expect(tree[0].staged).toBe("all");
  });

  it("rolls a folder up to 'some' when children disagree", () => {
    const tree = buildStatusTree([staged("src/a.ts"), file("src/b.ts")]);
    expect(tree[0].staged).toBe("some");
  });

  it("rolls a folder up to 'none' when no child is staged", () => {
    const tree = buildStatusTree([file("src/a.ts"), file("src/b.ts")]);
    expect(tree[0].staged).toBe("none");
  });

  it("rolls up through a COMPACTED chain, not the pre-merge intermediate", () => {
    const tree = buildStatusTree([
      staged("src/features/repo/a.ts"),
      file("src/features/repo/b.ts"),
    ]);
    expect(tree[0].name).toBe("src/features/repo");
    expect(tree[0].staged).toBe("some");
  });

  it("leaves unmodified files and their folders without a rollup", () => {
    const unmodified: FileStatus = {
      path: "docs/readme.md",
      worktree: { kind: "Unmodified" },
      index: { kind: "Unmodified" },
      additions: 0,
      deletions: 0,
      embedded: false,
    };
    const tree = buildStatusTree([unmodified]);
    expect(tree[0].staged).toBeUndefined();
    expect(tree[0].children?.[0].staged).toBeUndefined();
  });

  it("ignores unmodified siblings when rolling a folder up", () => {
    const unmodified: FileStatus = {
      path: "src/untouched.ts",
      worktree: { kind: "Unmodified" },
      index: { kind: "Unmodified" },
      additions: 0,
      deletions: 0,
      embedded: false,
    };
    const tree = buildStatusTree([staged("src/a.ts"), unmodified]);
    expect(tree[0].staged).toBe("all");
  });

  it("decorates leaves with a file-type icon and tint", () => {
    const tree = buildStatusTree([file("src/index.css")]);
    const leaf = tree[0].children?.[0];
    expect(leaf?.icon).toBe("fileStyle");
    expect(leaf?.iconColor).toBe("var(--accent-4)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/tree.test.ts
```

Expected: FAIL — `staged` / `icon` are `undefined` on every node.

- [ ] **Step 3: Extend `PGFileTreeNode`**

In `src/design/git-components.tsx`, replace the `PGFileTreeNode` interface (line 19-25) with:

```tsx
/** Tri-state staging rollup. `undefined` = nothing stageable here. */
export type PGStageState = "none" | "some" | "all";

export interface PGFileTreeNode {
  name: string;
  status?: string;
  defaultExpanded?: boolean;
  children?: PGFileTreeNode[];
  extra?: ReactNode;
  /** Staging state of this node (leaf) or its changed descendants (folder). */
  staged?: PGStageState;
  /** File-type glyph; falls back to the generic file/folder icon when absent. */
  icon?: IconName;
  /** CSS var expression for the glyph color. */
  iconColor?: string;
}
```

- [ ] **Step 4: Implement the rollup in `buildStatusTree`**

In `src/lib/tree.ts`, update the imports and `MutableNode`:

```ts
import type { IconName, PGFileTreeNode, PGStageState } from "@/design";
import type { FileStatus } from "./types";
import { isStaged, isUnstaged, statusMark } from "./derive";
import { fileIcon } from "./fileIcons";

export type StageState = PGStageState;

interface MutableNode {
  name: string;
  status?: string;
  children?: MutableNode[];
  defaultExpanded?: boolean;
  staged?: StageState;
  icon?: IconName;
  iconColor?: string;
}
```

Add the leaf classifier above `buildStatusTree`:

```ts
/**
 * Staging state of one file. `undefined` for an unmodified file — that is the
 * signal to render no checkbox at all, rather than an empty one.
 *
 * An embedded repo keeps a "none" state (and therefore a checkbox) so the
 * existing stage guard can flash its explanation on click, matching what the
 * flat CommitPanel row does today.
 */
function leafStageState(f: FileStatus): StageState | undefined {
  const st = isStaged(f);
  const wt = isUnstaged(f);
  if (!st && !wt) return undefined;
  if (st && wt) return "some";
  return st ? "all" : "none";
}
```

Inside the `for (const f of files)` loop, the leaf-creation branch currently reads
`next = isLeaf ? { name: part, status: hasChange ? statusMark(f) : undefined } : { name: part, children: [] };`
— replace it with:

```ts
      if (!next) {
        if (isLeaf) {
          const { icon, tint } = fileIcon(f.path);
          next = {
            name: part,
            status: hasChange ? statusMark(f) : undefined,
            staged: leafStageState(f),
            icon,
            iconColor: tint,
          };
        } else {
          next = { name: part, children: [] };
        }
        cursor.children.push(next);
      }
```

Add the rollup pass, and run it after compaction:

```ts
/**
 * Bottom-up staging rollup over changed descendants only. Must run AFTER
 * compaction — compaction merges folder chains, so a rollup computed before it
 * would be attached to an intermediate node that no longer renders.
 */
function rollupStaged(node: MutableNode): StageState | undefined {
  if (!node.children) return node.staged;
  let seen = false;
  let allStaged = true;
  let noneStaged = true;
  for (const child of node.children) {
    const s = rollupStaged(child);
    if (s === undefined) continue;
    seen = true;
    if (s !== "all") allStaged = false;
    if (s !== "none") noneStaged = false;
  }
  node.staged = !seen ? undefined : allStaged ? "all" : noneStaged ? "none" : "some";
  return node.staged;
}
```

In `buildStatusTree`, the tail currently reads:

```ts
  let children = root.children ?? [];
  if (compact) children = children.map(compactNode);
```

Append the rollup immediately after that pair of lines:

```ts
  children.forEach(rollupStaged);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/tree.test.ts && pnpm tsc --noEmit
```

Expected: PASS, including the pre-existing compaction tests (the rollup must not disturb them).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/design/git-components.tsx
git commit -m "feat(tree): tri-state staging rollup + icon decoration (#61 A5)

Why: rollup runs after compaction so a merged src/features/repo node
reports its real descendants, not a pre-merge intermediate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extract `expandTreeKeys`

**Files:**
- Modify: `src/lib/tree.ts` (append)
- Modify: `src/lib/tree.test.ts` (append a describe block)
- Modify: `src/screens/RepoBrowser.tsx:291-337` (`splitSelection`)

**Interfaces:**
- Consumes: `findStatusByPath` (already in `tree.ts`).
- Produces:
  ```ts
  export function expandTreeKeys<T extends { path: string }>(
    keys: readonly string[],
    opts: { lookup: readonly (readonly T[])[]; descendants: readonly T[] },
  ): T[]
  ```
  Task 7 calls it from CommitPanel.

This is a **behavior-preserving extraction** of the loop at `RepoBrowser.tsx:322-333`. It is load-bearing for Discard, so the tests pin the current semantics — including the embedded-repo entry whose path carries a trailing slash.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tree.test.ts`:

```ts
describe("expandTreeKeys", () => {
  const a = file("src/a.ts");
  const b = file("src/nested/b.ts");
  const c = file("docs/c.md");
  const all = [a, b, c];

  it("resolves a file key to its own entry", () => {
    expect(expandTreeKeys(["/src/a.ts"], { lookup: [all], descendants: all }))
      .toEqual([a]);
  });

  it("expands a folder key to every descendant, including nested ones", () => {
    expect(expandTreeKeys(["/src"], { lookup: [all], descendants: all }))
      .toEqual([a, b]);
  });

  it("expands a nested folder key", () => {
    expect(expandTreeKeys(["/src/nested"], { lookup: [all], descendants: all }))
      .toEqual([b]);
  });

  it("deduplicates when a file and its parent folder are both selected", () => {
    const out = expandTreeKeys(["/src", "/src/a.ts"], {
      lookup: [all],
      descendants: all,
    });
    expect(out).toEqual([a, b]);
  });

  it("searches lookup lists in order", () => {
    const shadow = { ...file("src/a.ts"), additions: 99 };
    const out = expandTreeKeys(["/src/a.ts"], {
      lookup: [[shadow], all],
      descendants: all,
    });
    expect(out[0]).toBe(shadow);
  });

  it("resolves an embedded-repo key despite its trailing slash", () => {
    const embedded: FileStatus = {
      ...file("vendor/lib/", "Untracked"),
      embedded: true,
    };
    const files = [...all, embedded];
    expect(
      expandTreeKeys(["/vendor/lib"], { lookup: [files], descendants: files }),
    ).toEqual([embedded]);
  });

  it("returns nothing for a key that matches no file and no prefix", () => {
    expect(expandTreeKeys(["/nope"], { lookup: [all], descendants: all }))
      .toEqual([]);
  });
});
```

Add `expandTreeKeys` to the existing import block at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/tree.test.ts
```

Expected: FAIL — `expandTreeKeys` is not exported.

- [ ] **Step 3: Implement it in `src/lib/tree.ts`**

Append:

```ts
/**
 * Resolve tree row keys to the file entries they act on.
 *
 * A key that matches a file yields that file. A key that matches nothing is
 * treated as a FOLDER prefix and yields every entry beneath it — otherwise a
 * selected folder is silently dropped from a Stage or Discard batch,
 * under-counting a destructive op.
 *
 * `lookup` lists are searched in order for the direct hit (the caller decides
 * precedence, e.g. worktree status before the all-files list); `descendants` is
 * the set scanned for the prefix expansion, and should be the same set the tree
 * was built from so a batch never reaches a row the user cannot see.
 */
export function expandTreeKeys<T extends { path: string }>(
  keys: readonly string[],
  opts: { lookup: readonly (readonly T[])[]; descendants: readonly T[] },
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const add = (entry: T) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    out.push(entry);
  };
  for (const key of keys) {
    const hit = findStatusByTreeKey(key, ...opts.lookup);
    if (hit) {
      add(hit);
      continue;
    }
    const prefix = treeKeyToPath(key) + "/";
    for (const child of opts.descendants) {
      if (child.path.startsWith(prefix)) add(child);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/lib/tree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Rewrite `RepoBrowser.splitSelection` to use it**

In `src/screens/RepoBrowser.tsx`, add `expandTreeKeys` to the existing `@/lib/tree` import, then replace the body of `splitSelection` (the `for (const key of keys)` loop, lines 322-333) so the function reads:

```tsx
      const stagedPaths: string[] = [];
      const unstagedPaths: string[] = [];
      const embeddedPaths: string[] = [];
      const untrackedPaths: string[] = [];
      const paths: string[] = [];
      const add = (st: FileStatus) => {
        paths.push(st.path);
        // An embedded repo counts and copies like any row, but it is not a
        // file — keep it out of the stage/unstage/discard subsets so a batch
        // built from this selection never carries it to the backend.
        if (st.embedded) {
          embeddedPaths.push(st.path);
          return;
        }
        if (isStaged(st)) stagedPaths.push(st.path);
        if (isUnstaged(st)) unstagedPaths.push(st.path);
        if (isUntracked(st)) untrackedPaths.push(st.path);
      };
      for (const st of expandTreeKeys(keys, {
        lookup: [status, allFiles],
        descendants: filteredStatus,
      })) {
        add(st);
      }
      return { stagedPaths, unstagedPaths, paths, embeddedPaths, untrackedPaths };
```

The local `seen` set and its dedup guard go away — `expandTreeKeys` already dedupes by path.

- [ ] **Step 6: Verify nothing regressed**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run && pnpm tsc --noEmit
```

Expected: full unit suite PASS (350+ tests), clean type-check.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/screens/RepoBrowser.tsx
git commit -m "refactor(tree): extract expandTreeKeys from splitSelection

Why: CommitPanel needs identical folder-to-descendant semantics for tree
mode. Sharing one implementation keeps the embedded-repo exclusion and the
filteredStatus scoping from drifting between the two screens.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Row primitives — checkbox slot and icons

**Files:**
- Modify: `src/design/git-components.tsx` (`PGFileTreeRowProps` 27-41, `PGFileTreeRow` 43-134, `PGFileTreeProps` 136-148, `PGFileTree` 182+, `PGChangeRowProps` + `PGChangeRow` 310+)
- Create: `src/design/file-rows.test.tsx`

**Interfaces:**
- Consumes: `PGStageState`, `IconName`, `PGCheckbox` (already supports `indeterminate`).
- Produces:
  - `PGFileTreeRow` props `checkboxSlot?: boolean`, `checked?: boolean`, `indeterminate?: boolean`, `onCheck?: (v: boolean) => void`, `icon?: IconName`, `iconColor?: string`.
  - `PGFileTree` props `checkboxSlot?: boolean`, `onCheck?: (key: string, node: PGFileTreeNode) => void`.
  - `PGChangeRow` props `icon?: IconName`, `iconColor?: string`; `status` becomes optional.

  Task 5 consumes all of these.

- [ ] **Step 1: Write the failing test**

Create `src/design/file-rows.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PGFileTree, PGChangeRow, type PGFileTreeNode } from "./git-components";

const nodes: PGFileTreeNode[] = [
  {
    name: "src",
    staged: "some",
    defaultExpanded: true,
    children: [
      { name: "a.ts", status: "M", staged: "all", icon: "fileCode" },
      { name: "b.ts", status: "M", staged: "none", icon: "fileCode" },
      { name: "c.ts", staged: undefined },
    ],
  },
];

describe("PGFileTree checkboxes", () => {
  it("renders no checkbox at all when onCheck is omitted", () => {
    const { container } = render(<PGFileTree nodes={nodes} expanded={{ "/src": true }} />);
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(0);
  });

  it("renders a checkbox only for nodes carrying a staged state", () => {
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
      />,
    );
    // src (some), a.ts (all), b.ts (none) — but not c.ts (undefined).
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(3);
  });

  it("reserves the gutter for a row with no checkbox so names stay aligned", () => {
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-testid='row-toggle-slot']")).toHaveLength(4);
  });

  it("reports the node key when a checkbox is clicked", () => {
    const onCheck = vi.fn();
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={onCheck}
      />,
    );
    const boxes = container.querySelectorAll("[data-testid='row-toggle'] input");
    fireEvent.click(boxes[0]);
    expect(onCheck).toHaveBeenCalledWith("/src", expect.objectContaining({ name: "src" }));
  });

  it("does not select the row when the checkbox is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
        onSelect={onSelect}
      />,
    );
    const box = container.querySelector("[data-testid='row-toggle'] input")!;
    fireEvent.click(box);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("PGChangeRow", () => {
  it("renders no status mark when status is omitted", () => {
    const { container } = render(<PGChangeRow path="src/a.ts" />);
    expect(container.querySelector("[data-pg-status]")).toBeNull();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("renders the supplied file-type icon", () => {
    const { container } = render(
      <PGChangeRow path="src/a.ts" status="M" icon="fileCode" iconColor="var(--accent-2)" />,
    );
    expect(container.querySelector("[data-icon='fileCode']")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/design/file-rows.test.tsx
```

Expected: FAIL — unknown props, and no `row-toggle` / `data-icon` markers exist.

- [ ] **Step 3: Add a `data-icon` marker to `PGIcon`**

The test needs to assert *which* glyph rendered. In `src/design/icons.tsx`, the `PGIcon` component's root `<svg>` gains one attribute:

```tsx
      data-icon={name}
```

Place it alongside the existing `width`/`height`/`viewBox` attributes. This is inert in production and makes every icon assertion in the suite straightforward.

- [ ] **Step 4: Extend `PGFileTreeRow`**

Replace `PGFileTreeRowProps` (lines 27-41) with:

```tsx
export interface PGFileTreeRowProps {
  name: string;
  path?: string;
  indent?: number;
  kind?: "file" | "folder";
  status?: string;
  expanded?: boolean;
  hasChildren?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  extra?: ReactNode;
  hideStatus?: boolean;
  /** Reserve the checkbox gutter even on rows that have no checkbox. */
  checkboxSlot?: boolean;
  checked?: boolean;
  indeterminate?: boolean;
  /** When set (and `checked` is defined), the row renders a staging checkbox. */
  onCheck?: (v: boolean) => void;
  /** File-type glyph; falls back to the generic file/folder icon. */
  icon?: IconName;
  iconColor?: string;
}
```

Add the matching parameters to the destructuring in `PGFileTreeRow`, then insert the checkbox immediately after the chevron `<span>` (i.e. before the `<PGIcon>` that draws the file/folder glyph):

```tsx
      {checkboxSlot && (
        <span
          data-testid="row-toggle-slot"
          style={{ width: 14, flexShrink: 0, display: "inline-flex" }}
          onClick={(e) => e.stopPropagation()}
        >
          {checked !== undefined && onCheck && (
            <span data-testid="row-toggle">
              <PGCheckbox
                checked={checked}
                indeterminate={indeterminate}
                onChange={onCheck}
              />
            </span>
          )}
        </span>
      )}
```

The `onClick` + `stopPropagation` on the slot is what keeps a checkbox click from also selecting the row.

Finally, make the glyph honor the override — replace the existing `<PGIcon name={…} style={…} />` block with:

```tsx
      <PGIcon
        name={
          kind === "folder"
            ? expanded
              ? "folderOpen"
              : "folder"
            : (icon ?? "file")
        }
        size={12}
        style={{
          color:
            kind === "folder"
              ? "var(--accent-4)"
              : (iconColor ?? "var(--fg-2)"),
        }}
      />
```

- [ ] **Step 5: Thread it through `PGFileTree`**

Add to `PGFileTreeProps`:

```tsx
  /** Reserve the checkbox gutter on every row. */
  checkboxSlot?: boolean;
  /** Staging toggle. Rows whose node has no `staged` state render no checkbox. */
  onCheck?: (key: string, node: PGFileTreeNode) => void;
```

Destructure both in `PGFileTree`, and pass them to each `PGFileTreeRow` inside the `flat.map(...)`:

```tsx
          checkboxSlot={checkboxSlot}
          checked={
            f.node.staged === undefined ? undefined : f.node.staged === "all"
          }
          indeterminate={f.node.staged === "some"}
          onCheck={onCheck ? () => onCheck(f.key, f.node) : undefined}
          icon={f.node.icon}
          iconColor={f.node.iconColor}
```

- [ ] **Step 6: Extend `PGChangeRow`**

In `PGChangeRowProps`, change `status: string` to `status?: string` and add:

```tsx
  icon?: IconName;
  iconColor?: string;
```

In the body, guard the status mark and honor the icon override — replace

```tsx
      <PGStatusMark kind={status} size={14} />
      <PGIcon
        name="file"
        size={11}
        style={{ color: "var(--fg-3)", flexShrink: 0 }}
      />
```

with

```tsx
      {status ? (
        <PGStatusMark kind={status} size={14} />
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}
      <PGIcon
        name={icon ?? "file"}
        size={11}
        style={{ color: iconColor ?? "var(--fg-3)", flexShrink: 0 }}
      />
```

Check `PGStatusMark` — if it does not already carry a `data-pg-status` attribute on its root, add one, since the test asserts absence through it.

- [ ] **Step 7: Run tests to verify they pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run && pnpm tsc --noEmit
```

Expected: the new file passes and the whole suite stays green — every existing mount site omits the new props and must render as before.

- [ ] **Step 8: Commit**

```bash
git add src/design/git-components.tsx src/design/icons.tsx src/design/file-rows.test.tsx
git commit -m "feat(design): checkbox slot + file-type icons on file rows (#61 A4/A5)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The `ChangeTree` component

**Files:**
- Create: `src/features/repo/ChangeTree.tsx`
- Create: `src/features/repo/ChangeTree.test.tsx`

**Interfaces:**
- Consumes: `PGFileTree` / `PGChangeRow` (Task 4), `fileIcon` (Task 1), `treeKeyToPath` (`@/lib/tree`), `statusMark` (`@/lib/derive`).
- Produces:
  ```tsx
  export type ChangeTreeViewMode = "tree" | "flat";
  export interface ChangeTreeSlot { path: string; status: FileStatus }
  export function ChangeTree(props: ChangeTreeProps): JSX.Element
  ```
  Tasks 6 and 7 mount it.

Presentational only — no store access, no selection state, no keyboard handling. `keyOf` converts a raw tree key (`/a/b`) into whatever key form the host screen uses, so RepoBrowser keeps `/a/b` and CommitPanel keeps `side:path`.

- [ ] **Step 1: Write the failing test**

Create `src/features/repo/ChangeTree.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeTree } from "./ChangeTree";
import { buildStatusTree } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

function mod(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 1,
    deletions: 0,
    embedded: false,
  };
}

const files = [mod("src/a.ts"), mod("src/nested/b.ts")].map((s) => ({
  path: s.path,
  status: s,
}));
const nodes = buildStatusTree(files.map((f) => f.status));

function base() {
  return {
    files,
    nodes,
    expanded: { "/src": true, "/src/nested": true },
    onToggleExpand: vi.fn(),
    selectedKeys: new Set<string>(),
    onSelect: vi.fn(),
    keyOf: (k: string) => k,
    checkboxes: "none" as const,
  };
}

describe("ChangeTree", () => {
  it("renders nested rows in tree mode", () => {
    render(<ChangeTree {...base()} viewMode="tree" />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("nested")).toBeInTheDocument();
  });

  it("renders full paths and no folder rows in flat mode", () => {
    render(<ChangeTree {...base()} viewMode="flat" />);
    expect(screen.queryByText("nested")).toBeNull();
    expect(screen.getByText("src/nested/")).toBeInTheDocument();
  });

  it("shows the same file count in both modes", () => {
    const { container: treeC } = render(<ChangeTree {...base()} viewMode="tree" />);
    const { container: flatC } = render(<ChangeTree {...base()} viewMode="flat" />);
    const treeFiles = treeC.querySelectorAll("[data-pg-row][data-path$='.ts']");
    const flatFiles = flatC.querySelectorAll("[data-pg-row]");
    expect(treeFiles).toHaveLength(2);
    expect(flatFiles).toHaveLength(2);
  });

  it("emits the screen's key form through keyOf", () => {
    const onSelect = vi.fn();
    render(
      <ChangeTree
        {...base()}
        viewMode="tree"
        onSelect={onSelect}
        keyOf={(k) => `staged:${k.replace(/^\//, "")}`}
      />,
    );
    fireEvent.click(screen.getByText("a.ts"));
    expect(onSelect).toHaveBeenCalledWith("staged:src/a.ts", expect.anything());
  });

  it("renders no checkboxes when checkboxes is 'none'", () => {
    const { container } = render(<ChangeTree {...base()} viewMode="tree" />);
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(0);
  });

  it("renders checkboxes for changed rows when 'changed-only'", () => {
    const { container } = render(
      <ChangeTree {...base()} viewMode="tree" checkboxes="changed-only" onCheck={vi.fn()} />,
    );
    // 2 files + src + src/nested folders all carry a rollup.
    expect(container.querySelectorAll("[data-testid='row-toggle']").length).toBeGreaterThan(0);
  });

  it("reports the checked key through keyOf", () => {
    const onCheck = vi.fn();
    const { container } = render(
      <ChangeTree
        {...base()}
        viewMode="tree"
        checkboxes="changed-only"
        onCheck={onCheck}
        keyOf={(k) => `u:${k.replace(/^\//, "")}`}
      />,
    );
    const box = container.querySelector("[data-testid='row-toggle'] input")!;
    fireEvent.click(box);
    expect(onCheck).toHaveBeenCalledWith(expect.stringMatching(/^u:/));
  });

  it("applies file-type icons in flat mode too", () => {
    const { container } = render(<ChangeTree {...base()} viewMode="flat" />);
    expect(container.querySelector("[data-icon='fileCode']")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/features/repo/ChangeTree.test.tsx
```

Expected: FAIL — cannot resolve `./ChangeTree`.

- [ ] **Step 3: Implement the component**

Create `src/features/repo/ChangeTree.tsx`:

```tsx
import React from "react";
import { PGFileTree, PGChangeRow, type PGFileTreeNode } from "@/design";
import { statusMark } from "@/lib/derive";
import { fileIcon } from "@/lib/fileIcons";
import { treeKeyToPath } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

export type ChangeTreeViewMode = "tree" | "flat";

/** Minimum a row needs: its path plus the status it renders from. */
export interface ChangeTreeSlot {
  path: string;
  status: FileStatus;
}

export interface ChangeTreeProps {
  /** Flat file list — the source for flat mode, and for row counts. */
  files: readonly ChangeTreeSlot[];
  /** Pre-built tree for tree mode. Callers already memoize this. */
  nodes: PGFileTreeNode[];
  viewMode: ChangeTreeViewMode;
  expanded: Record<string, boolean>;
  onToggleExpand?: (key: string) => void;
  /** Selection is owned by the screen; these are keys in the screen's key form. */
  selectedKeys: ReadonlySet<string>;
  primaryKey?: string;
  onSelect: (key: string, e?: React.MouseEvent) => void;
  onActivate?: (key: string) => void;
  onRowContextMenu?: (e: React.MouseEvent, key: string, node?: PGFileTreeNode) => void;
  /** Staging toggle. Receives the screen's key form. */
  onCheck?: (key: string) => void;
  checkboxes: "always" | "changed-only" | "none";
  showStatus?: boolean;
  /**
   * Map a raw tree key ("/a/b") to the host screen's key form. RepoBrowser
   * passes identity; CommitPanel prefixes the side ("staged:a/b").
   */
  keyOf: (rawKey: string) => string;
}

/**
 * Renders a set of changed files as a nested tree or a flat list, with optional
 * staging checkboxes and file-type icons.
 *
 * Deliberately presentational: it owns no selection, no keyboard handling and
 * no store access, mirroring `CommitDiffPanel`. Screens keep computing row
 * order from the pure `flattenFileTree`, which is what lets CommitPanel's
 * shift-range selection keep crossing its STAGED/CHANGES boundary while two
 * separate ChangeTrees render the two halves.
 */
export function ChangeTree({
  files,
  nodes,
  viewMode,
  expanded,
  onToggleExpand,
  selectedKeys,
  primaryKey,
  onSelect,
  onActivate,
  onRowContextMenu,
  onCheck,
  checkboxes,
  showStatus = true,
  keyOf,
}: ChangeTreeProps) {
  if (viewMode === "flat") {
    return (
      <>
        {files.map((f) => {
          const key = keyOf(`/${f.path}`);
          const { icon, tint } = fileIcon(f.path);
          const staged = checkboxes === "none" ? undefined : isFullyStaged(f.status);
          return (
            <PGChangeRow
              key={key}
              path={f.path}
              status={showStatus ? statusMark(f.status) : undefined}
              icon={icon}
              iconColor={tint}
              additions={f.status.additions}
              deletions={f.status.deletions}
              staged={staged}
              selected={selectedKeys.has(key)}
              onClick={(e) => onSelect(key, e)}
              onContextMenu={
                onRowContextMenu ? (e) => onRowContextMenu(e, key) : undefined
              }
              onToggle={onCheck ? () => onCheck(key) : undefined}
            />
          );
        })}
      </>
    );
  }

  return (
    <PGFileTree
      nodes={nodes}
      expanded={expanded}
      onToggle={onToggleExpand}
      selected={primaryKey}
      selectedKeys={selectedKeys}
      showStatus={showStatus}
      checkboxSlot={checkboxes !== "none"}
      onCheck={onCheck ? (rawKey) => onCheck(keyOf(rawKey)) : undefined}
      onSelect={(rawKey, _node, e) => onSelect(keyOf(rawKey), e)}
      onActivate={onActivate ? (rawKey) => onActivate(keyOf(rawKey)) : undefined}
      onRowContextMenu={
        onRowContextMenu
          ? (e, rawKey, node) => onRowContextMenu(e, keyOf(rawKey), node)
          : undefined
      }
    />
  );
}

/** Flat rows are single-sided, so "staged" is simply whether the index has it. */
function isFullyStaged(s: FileStatus): boolean {
  return s.index.kind !== "Unmodified" && s.worktree.kind === "Unmodified";
}
```

Note: `PGFileTree` derives each row's checkbox from `node.staged`, so `checkboxes: "changed-only"` and `"always"` differ only in RepoBrowser's tree, where unmodified nodes carry no rollup and therefore no box. `treeKeyToPath` is imported for the selection-key mapping the screens pass in via `keyOf`; if the implementation ends up not needing it directly, drop the import rather than leaving it unused.

- [ ] **Step 4: Run test to verify it passes**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/features/repo/ChangeTree.test.tsx && pnpm tsc --noEmit
```

Expected: PASS. If the flat-mode "src/nested/" assertion fails, check how `PGChangeRow` splits dir/file — it renders the directory prefix and basename as separate spans.

- [ ] **Step 5: Commit**

```bash
git add src/features/repo/ChangeTree.tsx src/features/repo/ChangeTree.test.tsx
git commit -m "feat(repo): presentational ChangeTree (tree|flat renderer) (#61 A6)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire RepoBrowser

**Files:**
- Modify: `src/screens/RepoBrowser.tsx` — `expanded` state ~`:105`, prune effect `:268-270`, `fileCtx` `:339-357`, toolbar `:539-548`, tree render site
- Create: `src/screens/RepoBrowser.viewmode.test.tsx`

**Interfaces:**
- Consumes: `ChangeTree` (Task 5), `expandTreeKeys` via the existing `splitSelection` (Task 3).
- Produces: `readViewMode()`, `writeViewMode(mode)`, `validSelectionKeys(viewMode, tree, files)` — exported from `RepoBrowser.tsx` for tests only.

Three changes: mount `ChangeTree` behind a persisted view toggle, give folders a context menu, and make the prune effect view-mode aware.

The prune rule is pulled out as a pure exported function rather than left inline in the effect, so the spec's "folder selections must drop when switching to flat" requirement is directly testable without rendering the whole screen.

- [ ] **Step 1: Write the failing test**

Create `src/screens/RepoBrowser.viewmode.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { readViewMode, writeViewMode, validSelectionKeys } from "./RepoBrowser";
import { buildStatusTree } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

function mod(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("RepoBrowser view mode persistence", () => {
  it("defaults to tree, preserving today's behavior", () => {
    expect(readViewMode()).toBe("tree");
  });

  it("round-trips through localStorage", () => {
    writeViewMode("flat");
    expect(readViewMode()).toBe("flat");
    expect(localStorage.getItem("pg-browser-view")).toBe("flat");
  });

  it("falls back to tree on a corrupt stored value", () => {
    localStorage.setItem("pg-browser-view", "garbage");
    expect(readViewMode()).toBe("tree");
  });
});

describe("validSelectionKeys", () => {
  const files = [mod("src/a.ts"), mod("src/nested/b.ts")];
  const tree = buildStatusTree(files);

  it("keeps folder keys in tree mode", () => {
    const valid = validSelectionKeys("tree", tree, files);
    expect(valid.has("/src")).toBe(true);
    expect(valid.has("/src/a.ts")).toBe(true);
  });

  it("drops folder keys in flat mode but keeps file keys", () => {
    const valid = validSelectionKeys("flat", tree, files);
    expect(valid.has("/src")).toBe(false);
    expect(valid.has("/src/a.ts")).toBe(true);
    expect(valid.has("/src/nested/b.ts")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/screens/RepoBrowser.viewmode.test.tsx
```

Expected: FAIL — `readViewMode` is not exported.

- [ ] **Step 3: Add the persisted view mode**

Near the top of `src/screens/RepoBrowser.tsx`, add:

```tsx
import { ChangeTree, type ChangeTreeViewMode } from "@/features/repo/ChangeTree";

const VIEW_KEY = "pg-browser-view";

/** RepoBrowser defaults to TREE — that is what it has always rendered. */
export function readViewMode(): ChangeTreeViewMode {
  return localStorage.getItem(VIEW_KEY) === "flat" ? "flat" : "tree";
}

export function writeViewMode(mode: ChangeTreeViewMode): void {
  localStorage.setItem(VIEW_KEY, mode);
}
```

Inside the component, beside the existing `expanded` state:

```tsx
  const [viewMode, setViewMode] = React.useState<ChangeTreeViewMode>(readViewMode);
  const changeViewMode = React.useCallback((m: ChangeTreeViewMode) => {
    setViewMode(m);
    writeViewMode(m);
  }, []);
```

- [ ] **Step 4: Make the prune effect view-mode aware**

Add the pure rule at module scope, beside `readViewMode`:

```tsx
/**
 * Selection keys that are still addressable in the given view mode.
 *
 * Tree mode validates against the FULL tree, not just visible rows —
 * collapsing a folder hides rows without deselecting them. Flat mode has no
 * folder rows at all, so folder keys must drop: left alive they are invisible
 * to the user but still expanded by `splitSelection`, silently widening a
 * Stage or Discard batch to files that are not on screen.
 */
export function validSelectionKeys(
  viewMode: ChangeTreeViewMode,
  tree: PGFileTreeNode[],
  files: readonly FileStatus[],
): Set<string> {
  if (viewMode === "flat") return new Set(files.map((s) => `/${s.path}`));
  return new Set(flattenAllKeys(tree));
}
```

Then replace the prune effect at `:268-270` with:

```tsx
  React.useEffect(() => {
    setSel((s) => pruneSelection(s, validSelectionKeys(viewMode, tree, filteredStatus)));
  }, [tree, viewMode, filteredStatus]);
```

- [ ] **Step 5: Give folders a context menu**

In `fileCtx` (`:339-357`), replace the bare `if (node.children?.length) return [];` guard with a folder menu built from the same helper multi-select already uses:

```tsx
      // A folder acts on every file beneath it — splitSelection expands the
      // key, so the menu is identical to selecting those files by hand.
      if (node.children?.length) {
        return multiFileMenuItems(splitSelection([key]));
      }
```

- [ ] **Step 6: Add the toolbar toggle and mount `ChangeTree`**

Beside the existing expand-all / collapse-all buttons (`:539-548`), add:

```tsx
              <PGIconButton
                icon="folderOpen"
                size="xs"
                title="Tree view"
                data-active={viewMode === "tree" ? "" : undefined}
                onClick={() => changeViewMode("tree")}
              />
              <PGIconButton
                icon="file"
                size="xs"
                title="Flat view"
                data-active={viewMode === "flat" ? "" : undefined}
                onClick={() => changeViewMode("flat")}
              />
```

Disable the expand/collapse buttons in flat mode by adding `disabled={viewMode === "flat"}` to each.

Replace the `<PGFileTree … />` render site with:

```tsx
            <ChangeTree
              files={filteredStatus.map((s) => ({ path: s.path, status: s }))}
              nodes={tree}
              viewMode={viewMode}
              expanded={expandedForRender}
              onToggleExpand={(k) =>
                setExpanded((e) => ({ ...e, [k]: !(e[k] ?? false) }))
              }
              selectedKeys={selectedKeys}
              primaryKey={selected ?? undefined}
              onSelect={onTreeSelect}
              onRowContextMenu={onTreeContextMenu}
              onCheck={onTreeCheck}
              checkboxes={browsingRev ? "none" : "changed-only"}
              keyOf={(k) => k}
            />
```

Two call signatures must be narrowed to match, since `ChangeTree` passes a key rather than a node:

- `onTreeSelect` currently takes `(key, _node, e)` — the node argument is already unused, so drop it: `(key: string, e?: React.MouseEvent) => …`.
- `onTreeContextMenu` currently takes `(e, key, node)` and uses `node` only to reach `fileCtx`. Change it to `(e: React.MouseEvent, key: string, node?: PGFileTreeNode)` and pass `fileCtx.onContextMenu(e, { key, node: node ?? { name: key } })`. The `fileCtx` builder already branches on `node.children?.length`, and a folder row always arrives with its node, so the fallback only ever stands in for a file.

- [ ] **Step 7: Implement the checkbox handler**

Add beside `splitSelection`:

```tsx
  // Folder or file checkbox. Stage unless everything beneath is already
  // staged — a partially staged row moves toward fully staged, never backward.
  const onTreeCheck = React.useCallback(
    (key: string) => {
      const { stagedPaths, unstagedPaths } = splitSelection([key]);
      const store = useRepoStore.getState();
      if (unstagedPaths.length > 0) store.stage(unstagedPaths);
      else if (stagedPaths.length > 0) store.unstage(stagedPaths);
    },
    [splitSelection],
  );
```

- [ ] **Step 8: Verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run && pnpm tsc --noEmit
```

Expected: full suite PASS.

- [ ] **Step 9: Commit**

```bash
git add src/screens/RepoBrowser.tsx src/screens/RepoBrowser.viewmode.test.tsx
git commit -m "feat(browser): tree staging, folder menu, tree/flat toggle (#61 A5/A6)

Why: the prune effect now takes viewMode as a dependency — a folder key
selected in tree mode would otherwise survive invisibly into flat mode and
still be expanded by splitSelection, widening a Stage or Discard batch to
rows the user cannot see.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire CommitPanel

**Files:**
- Modify: `src/screens/CommitPanel.tsx` — imports, state, the two `PGChangeRow` map blocks (`:454-467`, `:507-520`), section headers
- Create: `src/screens/CommitPanel.viewmode.test.tsx`

**Interfaces:**
- Consumes: `ChangeTree` (Task 5), `buildStatusTree` + `expandTreeKeys` (Tasks 2, 3).
- Produces: nothing consumed by later tasks.

Two `ChangeTree`s, one per section. Keys stay `side:path`, so `keyOf` prefixes the side. Selection, `usePaneList` and the commit chords are untouched.

- [ ] **Step 1: Write the failing test**

Create `src/screens/CommitPanel.viewmode.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { readViewMode, writeViewMode } from "./CommitPanel";

beforeEach(() => {
  localStorage.clear();
});

describe("CommitPanel view mode persistence", () => {
  it("defaults to flat, preserving today's behavior", () => {
    expect(readViewMode()).toBe("flat");
  });

  it("round-trips through localStorage", () => {
    writeViewMode("tree");
    expect(readViewMode()).toBe("tree");
    expect(localStorage.getItem("pg-commit-view")).toBe("tree");
  });

  it("falls back to flat on a corrupt stored value", () => {
    localStorage.setItem("pg-commit-view", "garbage");
    expect(readViewMode()).toBe("flat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run src/screens/CommitPanel.viewmode.test.tsx
```

Expected: FAIL — `readViewMode` is not exported from `CommitPanel`.

- [ ] **Step 3: Add the persisted view mode**

Near the top of `src/screens/CommitPanel.tsx`:

```tsx
import { ChangeTree, type ChangeTreeViewMode } from "@/features/repo/ChangeTree";
import { buildStatusTree, expandTreeKeys, treeKeyToPath } from "@/lib/tree";

const VIEW_KEY = "pg-commit-view";

/** CommitPanel defaults to FLAT — that is what it has always rendered. */
export function readViewMode(): ChangeTreeViewMode {
  return localStorage.getItem(VIEW_KEY) === "tree" ? "tree" : "flat";
}

export function writeViewMode(mode: ChangeTreeViewMode): void {
  localStorage.setItem(VIEW_KEY, mode);
}
```

Inside the component:

```tsx
  const [viewMode, setViewMode] = React.useState<ChangeTreeViewMode>(readViewMode);
  const changeViewMode = React.useCallback((m: ChangeTreeViewMode) => {
    setViewMode(m);
    writeViewMode(m);
  }, []);
  const [expandedStaged, setExpandedStaged] = React.useState<Record<string, boolean>>({});
  const [expandedUnstaged, setExpandedUnstaged] = React.useState<Record<string, boolean>>({});

  const stagedTree = React.useMemo(
    () => buildStatusTree(staged.map((f) => f.status)),
    [staged],
  );
  const unstagedTree = React.useMemo(
    () => buildStatusTree(unstaged.map((f) => f.status)),
    [unstaged],
  );
```

- [ ] **Step 4: Add the folder-aware toggle handler**

Beside the existing `togglePaths` / `stageToggled`:

```tsx
  /**
   * Checkbox on a tree row. A folder key resolves to every file beneath it in
   * THAT section — each tree is single-sided, so a folder click is always
   * "stage all in folder" (CHANGES) or "unstage all in folder" (STAGED).
   */
  const onSectionCheck = (side: "staged" | "unstaged") => (key: string) => {
    const list = side === "staged" ? staged : unstaged;
    const rawKey = `/${key.slice(side.length + 1)}`;
    const hits = expandTreeKeys([rawKey], { lookup: [list], descendants: list });
    const paths = hits.filter((f) => !f.status.embedded).map((f) => f.path);
    if (paths.length === 0) {
      // Single embedded row — say why instead of silently doing nothing.
      if (hits.length > 0) pgFlash(EMBEDDED_REPO_HELP);
      return;
    }
    if (side === "staged") unstage(paths);
    else stage(paths);
  };
```

- [ ] **Step 5: Replace both row lists with `ChangeTree`**

The STAGED block (`:454-467`) becomes:

```tsx
          <ChangeTree
            files={staged}
            nodes={stagedTree}
            viewMode={viewMode}
            expanded={expandedStaged}
            onToggleExpand={(k) =>
              setExpandedStaged((e) => ({ ...e, [k]: !(e[k] ?? false) }))
            }
            selectedKeys={effectiveKeys}
            primaryKey={selected && selected.side === "staged" ? keyOf(selected) : undefined}
            onSelect={(key, e) =>
              setSel((s) =>
                clickSelection(rowOrder, s, key, {
                  toggle: !!e && (e.metaKey || e.ctrlKey),
                  range: !!e?.shiftKey,
                }),
              )
            }
            onRowContextMenu={(e, key) => onKeyContextMenu(key)(e)}
            onCheck={onSectionCheck("staged")}
            checkboxes="always"
            keyOf={(raw) => `staged:${treeKeyToPath(raw)}`}
          />
```

The CHANGES block (`:507-520`) is the same shape with `files={unstaged}`, `nodes={unstagedTree}`, `expanded={expandedUnstaged}` / `setExpandedUnstaged`, `primaryKey` guarded on `selected.side === "unstaged"`, `onCheck={onSectionCheck("unstaged")}` and `keyOf={(raw) => \`unstaged:${treeKeyToPath(raw)}\`}`.

Add a small adapter next to `onRowContextMenu`, since `ChangeTree` hands back a key rather than the `FileSlot` the existing handler expects:

```tsx
  const onKeyContextMenu = (key: string) => (e: React.MouseEvent) => {
    const f = [...staged, ...unstaged].find((s) => keyOf(s) === key);
    if (f) return onRowContextMenu(f)(e);
    // Folder row: collapse the selection to it, then act on its descendants.
    if (!(sel.keys.length > 1 && sel.keys.includes(key))) {
      setSel({ keys: [key], anchor: key });
    }
    const side = key.startsWith("staged:") ? "staged" : "unstaged";
    const list = side === "staged" ? staged : unstaged;
    const rawKey = `/${key.slice(side.length + 1)}`;
    const hits = expandTreeKeys([rawKey], { lookup: [list], descendants: list });
    onFileCtx(e, hits[0] ?? null);
  };
```

- [ ] **Step 6: Add the toolbar toggle**

Add the same two `PGIconButton`s from Task 6 Step 6 into the CHANGES `Header`'s `action` group, calling `changeViewMode`.

- [ ] **Step 7: Verify**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run && pnpm tsc --noEmit
```

Expected: full suite PASS — in particular `src/screens/CommitPanel.keyboard.test.tsx`, which pins the existing selection and Space-to-stage behavior that this task must not disturb.

- [ ] **Step 8: Commit**

```bash
git add src/screens/CommitPanel.tsx src/screens/CommitPanel.viewmode.test.tsx
git commit -m "feat(commit): tree view for staged/changes sections (#61 A6)

Why: two trees rather than one merged tri-state tree — a partially staged
file legitimately appears in both sections, so one merged row would have to
represent a file that is simultaneously staged and unstaged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: E2E coverage and final gates

**Files:**
- Modify: `e2e/support/tempRepo.ts` (add a nested-directory fixture)
- Modify: `e2e/specs/status-stage.e2e.ts` (tree mode + folder staging)

**Interfaces:**
- Consumes: everything above. Produces `nestedDirtyRepo(): TempRepo`.

**Read `.claude/skills/e2e-testing/SKILL.md` before touching any spec** — selector conventions, the 5s-per-command penalty, fixture geometry, and rebuild discipline are all documented there and are easy to get wrong.

`status-stage.e2e.ts` is the right home: it already stages via `rowToggle()`, already stubs native dialogs, and already imports `jsContextMenu` / `jsClickMenuItem`. Do **not** create a new spec file.

The existing `dirtyRepo()` writes only root-level files (`a.txt`, `new.txt`, `staged.txt`), so it produces **no folder rows at all** — a folder test needs a new fixture.

- [ ] **Step 1: Read the e2e skill**

```bash
cat .claude/skills/e2e-testing/SKILL.md
```

- [ ] **Step 2: Add the nested fixture**

In `e2e/support/tempRepo.ts`, beside `dirtyRepo`:

```ts
/**
 * Two modified files under one directory, so the tree renders a real folder
 * row. Path compaction merges single-child chains, so `src/nested/` would
 * collapse into its parent — both files live directly under `src/` to keep
 * `src` a distinct, clickable folder row.
 */
export function nestedDirtyRepo(): TempRepo {
  const r = makeTempRepo();
  r.commitFile("src/one.txt", "one\n", "feat: one");
  r.commitFile("src/two.txt", "two\n", "feat: two");
  r.commitFile("root.txt", "root\n", "feat: root");
  r.write("src/one.txt", "one dirty\n");
  r.write("src/two.txt", "two dirty\n");
  return r;
}
```

- [ ] **Step 3: Add the CommitPanel tree-mode test**

In `e2e/specs/status-stage.e2e.ts`, add these selectors beside the existing `rowToggle`:

```ts
const viewToggle = (mode: "Tree view" | "Flat view") => $(`[title="${mode}"]`);

// Tree rows carry data-path just like flat rows; a folder's path is the
// directory itself. The checkbox testid is shared with PGChangeRow so this
// mirrors rowToggle above.
const treeToggle = (list: "staged-list" | "changes-list", p: string) =>
  $(
    `[data-testid="${list}"] [data-path="${p}"] [data-testid="row-toggle"] input`,
  );
```

Then add the test inside the existing `describe("status & staging")` block:

```ts
  it("stages a whole folder from the tree view", async () => {
    const nested = nestedDirtyRepo();
    await openRepo(nested.path);
    await switchScreen("commit");
    await changeRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the nested changes",
    });

    await viewToggle("Tree view").click();
    const folder = $('[data-testid="changes-list"] [data-path="src"]');
    await folder.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "tree mode never rendered the src folder row",
    });

    await treeToggle("changes-list", "src").click();

    await stagedRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "folder checkbox did not stage src/one.txt",
    });
    await expect(stagedRow("src/two.txt")).toBeDisplayed();
    // root.txt was never modified, so it must not be dragged in.
    await expect(stagedRow("root.txt")).not.toBeExisting();

    nested.dispose();
  });
```

Note the fixture is created inside the test, not in `beforeEach` — the shared `beforeEach` already opens `dirtyRepo`, and this test needs a different repo. `openRepo` replaces the current repo, so re-opening is enough; dispose the extra repo at the end.

- [ ] **Step 4: Add the folder context-menu test**

Still in `status-stage.e2e.ts`:

```ts
  it("offers stage-all on a folder's context menu", async () => {
    const nested = nestedDirtyRepo();
    await openRepo(nested.path);
    await switchScreen("commit");
    await changeRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "commit screen never showed the nested changes",
    });
    await viewToggle("Tree view").click();
    await $('[data-testid="changes-list"] [data-path="src"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "tree mode never rendered the src folder row",
    });

    // Before this branch a folder right-click produced an EMPTY menu.
    await jsContextMenu('[data-testid="changes-list"] [data-path="src"]');
    await jsClickMenuItem("Stage 2 files");

    await stagedRow("src/one.txt").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "folder context menu did not stage the folder",
    });
    await expect(stagedRow("src/two.txt")).toBeDisplayed();

    nested.dispose();
  });
```

Add `nestedDirtyRepo` to the existing `../support/tempRepo` import. `jsContextMenu` and `jsClickMenuItem` are already imported by this spec.

- [ ] **Step 5: Rebuild the e2e snapshot and run only these two specs**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:build
pnpm test:e2e:run --spec e2e/specs/status-stage.e2e.ts --spec e2e/specs/commit.e2e.ts
```

The rebuild is mandatory — `test:e2e:run` silently tests the previous binary otherwise. Both flows are single-window, so a native macOS run is fine.

- [ ] **Step 6: Run every gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test --run
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all four clean. No backend change is expected in this slice; the cargo gate is there to prove it.

- [ ] **Step 7: Commit**

```bash
git add e2e/specs
git commit -m "test(e2e): folder staging + tree mode coverage (#61 A5/A6)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Squash and open the PR**

Per CLAUDE.md the PR squash-merges, so squash locally first for a clean message:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
git fetch origin
git rebase origin/main
git reset --soft origin/main
git commit -m "feat(tree): staging in the tree, file-type icons, tree/flat toggle (#61)

Implements #61 Tier 1 items A4, A5 and A6.

- A4: nine file-type icon families resolved by extension, seven new glyphs
- A5: tri-state staging checkboxes in the tree plus folder stage/discard,
  sharing one expandTreeKeys implementation with multi-select so the
  embedded-repo exclusion cannot drift between screens
- A6: persisted tree/flat toggle in both RepoBrowser and CommitPanel

CommitPanel renders two trees rather than one merged tri-state tree: a
partially staged file legitimately appears in both sections.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/tree-view-staging
gh pr create --title "feat(tree): staging in the tree, file-type icons, tree/flat toggle (#61)" --body "$(cat <<'EOF'
Implements Tier 1 items **A4**, **A5** and **A6** of #61. Tier 0 landed in `fa398c9`.

## What changed

- **A4 — file-type icons.** Nine families resolved by extension (code, markup, style, config, doc, image, lock, archive, binary), seven new stroke glyphs; `fileCode` and `lock` were already in the set. Generic `file` remains the fallback, so an unknown extension is never a blank row.
- **A5 — staging in the tree.** Tri-state checkboxes on tree rows (checked / indeterminate / empty, rolled up over folders) plus a folder context menu with Stage / Unstage / Discard. Folder ops share one `expandTreeKeys` implementation with multi-select, so the embedded-repo exclusion cannot drift between the two screens.
- **A6 — tree ⇄ flat toggle** in both RepoBrowser and CommitPanel, persisted per screen. Defaults preserve today's behavior exactly: RepoBrowser tree, CommitPanel flat.

## Notable decisions

**Two trees in CommitPanel, not one merged tri-state tree.** A partially staged file legitimately appears in both STAGED and CHANGES, so one merged row would have to represent a file that is simultaneously staged and unstaged, plus a rule for which side the diff pane shows. Two trees keeps `side:path` keys, the cross-section shift-range and side-keyed diff loading untouched.

**A presentational `ChangeTree`, not props on `PGFileTree`.** Both screens need the same renderer; putting it in the design system would have pushed a 1792-line file past 2100 and duplicated the tree/flat branch in both screens. Follows the `CommitDiffPanel` precedent from #53.

**Prune-on-view-change.** A folder key selected in tree mode would otherwise survive invisibly into flat mode and still be expanded by `splitSelection`, silently widening a Stage or Discard batch to rows the user cannot see. The prune rule is now a pure, tested function.

## Not in this PR

A7 (tree speed-search / range select), A8 (virtualization), B4 (theme token remap). Icon tints use `--accent-2..5`, which `applyTheme` does not yet remap — pre-existing, and they inherit the fix for free once B4 lands.

## Testing

Unit: icon mapping, staging rollup incl. the compaction interaction, `expandTreeKeys` folder expansion and embedded exclusion, view-mode persistence and prune rule. Component: `ChangeTree` tree-vs-flat, tri-state checkbox, checkbox-click does not select the row. E2E: folder staging via checkbox and via context menu, on a new nested fixture.

Gates run: `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, `pnpm test`, `cargo test`, and the two touched e2e specs.

Closes none — #61 stays open for the remaining Tier 1-3 items.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **`src/design/` may not import app logic.** `ChangeTree` lives in `features/repo/` precisely so `fileIcon` never has to be imported from the design system. `lib/tree.ts` importing the `IconName` *type* from `@/design` is fine — types erase at compile time.
- **The rollup must run after compaction.** If a compacted `src/features/repo` node shows the wrong checkbox state, that ordering is why.
- **Discard is destructive and folder-scoped now.** Any change to `expandTreeKeys` or `splitSelection` must keep embedded repos out of the returned batch — `src/lib/tree.test.ts` pins this, and so does the existing untracked-delete confirmation.
- **`--accent-2..5` are not remapped by `applyTheme`** (issue #61 item B4, still open), so icon tints keep default hues under custom themes. Pre-existing — the folder icon already uses `--accent-4`. Do not fix it here.
