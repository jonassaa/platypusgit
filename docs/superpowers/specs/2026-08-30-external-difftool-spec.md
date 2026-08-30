# Open any diff in an external diff tool (#235)

## The problem

We can hand a *conflict* to the user's configured merge tool
(`run_mergetool`, `commands/conflict.rs`), but every other diff in the app is a
closed room. There is no way to open a working-tree change, a commit's diff or a
branch-compare file in Beyond Compare, Kaleidoscope, Meld or `nvimdiff`.

Two independent trackers carry the same ask (Sublime Merge #58, GitHub Desktop
#9609), and the people asking have already bought a diff tool and have opinions
about it. Our own diff is good and most users will stay in it — this is about not
being a dead end for the ones who will not, and about the diffs our renderer
genuinely cannot show (binaries).

Not #224 (rendering binaries *in* our diff) and not #225 (generic custom
actions).

## The shape of the answer

**Shell out to `git difftool`. Do not materialise temp files ourselves.**

For a commit or an index diff, an external tool needs two real files on disk.
`git difftool` already extracts both sides, honours `diff.tool`,
`diff.guitool`, `merge.tool`, `difftool.<tool>.cmd`, `difftool.<tool>.path` and
`difftool.prompt`, and cleans up after itself. Re-implementing any of that would
be a second, worse copy of a thing git ships.

So the whole feature is: build the right argv, spawn it, and put the entry point
where the user is already right-clicking.

### What we resolve, and what git resolves

| Decision | Who makes it |
| --- | --- |
| Which tool to run | **git** — `diff.guitool` → `diff.tool` → `merge.*` → autodetect. Zero-config for anyone already set up. |
| An explicit override | **us** — the optional Settings field becomes `--tool=<name>`, which git treats as the top of that list. |
| Prompting | **us** — always `--no-prompt`. A GUI app has no terminal for git's `Launch 'vimdiff' [Y/n]?`. |
| GUI preference | **us** — `--gui` when no override is set, so a user who split `diff.guitool` (Kaleidoscope) from `diff.tool` (vimdiff) gets the graphical one from a graphical app. It falls back to `diff.tool` when no guitool is set, so it costs nothing for everyone else. Never *both* `--gui` and `--tool`: git refuses the pair (`fatal: options '--gui' and '--tool' cannot be used together`) because they answer the same question — found by the end-to-end test, pinned by a unit test. |
| Which two sides | **us** — a `DiffToolTarget`, resolved to revs before it reaches git. |

**No `NoDiffTool` error variant.** When nothing resolves, git's own stderr
already says `This message is displayed because 'diff.tool' is not configured` —
which is a better sentence than anything we would write, in the user's own
locale, and it cannot drift out of step with git's resolution order. We surface
that stderr through `AppError::Git` rather than pattern-matching English to mint
a variant. (This is why the command pipes stderr while inheriting stdin/stdout:
without it the banner would read `git difftool exited with exit status: 1`.)

### `DiffToolTarget`

The two sides, named rather than inferred:

| Kind | argv | Surface |
| --- | --- | --- |
| `worktree` | `difftool … -- <paths>` | an unstaged row |
| `staged` | `difftool … --cached -- <paths>` | a staged row |
| `commit { oid }` | `difftool … <parent> <oid> -- <paths>` | a commit's diff, a stash's own diff |
| `range { from, to }` | `difftool … <from> <to> -- <paths>` | branch compare, commit↔commit |
| `revToWorktree { rev }` | `difftool … <rev> -- <paths>` | compare-against-workdir, stash-vs-worktree |

**`commit` resolves the parent in Rust, and that is load-bearing.** The two
obvious shorthands are both wrong on a root commit:

- `<oid>^` — `git rev-parse` fails, so the whole invocation fails.
- `<oid>^!` — git's documented "changes on this commit" form silently degrades
  to `git diff <oid>`, which diffs the commit against the **working tree**.
  Verified against git 2.50: on a root commit `git diff <root>^!` printed the
  worktree delta, not the commit. A wrong diff is worse than an error.

So `spec_for` asks git2 for the first parent and falls back to the repository's
empty tree (`treebuilder(None).write()`, which is hash-algorithm-correct where a
hard-coded `4b825dc…` is not) — the same pair `git show` uses for a root commit.

### Revisions are resolved, not trusted

Every rev in a `DiffToolTarget` goes through `revparse_single` + `peel_to_commit`
and reaches argv as a **hex oid**. `git difftool` requires its revisions ahead of
`--`, so the separator that protects the pathspecs cannot protect these: a
`--output=…` arriving over IPC in a revision slot would sit in an option
position. Resolving rather than validating makes the shape unrepresentable, which
is the same standard the app already holds elsewhere (`git/tag.rs`,
`forge/mod.rs`, `ssh.rs` all refuse a leading `-`) and a stronger one — a string
cannot pass by merely looking safe. It also produces the better error: a bad ref
fails as `InvalidRef` carrying git's own message rather than after the spawn.

### Paths, not a path

The command takes `paths: Vec<String>` so a rename can pass `[oldPath, newPath]`.
Scoped to the new path alone, `git difftool` would show a renamed file as a whole
file added — the same dead end this feature exists to remove. Both go through
`opener::safe_workdir_path` (rejects empty, absolute and `..`) and after `--`,
with `GIT_LITERAL_PATHSPECS=1` so a file honestly named `:(exclude)x` or `a[b].c`
selects itself.

### The console exception

`git difftool` inherits `run_mergetool`'s window handling verbatim: it is spawned
through `proc::git_async_keeping_console`, so a console difftool (`vimdiff`,
`nvimdiff`) gets the console it needs. The asymmetry `proc.rs:141` argues for
mergetool holds identically here — silencing a console tool leaves an invisible
process the user can only reach through Task Manager, while not silencing a GUI
tool costs a cosmetic window (and `CREATE_NO_WINDOW` is ignored for it anyway).
This is the second and last entry in `spawn_no_window.rs`'s
`CONSOLE_KEEPING_CALLERS`, added with its reason.

## Where it appears

Exactly the three surfaces the issue names, which are two code sites:

1. **`fileMenuItems`** — the file row in the Commit panel and the repo browser.
   Target is `staged` for a staged row, `worktree` otherwise.
2. **`CommitDiffPanel`'s file list** — one component behind the commit diff
   screen, the History inline panel, Compare and the two stash diffs, so all
   four inherit it from one new context menu. The target arrives as an explicit
   `difftoolTarget` prop rather than being derived from `syntaxSides`: History
   passes `{ rev: "<oid>^" }` for highlighting, where failing is harmless, and
   reusing it here would reintroduce the root-commit trap above.

Deliberately **not** in the multi-file menu: "open 40 files in Beyond Compare" is
40 windows, and git difftool would open them one at a time behind a prompt we
have turned off.

**Disabled on a purely untracked row.** The file is in neither side of any diff
git computes, so `git difftool` runs no tool at all and the click does nothing
whatsoever — the exact dead end the feature exists to remove, reintroduced. Stage
it and the `staged` target shows it, so the gate is `untracked && !staged`.

## Settings

One optional field, `externalDiffTool`, under Diff. Empty (the default) means
"let git decide", which is the case the feature is designed around; a value is
passed as `--tool=<name>`. Validated in Rust (`normalize_tool`): trimmed, empty →
`None`, anything with whitespace or a control character → `InvalidArgument`,
because a git tool name is a config-key segment and never a command line — the
command line lives in `difftool.<tool>.cmd`, where git wants it.

Portable in the settings export: a tool name describes a preference, not a
machine path, and a name that is not installed elsewhere fails visibly with
git's own message rather than silently.

## What the user sees while the tool is open

A `difftool` entry in `RepoActivity` for as long as `git difftool` runs. A
graphical diff tool can sit open for minutes, and the documented rule
(`docs/dev/frontend.md`) is that a long op joins the one indicator; without it
the app looks like it swallowed the click. Not cancellable — it does not go
through `run_git_authenticated`, so `cancel_network_op` cannot reach it, and a
Cancel button that does nothing is worse than none.

On exit the store runs `refreshAll()`: when the right-hand side is the working
tree, `git difftool` hands the tool the **real file**, so edits made in it land
in the worktree.

## Verification

- Pure argv tests for every `DiffToolTarget` × tool-override × multi-path
  combination.
- Real-repo tests for the plan: parent resolution, root-commit empty tree,
  pathspec refusal.
- **Two end-to-end tests that run real `git difftool`** against a temp repo with
  `diff.tool` pointed at a fake tool that writes `$LOCAL`/`$REMOTE` to a marker
  file. One proves the config is honoured (which is the whole "respect
  `diff.tool`/`difftool.*`" requirement, proven rather than asserted); the other
  proves `--tool=` overrides it. They skip with a message where `git difftool` is
  unavailable, the same way the gpg and git-lfs tests do.
- Component tests for both menu surfaces and the Settings field.

## Deliberately out of scope

- Naming the resolved tool in the menu label ("Open in Kaleidoscope"). It needs a
  second command and a per-repo store field to answer a question the user already
  knows the answer to.
- A directory diff (`git difftool -d`) for a whole commit. Real, but a different
  interaction: it has no file row to hang off and its own "the tool owns the
  window now" story.
- `difftool.writeToTemp`, `--trust-exit-code`. Left at git's defaults, which is
  what makes closing the tool with a non-zero status not raise a banner.
