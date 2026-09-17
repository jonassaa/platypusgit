// The demo repository the site figures are shot against.
//
// Content is transcribed from the shipped 2026-08-18 hero, which is an approved
// composition: the same seven refs, the same four fictional authors, the same
// selected commit and diff. Reproducing it keeps the new figure directly
// comparable to the one it replaces, so a reviewer is judging the UI change and
// nothing else.
//
// EVERYTHING here is typed against src/lib/types.ts on purpose. That is what
// contains the drift risk the hand-built AppShowcase replica died of: when a
// backend shape changes, this file stops compiling instead of quietly rendering
// a figure of a product that no longer exists.
//
// No real person appears. The authors are invented, and the repository is a toy
// expression evaluator that exists only to make a good screenshot.
import type {
  BranchInfo,
  CommitInfo,
  DiffLine,
  FileDiff,
  FileStatus,
  HeadInfo,
  LogPage,
  RefInfo,
  RemoteInfo,
  RepoHandle,
} from "@/lib/types";

export const SHOWCASE_PATH = "/Users/jonas/pgit-showcase";
export const SHOWCASE_ID = "showcase";

export const HANDLE: RepoHandle = {
  id: SHOWCASE_ID,
  path: SHOWCASE_PATH,
  head: "main",
};

// 2026-06-26 10:30 +0200, the showcase repository's own HEAD date. Scenes freeze
// the clock a month later, which is what makes the age column read "1mo ago".
const T0 = Math.floor(new Date("2026-06-26T10:30:00+02:00").getTime() / 1000);
const DAY = 86400;

const ref = (name: string, kind: RefInfo["kind"]): RefInfo => ({ name, kind });

/**
 * Expand a short oid into a full 40-hex one, deterministically.
 *
 * Zero-padding is not good enough: the commit-detail pane prints the FULL oid,
 * and `335d8fe0000000000000000000000000000000` in the hero announces that the
 * figure is fabricated. A tiny seeded PRNG gives hex that reads like a real sha
 * and is identical on every run, which the frozen clock's whole point requires.
 */
function fullOid(shortOid: string): string {
  let h = 0;
  for (const c of shortOid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let out = shortOid;
  while (out.length < 40) {
    // xorshift32 — deterministic, and plenty for making plausible hex.
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

/** Short oids of a commit's parents; resolved to full oids after the list is
 *  built. Omitted means "the next commit in the list", i.e. a linear chain. */
type Opts = { body?: string; refs?: RefInfo[]; parents?: string[] };

function commit(
  shortOid: string,
  summary: string,
  author: string,
  email: string,
  ageDays: number,
  opts: Opts = {},
): CommitInfo & { _parents?: string[] } {
  return {
    oid: fullOid(shortOid),
    shortOid,
    summary,
    body: opts.body ?? null,
    author,
    email,
    timestamp: T0 - ageDays * DAY,
    parents: [],
    refs: opts.refs ?? [],
    _parents: opts.parents,
  };
}

const JONAS = ["Jonas Aasberg", "jonas@example.com"] as const;
const KOFI = ["Kofi Mensah", "kofi@example.com"] as const;
const ANA = ["Ana Ruiz", "ana@example.com"] as const;
const YUKI = ["Yuki Tanaka", "yuki@example.com"] as const;

/**
 * The visible history. The first twelve are what the approved composition
 * shows; the rest exist so the list scrolls like a real repository rather than
 * ending in dead space.
 */
export const COMMITS: (CommitInfo & { _parents?: string[] })[] = [
  commit("335d8fe", "refactor(evaluator): dispatch through the engine table", ...JONAS, 0, {
    refs: [ref("main", "Branch")],
    body:
      "The evaluator had its own four-case switch, which meant every operator\n" +
      "added to the engine also had to be added here or it parsed and then\n" +
      "failed at evaluation.\n\n" +
      "One dispatcher now, and the engine's own test covers both.",
  }),
  commit("e3677fd", "docs: start a changelog", ...JONAS, 1, {
    parents: ["9dc9843"],
  }),
  // Two side branches off the merge, which is what gives the graph its two
  // short lanes beside main in the approved composition.
  commit("e0d61e5", "fix(engine): one divisor check across div, mod and idiv", ...KOFI, 2, {
    refs: [ref("fix/div-by-zero-message", "Branch")],
    parents: ["9dc9843"],
  }),
  commit("628b622", "feat(repl): line-at-a-time REPL, work in progress", ...ANA, 3, {
    refs: [ref("feat/repl", "Branch"), ref("origin/feat/repl", "Remote")],
    parents: ["9dc9843"],
  }),
  commit("9dc9843", "merge: docs site and parse benchmark", ...JONAS, 4, {
    refs: [ref("origin/main", "Remote")],
    parents: ["913d3bf", "63f5166"],
  }),
  // Both topic branches fork from the same commit, so the merge above closes a
  // real diamond rather than a line with a label on it.
  commit("913d3bf", "docs(site): plan the docs site layout", ...ANA, 5, {
    refs: [ref("topic/docs-site", "Branch")],
    parents: ["16377ac"],
  }),
  commit("63f5166", "test(bench): benchmark the parser's worst case", ...ANA, 6, {
    refs: [ref("topic/bench", "Branch")],
    parents: ["16377ac"],
  }),
  commit("16377ac", "fix(engine): document that div raises on a zero divisor", ...JONAS, 7),
  commit("1a9aa90", "feat(engine): add atan2d for the degrees-first callers", ...KOFI, 9),
  commit("166e07c", "docs: write down the grammar", ...YUKI, 34),
  commit("037f1da", "feat(scope): add a scope chain with shadowing", ...KOFI, 36),
  commit("e279622", "test(parser): pin precedence and the parenthesis override", ...ANA, 38),
  // Below the fold — present so the list does not end mid-window.
  commit("b41c0aa", "feat(parser): parenthesised sub-expressions", ...YUKI, 41),
  commit("7c2e8d5", "fix(lexer): accept a leading dot in a float literal", ...KOFI, 44),
  commit("d90a17b", "test(engine): cover every unary operator", ...ANA, 46),
  commit("2f6b4e1", "feat(engine): unary minus and logical not", ...JONAS, 49),
  commit("aa3f902", "docs: a README worth reading", ...YUKI, 52),
  commit("5e81c34", "refactor(lexer): one token enum, not three", ...KOFI, 55),
  commit("c17d5b8", "feat(parser): precedence climbing", ...JONAS, 58),
  commit("90ab2e7", "test(lexer): pin the number grammar", ...ANA, 61),
  commit("41f7c60", "feat(lexer): numbers, identifiers and operators", ...KOFI, 64),
  commit("8b5e2a9", "chore: set up the test harness", ...YUKI, 67),
  commit("6d4c1f3", "chore: initial commit", ...JONAS, 70),
];

// Resolve each commit's parents. A commit that named none inherits the next one
// in the list — the list is newest-first, so that is an ordinary linear chain.
// The last commit keeps none, which is what makes it the root.
//
// This runs once, at module load, rather than being written out by hand on every
// entry: a parent list spelled in full is a parent list that goes stale the
// first time a commit is inserted, and a wrong one is not a crash — it is a
// subtly wrong graph in a marketing figure, and `(root) → <sha>` in the diff
// header where a real parent belongs.
for (let i = 0; i < COMMITS.length; i++) {
  const c = COMMITS[i] as CommitInfo & { _parents?: string[] };
  const named = c._parents;
  c.parents = named
    ? named.map(fullOid)
    : i + 1 < COMMITS.length
      ? [COMMITS[i + 1].oid]
      : [];
  delete c._parents;
}

export const LOG_PAGE: LogPage = { commits: COMMITS, nextCursor: null };

/**
 * HEAD. Derived from the top commit rather than written out, so the two cannot
 * disagree — and they must not: the `HEAD→main` pill on the first row is drawn
 * by matching this oid against the log, so a stale literal here silently costs
 * the hero its most recognisable label.
 */
export const HEAD: HeadInfo = {
  branch: "main",
  headOid: COMMITS[0].oid,
};

/** The status bar's "4 changed", and the commit screen's file list. */
export const STATUS: FileStatus[] = [
  {
    path: "src/engine.ts",
    embedded: false,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 12,
    deletions: 4,
  },
  {
    path: "src/evaluator.ts",
    embedded: false,
    worktree: { kind: "Unmodified" },
    index: { kind: "Modified" },
    additions: 2,
    deletions: 7,
    stagedAdditions: 2,
    stagedDeletions: 7,
  },
  {
    path: "test/engine.test.ts",
    embedded: false,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 31,
    deletions: 0,
  },
  {
    path: "docs/operators.md",
    embedded: false,
    worktree: { kind: "Untracked" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
  },
];

/**
 * The branch list. `main` carries `ahead: 2` because that is what puts the
 * `main ↑2` chip in the titlebar and `↑2 ↓0` in the status bar — both visible
 * in the approved composition, and both read from here rather than from the log.
 */
export const BRANCHES: BranchInfo[] = [
  {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: "origin/main",
    ahead: 2,
    behind: 0,
    tip: COMMITS[0].oid,
    tipTime: COMMITS[0].timestamp,
    isDefault: true,
  },
  {
    name: "fix/div-by-zero-message",
    isHead: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: COMMITS[2].oid,
    tipTime: COMMITS[2].timestamp,
    isDefault: false,
  },
  {
    name: "feat/repl",
    isHead: false,
    isRemote: false,
    upstream: "origin/feat/repl",
    ahead: 0,
    behind: 0,
    tip: COMMITS[3].oid,
    tipTime: COMMITS[3].timestamp,
    isDefault: false,
  },
  {
    name: "topic/docs-site",
    isHead: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: COMMITS[5].oid,
    tipTime: COMMITS[5].timestamp,
    isDefault: false,
  },
  {
    name: "topic/bench",
    isHead: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: COMMITS[6].oid,
    tipTime: COMMITS[6].timestamp,
    isDefault: false,
  },
  {
    name: "origin/main",
    isHead: false,
    isRemote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: COMMITS[4].oid,
    tipTime: COMMITS[4].timestamp,
    isDefault: true,
  },
  {
    name: "origin/feat/repl",
    isHead: false,
    isRemote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: COMMITS[3].oid,
    tipTime: COMMITS[3].timestamp,
    isDefault: false,
  },
];

export const REMOTES: RemoteInfo[] = [
  { name: "origin", url: "https://example.com/pgit-showcase.git" },
];

// ─── The selected commit's diff ──────────────────────────────────────────────

const ctx = (content: string, oldLineno: number, newLineno: number): DiffLine => ({
  kind: { kind: "Context" },
  oldLineno,
  newLineno,
  content,
});
const add = (content: string, newLineno: number): DiffLine => ({
  kind: { kind: "Addition" },
  oldLineno: null,
  newLineno,
  content,
});
const del = (content: string, oldLineno: number): DiffLine => ({
  kind: { kind: "Deletion" },
  oldLineno,
  newLineno: null,
  content,
});

/**
 * `src/evaluator.ts` as the selected commit changed it: +2 −7, which is the
 * `+2 −7` the approved composition shows on the file row. The visible window of
 * this hunk — the `./engine.js` import, the `Scope` type, the doc comment about
 * an unknown identifier, and the `switch (node.kind)` — is transcribed from the
 * shipped hero so the figure reads the same.
 *
 * The deletions are the four-case switch the commit message says was removed,
 * which is what makes the diff illustrate its own subject.
 */
export const EVALUATOR_DIFF: FileDiff = {
  path: "src/evaluator.ts",
  oldPath: null,
  binary: false,
  additions: 2,
  deletions: 7,
  hunks: [
    {
      header: "@@ -1,26 +1,21 @@",
      oldStart: 1,
      oldLines: 26,
      newStart: 1,
      newLines: 21,
      lines: [
        ctx('import type { Node } from "./parser.js";', 1, 1),
        add('import { apply } from "./engine.js";', 2),
        ctx("", 2, 3),
        ctx("export type Scope = Readonly<Record<string, number>>;", 3, 4),
        ctx("", 4, 5),
        ctx("/**", 5, 6),
        ctx(" * Walks the tree.", 6, 7),
        ctx(" *", 7, 8),
        ctx(
          " * An unknown identifier throws rather than yielding NaN: a typo in a",
          8,
          9,
        ),
        ctx(
          " * name is the most common mistake in an expression language, and NaN",
          9,
          10,
        ),
        ctx(" * all the way to the top before anyone notices.", 10, 11),
        ctx(" */", 11, 12),
        ctx(
          "export function evaluate(node: Node, scope: Scope = {}): number {",
          12,
          13,
        ),
        ctx("  switch (node.kind) {", 13, 14),
        ctx('    case "num":', 14, 15),
        ctx("      return node.value;", 15, 16),
        ctx('    case "ident": {', 16, 17),
        ctx("      const v = scope[node.name];", 17, 18),
        ctx("      if (v === undefined) throw new Error(`unknown: ${node.name}`);", 18, 19),
        ctx("      return v;", 19, 20),
        ctx("    }", 20, 21),
        del('    case "add":', 21),
        del("      return evaluate(node.left, scope) + evaluate(node.right, scope);", 22),
        del('    case "sub":', 23),
        del("      return evaluate(node.left, scope) - evaluate(node.right, scope);", 24),
        del('    case "mul":', 25),
        del("      return evaluate(node.left, scope) * evaluate(node.right, scope);", 26),
        del("  }", 27),
        add(
          "    default:",
          22,
        ),
      ],
    },
  ],
};

/**
 * Handlers for everything the showcase repository answers.
 *
 * A function rather than a constant so each scene gets its own copy and cannot
 * mutate another's.
 *
 * The empty/inert answers below are deliberate, not lazy: a marketing figure
 * should show a repository in an ORDINARY state. A stash count, a rebase in
 * progress or a shallow-clone warning would each put a banner or a badge in the
 * figure that has nothing to do with what the figure is showing.
 */
export function showcaseHandlers(): Record<string, (args: Record<string, unknown>) => unknown> {
  return {
    open_repo: () => HANDLE,
    close_repo: () => undefined,
    trust_repo_path: () => undefined,
    head_info: () => HEAD,
    get_status: () => STATUS,
    get_log_page: () => LOG_PAGE,
    watch_repo: () => undefined,
    register_window_repos: () => undefined,

    list_branches: () => BRANCHES,
    list_remotes: () => REMOTES,
    list_tags: () => [],
    list_stashes: () => [],
    list_submodules: () => [],
    list_worktrees: () => [],

    // The selected commit's detail pane.
    diff_commit: () => [EVALUATOR_DIFF],
    // Unsigned, and no notes: both would add a badge to the figure that says
    // nothing about what the figure is for.
    verify_commit: () => ({ state: "None", signer: null, key: null }),
    commit_notes: () => [],

    repo_state: () => "Clean",
    shallow_info: () => ({ shallow: false, boundaryCount: 0, singleBranch: false }),
    rebase_status: () => ({
      inProgress: false,
      nextIndex: 0,
      total: 0,
      pauseReason: null,
      lastCompleted: null,
    }),
    bisect_status: () => ({
      inProgress: false,
      startRef: null,
      badTerm: "bad",
      goodTerm: "good",
      currentOid: null,
      remaining: null,
      steps: null,
      firstBadOid: null,
      goodCount: 0,
      badCount: 0,
      skippedCount: 0,
    }),
  };
}
