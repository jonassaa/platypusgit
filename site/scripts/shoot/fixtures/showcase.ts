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
  CommitTemplate,
  DiffLine,
  FileDiff,
  FileContent,
  FileStatus,
  GitIdentity,
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

/**
 * The working tree: one staged file and three unstaged, which is the `4 changed`
 * both figures' status bars report and the STAGED 1 / CHANGES 3 split the
 * approved commit figure shows.
 *
 * Note this is deliberately a different file set from the history figure's diff
 * pane, and that is not an inconsistency: the commit screen shows the WORKING
 * TREE, while the history detail shows what one past commit changed.
 */
export const STATUS: FileStatus[] = [
  {
    // Staged: index differs from HEAD, worktree matches the index.
    path: "src/parser.ts",
    embedded: false,
    worktree: { kind: "Unmodified" },
    index: { kind: "Modified" },
    additions: 6,
    deletions: 0,
    stagedAdditions: 6,
    stagedDeletions: 0,
  },
  {
    path: "NOTES.md",
    embedded: false,
    worktree: { kind: "Untracked" },
    index: { kind: "Unmodified" },
    additions: 6,
    deletions: 0,
  },
  {
    path: "src/engine.ts",
    embedded: false,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 5,
    deletions: 5,
  },
  {
    path: "tests/lexer.test.ts",
    embedded: false,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 7,
    deletions: 6,
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
 * `src/engine.ts` as the WORKING TREE has it — the diff the commit figure shows
 * in its centre pane, at +5 −5 to match its row in STATUS.
 *
 * The change illustrates itself: the operator table gains explicit descriptions,
 * which is a believable thing to be part-way through when a screenshot is taken.
 */
export const ENGINE_WORKTREE_DIFF: FileDiff = {
  path: "src/engine.ts",
  oldPath: null,
  binary: false,
  additions: 5,
  deletions: 5,
  hunks: [
    {
      header: "@@ -2,6 +2,8 @@",
      oldStart: 2,
      oldLines: 6,
      newStart: 2,
      newLines: 8,
      lines: [
        ctx(" * The operator engine: one descriptor per operator, and a dispatcher", 2, 2),
        ctx(" * that reads them.", 3, 3),
        ctx(" *", 4, 4),
        add(" * UNCOMMITTED: descriptions being made explicit about overflow and", 5),
        add(" * domain errors.", 6),
        ctx(" * The table is the source of truth. Adding an operator means adding a", 5, 7),
        ctx(" * row here and a branch in `apply`; the parser reads `PRECEDENCE` off", 6, 8),
        ctx(" * this table rather than hard-coding its own copy.", 7, 9),
      ],
    },
    {
      header: "@@ -23,7 +25,7 @@ export const OPERATORS: readonly OpDescriptor[] = [",
      oldStart: 23,
      oldLines: 7,
      newStart: 25,
      newLines: 7,
      lines: [
        ctx('    name: "add",', 23, 25),
        ctx("    arity: 2,", 24, 26),
        ctx("    precedence: 1,", 25, 27),
        del('    description: "sum of both operands",', 26),
        add(
          '    description: "sum of both operands; overflows to Infinity",',
          28,
        ),
        ctx("  },", 27, 29),
        ctx("  {", 28, 30),
        ctx('    name: "sub",', 29, 31),
      ],
    },
    {
      header: "@@ -35,7 +37,7 @@ export const OPERATORS: readonly OpDescriptor[] = [",
      oldStart: 35,
      oldLines: 7,
      newStart: 37,
      newLines: 7,
      lines: [
        ctx('    name: "mul",', 35, 37),
        ctx("    arity: 2,", 36, 38),
        ctx("    precedence: 3,", 37, 39),
        del('    description: "product of both operands",', 38),
        add('    description: "product of both operands; the usual rounding",', 40),
        ctx("  },", 39, 41),
        ctx("  {", 40, 42),
        ctx('    name: "div",', 41, 43),
      ],
    },
    {
      header: "@@ -47,9 +49,7 @@ export const OPERATORS: readonly OpDescriptor[] = [",
      oldStart: 47,
      oldLines: 9,
      newStart: 49,
      newLines: 7,
      lines: [
        ctx("    arity: 2,", 47, 49),
        ctx("    precedence: 2,", 48, 50),
        del("    // TODO: say what happens on a zero divisor. The engine raises,", 49),
        del("    // but nobody reading this table would guess that.", 50),
        del('    description: "quotient",', 51),
        add('    description: "quotient; raises on a zero divisor",', 51),
        ctx("  },", 52, 52),
        ctx("];", 53, 53),
      ],
    },
  ],
};

/**
 * `src/engine.ts`, whole, on each side of the worktree change.
 *
 * Needed because the shipped default for `diffContextMode` is `wholeFile`: the
 * split view asks for both copies of the file and lays the hunks over them, so
 * a scene that answered only the hunks would render a diff with nothing around
 * it. Built from the diff above so the two cannot disagree.
 */
function fileAt(side: "old" | "new"): string {
  const out: string[] = [];
  for (const h of ENGINE_WORKTREE_DIFF.hunks) {
    for (const l of h.lines) {
      const k = l.kind.kind;
      if (k === "Context") out.push(l.content);
      else if (k === "Addition" && side === "new") out.push(l.content);
      else if (k === "Deletion" && side === "old") out.push(l.content);
    }
  }
  return out.join("\n");
}

const ENGINE_NEW: FileContent = {
  path: "src/engine.ts",
  binary: false,
  text: fileAt("new"),
  fromHead: false,
  size: fileAt("new").length,
};

const ENGINE_OLD: FileContent = {
  path: "src/engine.ts",
  binary: false,
  text: fileAt("old"),
  fromHead: true,
  size: fileAt("old").length,
};

/**
 * The committer identity the commit panel names. A configured global identity
 * on purpose: `NoSignature` is a FORM, and a figure showing the app asking for
 * a name and email would advertise a setup step rather than the product.
 */
export const IDENTITY: GitIdentity = {
  name: { value: "Jonas Aasberg", scope: "global" },
  email: { value: "jonas@example.com", scope: "global" },
  globalConfigPath: "/Users/jonas/.gitconfig",
  localConfigPath: "/Users/jonas/pgit-showcase/.git/config",
};

/** No `commit.template` — the composer stays `git commit -m`, and the message
 *  box in the figure shows its placeholder rather than someone's boilerplate. */
export const COMMIT_TEMPLATE: CommitTemplate = {
  path: null,
  body: null,
  unreadable: false,
  commentPrefix: "#",
  cleanup: "default",
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
    // The commit screen: the selected row's worktree diff, both copies of the
    // file for whole-file context, the identity and the (absent) template.
    // Path-aware, not a constant: answering every path with one file's diff is
    // how a figure ends up captioned `NOTES.md` over the engine's operator
    // table. An unknown path gets an empty diff rather than a lie.
    get_diff: (args) =>
      args.path === ENGINE_WORKTREE_DIFF.path
        ? ENGINE_WORKTREE_DIFF
        : { ...ENGINE_WORKTREE_DIFF, path: String(args.path ?? ""), hunks: [], additions: 0, deletions: 0 },
    read_file_content: () => ENGINE_NEW,
    read_file_content_at_index: () => ENGINE_OLD,
    get_identity: () => IDENTITY,
    get_commit_template: () => COMMIT_TEMPLATE,
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
