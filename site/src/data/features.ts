// 9 hero feature areas (from README "Features")
export const heroFeatures = [
  { icon: 'git-commit', title: 'Staging & commit', blurb: 'Stage/unstage/discard files and individual hunks. Commit with amend + author override.' },
  { icon: 'diff', title: 'Diff & viewing', blurb: 'Continuous whole-file diffs with a scrubable minimap, commit-to-commit diffs, branch compare, blame, repo browser.' },
  { icon: 'git-branch', title: 'Branches & tags', blurb: 'List/create/checkout/rename/delete branches. Lightweight, annotated and signed tags.' },
  { icon: 'history', title: 'History', blurb: 'Commit graph, file history, reflog viewer, detached-HEAD checkout.' },
  { icon: 'rewind', title: 'History manipulation', blurb: 'Reset (soft/mixed/hard), cherry-pick, revert.' },
  { icon: 'archive', title: 'Stash', blurb: 'Save/apply/pop/drop, partial stash by path, rename, stash-to-branch.' },
  { icon: 'merge', title: 'Conflict resolution', blurb: '3-way sides, accept ours/theirs, external mergetool, continue/abort.' },
  { icon: 'list', title: 'Interactive rebase', blurb: 'Pick/reword/edit/squash/fixup/drop, continue/abort, base picker.' },
  { icon: 'cloud', title: 'Remotes & network', blurb: 'Add/remove/rename/prune remotes, fetch/pull/push (with-lease/force), merge.' },
  { icon: 'link', title: 'Pull requests', blurb: 'GitHub + GitLab: list, check CI, open, check out, and create — without leaving the app.' },
  { icon: 'folder', title: 'Multi-repo tabs', blurb: 'Several repositories open at once in one window, each with its own screen and badges.' },
  { icon: 'search', title: 'Submodules, LFS & bisect', blurb: 'Submodule + linked-worktree screens, git-LFS objects, and bisect in the operation bar.' },
];

// Full grouped list (from implemented-features.md)
export const featureGroups = [
  { title: 'Staging', blurb: 'Granular control over what goes into a commit.', items: [
    'Stage / unstage / discard whole files',
    'Stage / unstage / discard individual hunks',
    'Stage / unstage / discard individual lines',
    'Stage the focused diff line from the keyboard with Space',
    'Drag files between Changes and Staged',
    'Commit with amend and author override',
  ]},
  { title: 'Diff & viewing', blurb: 'See exactly what changed, anywhere.', items: [
    'Worktree / index / HEAD diffs',
    'Whole-file diffs by default — a continuous file with no `@@` banners, changed lines coloured, and Stage / Discard in the gutter beside each change block',
    'Scrubable minimap beside the diff — the shape and spread of a change at a glance, click or drag to jump',
    'Unified and side-by-side (split) diff views, with a persisted default',
    'Long lines scroll the pane rather than wrapping over the row below, or wrap on demand with the Diff screen\'s Wrap toggle',
    'Syntax highlighting on every diff, blame and preview surface — tokenized off the main thread',
    'Word-level highlighting within a changed line',
    'Configurable diff context lines, with a fold separator that names what it hides and expands it in place',
    'Commit-to-commit diffs — one commit, or the combined diff across a selected range',
    'Branch compare — any two refs, or a ref against the working tree, with ahead/behind, both commit lists and the combined diff',
    'Line-by-line blame',
    'Repo file browser at HEAD, or any revision',
    'git-LFS pointers are shown as the objects they are, not as two lines of text',
  ]},
  { title: 'Branches & tags', blurb: 'Full ref management.', items: [
    'List / create / checkout / rename / delete branches',
    'Default branch pinned to the top of every branch list, the rest ordered by most recent commit',
    'Merge or rebase onto any branch — local or remote — straight from the branch picker, the titlebar chip or the Branches screen',
    'Lightweight and annotated tags',
    'GPG/SSH signed tags — defaults from `tag.gpgsign`, overridable per tag, with a verification badge on the tag you select',
    'Push and delete tags',
  ]},
  { title: 'History', blurb: 'Navigate the past.', items: [
    'Commit graph layout',
    'Ref-scoped log — browse the log of any branch, tag, or revspec',
    'Commit / log search (message, author, SHA, date, path)',
    'Per-file history',
    'Reflog viewer',
    'Detached-HEAD checkout',
    'Customizable HEAD indicator — six independent marks at three weights',
  ]},
  { title: 'History manipulation', blurb: 'Rewrite with care.', items: [
    'Reset — soft / mixed / hard',
    'Cherry-pick',
    'Revert',
    'Bisect — good / bad / skip from the operation bar, with git\'s own progress estimate',
    'Drag a ref or commit onto another to merge, rebase or cherry-pick',
  ]},
  { title: 'Stash', blurb: 'Park work in progress.', items: [
    'Save / apply / pop / drop',
    'Partial stash — stash only the paths you selected, one file or a multi-selection',
    'Rename a stash entry',
    'Compare a stash — what it changed, or against the working tree',
    'Stash to new branch',
  ]},
  { title: 'Conflict resolution', blurb: 'Resolve merges without leaving the app.', items: [
    '3-way conflict sides',
    'Dedicated merge resolver window — ours · editable result · theirs',
    'Operation bar — the app announces a merge, rebase or cherry-pick in progress',
    'Accept ours / theirs',
    'External mergetool launch',
    'Continue / abort operation',
  ]},
  { title: 'Interactive rebase', blurb: 'Reshape history visually.', items: [
    'Pick / reword / edit / squash / fixup / drop',
    'Merge commits — flatten (git default) or preserve topology',
    'Continue / abort, resumable after quitting the app',
    'Reorder steps by drag, or with Mod+Shift+↑/↓',
    'Rebase base picker',
  ]},
  { title: 'Remotes & network', blurb: 'Sync with anywhere.', items: [
    'Add / remove / rename / prune remotes',
    'Fetch / fetch-all / pull',
    'Push with-lease and force',
    'Authenticated remotes — every network op prompts and retries, tag pushes and branch deletes included',
    'Merge branches',
  ]},
  { title: 'Pull requests', blurb: 'GitHub and GitLab, including self-hosted.', items: [
    'List open pull / merge requests — author, source → target, draft and fork markers',
    'CI / checks summary for the selected request',
    'Check out a request locally, forks included',
    'Create a request from the current branch, as a draft if you want',
    'Open in the browser in one click',
    'Per-host API token, stored by your own git credential helper under its own key',
  ]},
  { title: 'Submodules, LFS & worktrees', blurb: 'The parts of a repository that are also repositories.', items: [
    'Submodule screen — init, update (recursive), sync URLs, open one as its own repository',
    'Submodules are distinguished from embedded repositories in the file tree',
    'git-LFS panel — fetch objects, pull objects, checkout, with pointer-aware diffs',
    'Linked worktrees — list, add on a new or existing branch, lock / unlock, remove, prune',
    'Removing a worktree with uncommitted work asks a second time before forcing',
  ]},
  { title: 'Navigation & keyboard', blurb: 'Keyboard-first, fast everywhere.', items: [
    'Multi-repo tabs — several repositories open at once, with ⌘E, ⌥1–⌥9 and Ctrl+Tab',
    'Command palette (⌘P) — branches, files, commits, and actions',
    'Rider-style default keymap, with a Classic preset',
    'Type-to-jump speed-search in lists',
    'Commit chords, F7 / ⇧F7 hunk navigation, and stage / discard of the hunk you are on from the keyboard',
    'Spatial Alt+Arrow pane focus and a ? cheat sheet',
    'Resizable panels — drag any panel to whatever the window allows, double-click a handle to reset it',
    '`pgit` command-line launcher — open a repo from the terminal and get the prompt straight back, installed by the `.deb` and `.msi` packages or from Settings',
  ]},
];

// Roadmap teaser (from features.md P0/P1 — clearly "planned")
export const roadmap = [
  'Hunk-level stash — stash part of a file, not only whole paths',
  'Signed & notarized macOS / Windows builds',
];


/**
 * One release. `summary` is optional framing for the whole entry; everything
 * else lives in a titled section so a reader can find the half they came for
 * — a bold lead per bullet, the detail under it. Backticks in either become
 * <code> at render time (see changelog.astro), so write them like markdown.
 */
export type ChangelogItem = { title: string; detail?: string };
export type ChangelogSection = { title: string; items: ChangelogItem[] };
export type ChangelogEntry = {
  version: string;
  date: string;
  status: string;
  summary?: string;
  sections: ChangelogSection[];
};

export const changelog: ChangelogEntry[] = [
  {
    version: '0.4.0',
    date: '2026-09-02',
    status: 'feature',
    summary:
      'Checking out a branch that another worktree is standing on used to leave the repository looking like you had staged the whole diff between the two branches — a refusal that arrived after the damage. It now refuses before touching anything, and then offers the thing you actually wanted: move the branch into this folder. The holder steps off the branch onto the same commit it was already on, which never opens its working tree, so uncommitted work over there survives untouched.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Take a branch from the worktree holding it',
            detail:
              'A branch can only be checked out in one worktree at a time, and until now hitting that wall left you with two bad options: go open that worktree, or delete it. The refusal now names the worktree and its path and offers a third — move the branch here. Accepting it detaches the holder at the commit it is already standing on, which is a rewrite of one HEAD file and nothing else: no checkout, no index write, its working tree never opened. Modified and untracked files in that worktree survive, which is what makes this safe to offer rather than a destructive action wearing a button. The offer is withheld, rather than shown and then failed, when the holder is locked — an explicit "leave me alone" — or is mid-rebase, merge, cherry-pick, revert, am or bisect, because git tracks those against HEAD and moving it out from under one leaves a half-finished operation nobody can explain. Dirtiness is reported to you, never used to refuse.',
          },
          {
            title: 'The offer arrives wherever you check out from',
            detail:
              'The top menu, the log view, the branch chip and the command palette all funnel through one action, so the choice appears in all four without any of them knowing about it. If the checkout somehow fails after the holder has stepped off, the holder is put back on its branch — leaving it detached would cost it its branch for a checkout that never happened.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Checking out a branch held by another worktree no longer mangles the repository',
            detail:
              'Reported from the field, and worse than a failed operation: the checkout wrote the index and the working tree first and only then tried to move HEAD, where libgit2 correctly refused. HEAD stayed where it was while the files on disk became the other branch\'s tree — so `git status` showed the entire diff between the two branches as staged, with the current branch\'s own files deleted from disk. A refusal presented as data loss. Validation now runs before anything is written, the way git itself dies with `already used by worktree at …` before touching a file, and the one step that can still fail after the tree has been rewritten rolls back to the commit it started from.',
          },
          {
            title: 'A declined checkout no longer leaves your work in a stash you never made',
            detail:
              'Found on the way into the feature above. A checkout auto-stashes uncommitted changes before it starts and pops them after it succeeds, so every path that ended without a completed checkout used to abandon them in an unexplained stash entry. Declining the offer, choosing to open the other worktree, and a take that is refused on re-validation all now pop your work back. Only the refusal raises a banner; declining is a choice, not a failure.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'What the version number promises, written down',
            detail:
              'This release is 0.4.0 rather than 0.3.2 because of a policy that landed with it. Pre-1.0 the minor is the major: any new user-visible capability, any new distribution channel, and any change to a persisted format or on-disk state is a minor bump, while patches are fixes, performance and packaging repairs with no new capability. The test is the `status` field on the entry you are reading — if it says "feature", the release is a minor. Everything published up to 0.3.1 is grandfathered and deliberately not rewritten, which matters because the old record is the counter-example rather than the pattern: fifteen of the first twenty-four releases were patch-numbered while their own changelog called them features, and 0.3.1 shipped an entire built-in terminal as a patch. The reasoning, the release runbook and the traps behind it are in `docs/dev/releasing.md`.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The Microsoft Store listing is still not live',
            detail:
              'Unchanged from 0.2.0 through 0.3.1: the release produces a submittable package, and submitting it is a separate, manual step. Until the listing exists, install on Windows with the `.msi`, Scoop or winget. The packaged form has also still not been run on a real Windows machine.',
          },
        ],
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-09-01',
    status: 'feature',
    summary:
      'A built-in terminal: a real pty in a docked panel, one shell per repository tab, opened in that repository\'s working directory. vim, less, ssh and an interactive rebase all behave in it, because anything less is a text box that lies about being a terminal.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'A built-in terminal, opened where your repository is',
            detail:
              'The editor-standard terminal chord — Ctrl and the backtick key, or ⌘ and backtick — docks a terminal at the bottom of the window, one shell per repository tab, started in that tab\'s own working directory. It is a real pty rather than a command runner, which is the whole point: vim, less, ssh and `git rebase -i` all work, and anything less is a text box that lies about being a terminal. The shell is the one your own terminal uses — `$SHELL`, or PowerShell on Windows — and a Settings field overrides it, because a built-in terminal running a different shell from the one outside is a surprise nobody asked for.',
          },
          {
            title: 'A command typed in the pane already updates the app',
            detail:
              'This needed no code of its own, because the filesystem watcher that shipped in 0.3.0 does it: a `git commit` or `git checkout` typed into the terminal moves the graph and the file list with no manual refresh, since the watcher classifies the change against the gitdir and asks for exactly the refresh it implies. Two features that were specified separately turned out to be one.',
          },
          {
            title: 'The terminal writes nothing to the log',
            detail:
              'A terminal is where a sudo password gets typed, so the module that carries its bytes contains no logging call at all and a guard test fails the build if one is ever added — the traffic has exactly one destination. The lifecycle logging lives in the handlers instead, which never see the bytes. The configured shell is also held out of a settings export: it is a path to a binary on the machine that wrote it, not a preference that travels.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The Microsoft Store listing is still not live',
            detail:
              'Unchanged from 0.2.0 through 0.3.0: the release produces a submittable package, and submitting it is a separate, manual step. Until the listing exists, install on Windows with the `.msi`, Scoop or winget. The packaged form has also still not been run on a real Windows machine.',
          },
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-09-01',
    status: 'features',
    summary:
      'The working copy is live — save a file in your editor, tab back, and the status is already right, with no refresh and no auto-fetch timer involved. The rest of the release is about undoing a mistake and being told what an operation is about to do: ⌘Z undoes the last operation, rebasing the bottom of a stack carries the branches above it and names them before it starts, and the commit panel says which identity it is about to commit as. The command palette also runs commands you define yourself.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'The working copy is live',
            detail:
              'Save a file in your editor, tab back, and the status is already right. Until now the app was only correct if you remembered to refresh: the sole self-starting refresh was the auto-fetch timer, which is a network fetch on a minutes-scale interval and does not run at all when auto-fetch is off. One watch follows the active repository, and the value is in what it drops — every path is classified, and only a change to a ref asks for the expensive history refresh, so a file save cannot repaint the log. `.lock` files are ignored on purpose: they are git STARTING work rather than finishing it, so honouring them would double every event and fire the first one while the index is still being written. Worktree paths are filtered against the repository\'s own ignore rules.',
          },
          {
            title: 'Undo the last operation with ⌘Z',
            detail:
              'The reason people fear a git GUI is that a misclick is unrecoverable unless they already know the reflog well enough not to need the GUI. ⌘Z (Ctrl+Z) now undoes a commit — including an amend — a checkout, merge, cherry-pick, revert or reset, and ⌘⇧Z redoes it. It moves HEAD between a before and an after snapshot rather than replaying operations backwards, so undoing a commit loses nothing: git keeps the old commits reachable through the reflog. Preconditions are re-read from the backend at the moment you press it rather than trusted from cached state, so if HEAD moved underneath it, it refuses, changes nothing, names the operation and points at the reflog.',
          },
          {
            title: 'Rebasing a stack carries the branches above it',
            detail:
              '`feat/a` → `feat/b` → `feat/c`, each a small reviewable PR on top of the last. Rebasing the bottom silently orphaned everything above it: the branches kept pointing at the old, abandoned commits, and recovering by hand is a chain of manual rebases — exactly where people give up on the GUI. They now follow, and the more valuable half is that you are told first. The confirmation names every branch it will move — "this will also move feat/b and feat/c" — rather than counting them, and says they will need a force-push. It stays silent when nothing points into the range, because a confirmation on every rebase is trained away in a week. A branch whose commit was DROPPED is left alone: there is no honest place to move it, since retargeting to a neighbour would silently change what the branch contains.',
          },
          {
            title: 'Your own commands in the command palette',
            detail:
              'The one git-adjacent command a team runs fifty times a day, without it having to be something shipped here. Give an action a label and a command line using `$FILE`, `$FILES`, `$SHA`, `$BRANCH`, `$REPO`, `$LOCAL` or `$REMOTE`, and run it from the palette. A user-supplied command string is deliberately NOT a shell line: under `sh -c` a branch named `main; rm -rf ~` or a path containing `$(...)` stops being data and becomes code — and branch names and paths come from the repository, which means from anyone who has ever pushed to it. The string is split into arguments once, quotes group, and `| > ; && $ *` are ordinary characters because nothing interprets them. Placeholders expand into individual arguments, so a value can never introduce a new one. No secret reaches an action: no forge token, no git credential, no askpass. Output is truncated with a marker rather than silently.',
          },
          {
            title: 'A repository can commit under an identity of its own',
            detail:
              'The commit panel\'s attribution line said "(signature will come from git config)" — true, and useless to the person with a work address and a personal one who needs to know which this repository is about to use. It now names the identity and which config file it came from, and when the two halves come from different files — `user.name` from /etc/gitconfig and `user.email` from ~/.gitconfig is ordinary on a managed machine — it names neither, because naming one would be a confident wrong answer about the other. Saving takes an explicit scope, and a save scoped to one repository is refused rather than quietly downgraded to global. On top of that sits a small list of saved identities with a one-click "Use here". It is a palette rather than an assignment: git already records which identity a repository uses, in that repository\'s own config where the CLI and every hook read it, so a second store of the same fact would drift the moment anyone ran `git config` in a terminal. "Which one is active here" is answered by reading the config back and matching on the name and email pair rather than the label, so a repository configured by hand still lights up the entry it corresponds to. Editing or removing an entry therefore does not change a repository already using it — deleting a bookmark does not move the page. The list never travels in a settings export, since every other preference says how the app should behave while this one is a list of someone\'s email addresses.',
          },
          {
            title: 'Commit bodies render as restrained markdown',
            detail:
              'Long bodies with lists, links and code fences read badly as plain text, and every squashed PR body is one. The subset is parsed into a typed syntax tree and rendered as elements, so there is no HTML string anywhere in the path and the `dangerouslySetInnerHTML` class of bug is gone by construction — rather than pulling in a general-purpose markdown library, which renders arbitrary documents and needs a sanitiser that stays correctly configured forever. Deliberately outside the subset: headings, because a leading `#` in a commit body is far more likely to be an issue reference; images, so there is no image node a renderer could grow one from; raw HTML; and tables. Links are allow-listed to http, https and mailto and open in your browser rather than navigating, which in a webview would replace the app. `#123` renders as a styled token and NOT a link — linking it means guessing which forge and repository the number belongs to, and a link to the wrong issue is worse than none. The raw view is the original text rather than a re-serialisation of the parse.',
          },
          {
            title: 'A release channel, so prereleases are opt-in',
            detail:
              'Beside the existing automatic / only-when-I-ask / never choice, a channel: Stable offers published releases only, Include prereleases also offers release candidates. Stable stays on GitHub\'s own answer to what is current, which excludes prereleases server-side; the prerelease channel reads the full list and takes the semver-highest entry rather than the newest-created, so a patch cut on an older line cannot beat a newer candidate. It adds prereleases to what you are offered rather than restricting you to them, so a stable release still wins whenever it is the newest thing published, and switching back to Stable does not offer a downgrade — the app cannot un-install a version.',
          },
          {
            title: 'Pin branches to the top of the list',
            detail:
              'A fifty-branch repository ordered by recency gives no way to say "keep `feat/foo` on top". Branches now pin from the context menu, per repository, and a pinned branch is the first row wherever branches are listed. A pin outranks the default-branch pin, because that one is the app guessing what belongs on top while a user pin is an instruction — and an instruction that loses to a guess is not a pin. Pinned rows are lifted out of the folder tree and shown at the top under their full names, since a pinned `feat/foo` sitting inside a collapsed `feat` folder would be invisible in exactly the case pinning exists for. With nothing pinned the order is unchanged.',
          },
          {
            title: 'Drag repository tabs to reorder them',
            detail:
              'Tab order was the order things were opened, and nothing moved them afterwards. Tabs now drag to a new position, with Mod+Shift+Left / Right and Move left / right in the tab menu as the keyboard and mouse equivalents. The arrangement survives a restart without any new storage, because the session already writes the tab array in order and rebuilds it in the order it reads back. ⌥1–⌥9 index that same array, so they follow the strip you arranged. The chords decline at either end rather than wrapping — a drag cannot wrap either, and declining lets the chord fall through instead of silently doing nothing.',
          },
          {
            title: '`pgit --debug` launches attached and streams the log',
            detail:
              '`pgit .` detaches and sends the child\'s output nowhere, so the one launch shape that actually has a terminal was exactly the one that threw the log away — and the level filter was pinned high enough to drop every successful call from the webview besides. `pgit --debug` keeps the process in the foreground and raises the filter, so the whole sequence reaches the terminal you launched from. `--help` and `--version` still win, and the credential-helper short-circuit stays ahead of all of it, so a git prompt that literally reads `--debug` is still answered as a credential rather than treated as a flag. The notice it prints names the already-running case out loud, because a second launch is forwarded to the running app and exits before this code could detect it — which would otherwise be a silent, log-free success.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'A background refresh no longer wipes the error banner',
            detail:
              'A failing `--ff-only` pull on a diverged branch could show no error at all. The pull did fail and did set the banner — but the fetch half of that same pull had already moved a remote ref, so the new filesystem watcher\'s debounced event landed a few hundred milliseconds later, after the operation had finished and the busy guard had stopped suppressing it, and the refresh it triggered opened by clearing the error. What the user saw was a pull that silently did nothing, which is the worst possible reading of a failure. A refresh nobody asked for now preserves the banner. A refresh you asked for still clears it, because "show me where things stand now" is not compatible with a stale error from a previous action.',
          },
          {
            title: 'A fresh machine could not commit, and the error said "NoSignature"',
            detail:
              'git refuses to record a commit until `user.name` and `user.email` are set, and on a machine with neither the app showed the error type\'s own spelling — `NoSignature` — and offered nothing to click. It had no prose written for it, so the same bare word reached the user from merge, cherry-pick, revert, rebase, tag and stash besides, all of which resolve a committer signature; `Unborn` had the same problem. Separately, a blank `user.email` was not classified as a missing signature at all and surfaced as the raw string "failed to parse signature", because libgit2 reports a missing name as not-found but a blank one as a generic error. Both paths now ask the config through the same identity validation the writer uses, so what the app saves and what it calls missing cannot drift apart.',
          },
          {
            title: 'The worktree list stopped stepping down the page',
            detail:
              'Lock and Unlock differ by about 30px and the buttons were sized to their labels, so Open and Remove sat at a different x on exactly the locked rows and the action column visibly stepped down the list. A 79-character lock reason wrapped to a second line inside a fixed-height badge, giving every locked row its own height, and a centred maximum width capped off exactly the width the absolute paths needed. Now it is one fact per line — name, branch and sha, path, lock — each clipped with an ellipsis and carrying the full text on hover, the badge reduced to the single word `locked` with the reason beside it, and the three actions in three identical fixed tracks so the column cannot move. The screen itself goes full width.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'Twenty dev-only advisories closed, and a test that keeps them closed',
            detail:
              'Twenty of the twenty-two open npm advisories are cleared with dependency overrides. Dependabot could not open a PR for a single one — its security updater only bumps manifest entries and never writes an overrides block — so they sat open indefinitely with security updates enabled and unpaused, where a missing PR read as "handled" when it meant "unfixable automatically". Nothing vulnerable ever shipped: no affected package appears in the production dependencies, so the exposure was a developer machine or a CI runner, never a user install. The block also has a routine way to die, because a dependency PR that regenerates the lockfile drops it with nothing in the diff that looks like a security change — so a test now asserts every override key is still present, and the two advisories that stay open on purpose are written down rather than forgotten.',
          },
          {
            title: 'TypeScript 7, git2 0.21, React 19.2',
            detail:
              'The dependency floor moved across both trees in one sweep: TypeScript 5.8 to 7.0, git2 0.20 to 0.21, React 19.1 to 19.2, Vite to 7.3 and the site\'s Astro to 7.2, plus grouped minor and patch updates across the rest of the crates, packages and CI actions. Dependabot is now configured for every ecosystem in the repository rather than some of them.',
          },
          {
            title: 'CI workflows ask for the permissions they need',
            detail:
              'Neither test workflow declared a permissions block, at the root or on any job, so all ten jobs inherited the repository default and left ten open code-scanning alerts. Nothing was exposed, since that default is already read-only — but it is a repository *setting*: invisible in the tree, reversible in one click, and not carried along when a workflow is copied elsewhere, and ten permanently-open alerts bury the next real one. Both workflows now take `contents: read`, and the three gate jobs that only read another job\'s result take nothing at all.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'Undo covers HEAD, not everything',
            detail:
              'Deliberately not recorded, and the absence is the safe failure: a push, since the remote already has it; a dropped stash; branch create, delete and rename, which move a ref that is not HEAD; and a rebase, which has its own engine and its own retained summary — folding it in without thinking through an interrupted plan would be an undo that lies. ⌘Z undoes the last thing that IS undoable rather than refusing outright.',
          },
          {
            title: 'The Microsoft Store listing is still not live',
            detail:
              'Unchanged from 0.2.0 and 0.2.1: the release produces a submittable package, and submitting it is a separate, manual step. Until the listing exists, install on Windows with the `.msi`, Scoop or winget. The packaged form has also still not been run on a real Windows machine — the gate added in 0.2.1 proves the package can be BUILT, not that it works once installed.',
          },
        ],
      },
    ],
  },
  {
    version: '0.2.1',
    date: '2026-08-31',
    status: 'packaging fix',
    summary:
      'The Microsoft Store package now builds. 0.2.0 shipped every other channel correctly, but its Store bundle was never produced — three separate Windows-only faults in the packaging step. Nothing in the app itself changed between 0.2.0 and 0.2.1; if you are already on 0.2.0 there is nothing here for you.',
    sections: [
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'Three faults between a built app and a Store package',
            detail:
              'Each one hid behind the last, and all three were specific to building on Windows. `makeappx`, the tool that assembles the package, ships with the Windows SDK but is not on the command path, so it could not be found. With that fixed it ran and rejected its own arguments: the release builds under Git Bash, which rewrites anything shaped like a Unix path, so the flag `/d` arrived as `D:/`. With that fixed it got as far as reading the manifest and refused it, because naming the large square tile obliges you to name a wide one too — and 0.2.0 named only the square. The large tile is now omitted entirely rather than half-specified; Windows falls back to the medium one.',
          },
          {
            title: 'The Store package is now checked on every change to it',
            detail:
              'Two of those three faults reached a published release, because nothing before the release job could see them — they need a Windows machine, and no test here had one. A gate now builds a real package on Windows whenever the packaging inputs change, and checks what came out: the executable, the `pgit` entry point, the app identity, the version. It found the third fault in about a minute. It deliberately does not build the whole app, since the faults were in the packaging rather than the binary, which is what keeps it cheap enough to run every time.',
          },
          {
            title: 'The apt check stopped failing on a working repository',
            detail:
              'The release gate that installs from apt.platypusgit.com in a clean container failed twice during 0.2.0 against a repository that was serving the right thing minutes later. It waited for the index to answer but not for it to be current, and the hosting behind it does not publish atomically — so it installed the previous version and reported that as a broken repository. It now waits for the version it expects. No apt user was ever affected; the releases just looked broken.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The Store listing is still not live',
            detail:
              'This release produces a submittable package; submitting it is a separate, manual step. Until the listing exists, install on Windows with the `.msi`, Scoop or winget as before.',
          },
          {
            title: 'The packaged app has still not been run on Windows',
            detail:
              'Six behaviours specific to the packaged form remain unobserved on a real machine — most importantly whether git can invoke the app as its credential helper from inside a package directory, which if it fails would break authenticated operations quietly rather than loudly. The new gate proves the package can be BUILT, not that it works once installed. Carried forward from 0.2.0 unchanged.',
          },
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-31',
    status: 'features & a fourth Windows channel',
    summary:
      'platypusgit is packaged for the Microsoft Store, so Windows users can install it without a SmartScreen warning and let the Store keep it updated. Alongside it: find in diff, image previews, commit-message help that honours your repository conventions, branch folders, fast-forward without checking out, and an SSH key you can generate from the failure that needed it.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'On the Microsoft Store, as an MSIX package',
            detail:
              'A fourth Windows channel beside the `.msi`, the Scoop bucket and winget — the same binary, packaged so the Store signs it and delivers its updates. That removes the SmartScreen warning a new user meets on first download, which until now could only be bought away with a code-signing certificate. A Store install stands its own updater down and says so: the update panel names the Store rather than offering an install that could not work, because the package is read-only and Windows refuses to launch one whose files were changed. `pgit` still works, through a Windows app execution alias instead of a PATH entry.',
          },
          {
            title: 'Find in diff (Mod+F)',
            detail:
              'A find bar on every diff surface, searching the whole file rather than what happens to be on screen. Diffs are windowed, so the browser\'s own find would only ever have searched a few dozen rows. Matches are highlighted in place and jumping to one scrolls to it precisely. This REPLACES the old "Find in diff" button, which filtered lines away rather than finding them — it could never say where in the file a match was, which is the actual question.',
          },
          {
            title: 'Changed images are previewed, not declared binary',
            detail:
              'Old beside new, each with pixel dimensions and byte size, and the delta of both — on all five surfaces that previously printed the same dead-end sentence. Format is detected from the file\'s own bytes rather than its extension. SVG is recognised and refused by name, out loud: it is the one format on the list that can carry script, and rendering it would put that inside the app. Images above 4 MiB are skipped without ever being read.',
          },
          {
            title: 'Commit messages that follow your repository\'s conventions',
            detail:
              '`commit.template` seeds the box, a ticket prefix is derived from the branch name, a conventional-commit type and scope picker writes the prefix for you, and 72-character subject guidance shows while you type. `commit.cleanup` is honoured in full, including scissors, and `core.commentChar` including `auto`. Comment stripping follows git\'s actual rule rather than a simplification: a hand-typed `#123 fix` commits as written, exactly as `git commit -m` would, while a template-seeded box strips its comments.',
          },
          {
            title: 'Fast-forward a branch without checking it out',
            detail:
              'An action on any local branch row, a "Fast-forward all" button, and a palette entry. `main` falling behind while you work on a feature branch used to cost a stash, two working-copy rewrites and a checkout back. Refusals are states rather than errors: a diverged branch says so and does not move, already-current reports no change instead of failing, and a branch checked out in another worktree is refused — moving that ref would make every file look deleted in the other checkout.',
          },
          {
            title: 'The branch list groups into folders',
            detail:
              'Branches group into a collapsible tree on `/`, arbitrarily deep, with single-child chains compressed — a lone `feat/foo/bar` stays one row rather than three nested ones, because a prefix that groups nothing is part of the name. Folds are remembered per repository. Remote branches group under their remote for free.',
          },
          {
            title: 'Open any diff in your own diff tool',
            detail:
              'On file rows in the commit panel, the repo browser, and every read-only diff surface. It shells out to `git difftool`, so `diff.guitool`, `diff.tool` and `difftool.<tool>.cmd` are honoured with no configuration here; a Settings field overrides the tool for anyone who has none configured. Console tools like vimdiff keep the terminal they render in. Until now a merge conflict could be handed to your tool and nothing else could.',
          },
          {
            title: 'Generate an SSH key from the dialog that needed it',
            detail:
              'A `git@` remote failing with "Permission denied (publickey)" used to be answered with a passphrase box — a prompt for a problem a passphrase almost never fixes. The credential dialog now lists the keys on the machine, says whether the host rejected one or there was never one to offer, copies the public half, links to the host\'s add-key page, and can generate an ed25519 key. If a requested passphrase does not take, the pair is deleted rather than reported as encrypted when it is not.',
          },
          {
            title: 'Shallow, blobless and single-branch clone — and a notice saying so',
            detail:
              'An Advanced section on the Clone dialog: depth, `--filter=blob:none`, single branch, submodules. The app then tells the truth about what that left behind, with a strip on History, File history, Blame and Compare and one-click `git fetch --unshallow`. A shallow clone does not fail — History simply has fewer rows and Blame attributes everything old to one commit, which reads as a repository with a strange past rather than one that is only partly here.',
          },
          {
            title: 'git notes, and blame.ignoreRevsFile',
            detail:
              'Notes attached to commits are shown, read per selected commit so the paged log pays nothing for a feature most repositories never use. Every `refs/notes/*` is shown and labelled — hiding one somebody attached is undiscoverable in a GUI. Blame now honours `blame.ignoreRevsFile`, so a repository-wide reformat stops attributing every line to whoever ran the formatter. Where such a file is configured both toggle states go through git itself, so the comparison is like with like.',
          },
          {
            title: 'Follow the system light/dark appearance',
            detail:
              'Pair a light theme with a dark one and the window switches with the OS. On a machine that changes at sunset this was the one window that did not. Existing installs keep the theme they had and land on "fixed"; the matching half of the pairing is seeded, so switching to "Follow system" later keeps the theme you were already using. The merge resolver window follows on its own.',
          },
          {
            title: 'Export and import all settings, not just a theme',
            detail:
              'A versioned JSON export of every preference, and an import that validates it. Preferences live in browser storage, which is the least durable place they could be — clearing site data or moving machines lost them silently. The exported set is derived from the schema rather than hand-listed, so a preference added later travels by default instead of being forgotten. Import merges onto your current settings, so an older file cannot silently switch update checks back on.',
          },
          {
            title: 'Update checks: automatic, manual, or never',
            detail:
              '"Never" makes genuinely no request from any path — the check button is disabled and the update chip is hidden — for a locked-down or offline machine where an accidental click must produce no traffic. "Only when I ask" keeps the button live for people who just want to control the timing. The last-checked timestamp is deliberately per-machine and does not travel in an exported settings file.',
          },
          {
            title: 'Settings → Diagnostics: find the log and hand it to someone',
            detail:
              'The log path, a Show file button that opens it in your file manager, and Copy last 500 lines. The copy puts the version, the environment line and the path on the clipboard alongside the tail, because 500 lines may not reach back to the startup header — so a pasted report describes itself even when the interesting part scrolled away. Until now the log lived at a per-platform path documented nowhere a user could see.',
          },
          {
            title: 'Delete an untracked file',
            detail:
              'On single rows and multi-select, behind a confirmation. A file that git has any index entry for is refused, including one at a conflict stage, so a merge in progress cannot be deleted as though it were untracked. Containment is checked against the real filesystem rather than the text of the path, because a symlinked directory makes an innocent-looking relative path point outside the worktree. A batch containing one bad path leaves everything untouched.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'Network operations and rebases say how far along they are',
            detail:
              'Clone was the only operation that could answer "how far?" — everything else showed the same indeterminate spinner, so a 300 MB fetch and a fetch stalled on a dead host looked identical for their whole duration. Fetch, pull and push now stream real progress, rebase reports step N of M as it goes, and the bar carries an elapsed clock past three seconds plus a Cancel button on the operations that can actually be cancelled. Tag push and remote-branch delete had no indicator at all; LFS, submodule update and forge checkout were cancellable with no button.',
          },
          {
            title: 'A slow refresh names what it is waiting on',
            detail:
              'Opening a repository runs ten backend reads at once, and one boolean described all of them — so a nine-second launch said only "syncing…". The status bar now names the longest-running read, and clicking expands the full list with a clock each. It waits 400 ms before appearing: a refresh runs on every tab switch and almost always finishes inside 100 ms, and a corner of the screen that strobes all day is one nobody reads.',
          },
          {
            title: 'F7 leaves a cursor where it lands',
            detail:
              '"Go to next change" moved a highlight and a scroll position and nothing else, so the next arrow key started over at the top of the file and the hint about the keypress appeared at the far edge of the window. The caret now lands on the hunk it jumped to, in all four diff surfaces, and the hint renders at the caret. Arrows and Home/End in the read-only diff panes now move that caret instead of scrolling by a fixed amount — consistent with the commit panel, which has behaved this way for some time.',
          },
          {
            title: '"Copy path" means one thing now',
            detail:
              'Four of the six Copy path actions were copying a repository-relative path under an absolute label, while two copied an absolute one — the same label meaning two things depending on where you right-clicked. Copy path is now always absolute and Copy relative path is always workdir-relative, beside it. This is a behaviour change: those four actions now copy an absolute path where they previously copied a relative one, and the relative value is one entry away.',
          },
          {
            title: 'A hung call leaves a trace instead of a void',
            detail:
              'Calls into the backend were logged only once they finished, so one that hung and one that was never dispatched wrote the same thing: nothing. A warning is now written while a call is still outstanding after ten seconds — the only line written mid-flight, which turns a missing completion line into evidence rather than an absence.',
          },
          {
            title: 'Every launch records what it is running on',
            detail:
              'One line naming the OS, the kernel, whether this is WSL, and the `git` the app will actually spawn — written after the path probe, so it names the real one. Opening a repository logs the path going in and the outcome coming out, so three failures that used to produce identical silence now read differently. A repository under `/mnt` on WSL additionally warns that every file check crosses the VM boundary there: not an error, but an unexplained nine-second launch reads as a broken app.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Cancelling a network operation could strand git\'s lock files',
            detail:
              'A cancelled fetch or push killed git outright, which could leave `index.lock` or a ref lock behind and make the next operation fail for a reason that had nothing to do with it. The process group is now asked to stop first and only killed if it does not, so git gets the chance to clean up after itself.',
          },
          {
            title: 'The folder picker could fail completely silently',
            detail:
              'Choosing a repository folder went through a call the app was not watching, invoked in a way that discarded its failure — so on a system without a desktop portal, which is the environment most likely to hit it, the dialog simply never appeared and nothing said why. It now reports the failure. Cancelling still says nothing, as it should.',
          },
          {
            title: 'A finished operation could clear another tab\'s spinner',
            detail:
              'Activity was written to whichever tab was open rather than to the repository that started the operation, so an operation finishing after a tab switch cleared the wrong tab\'s indicator and left its own frozen on the parked one forever. Separately, fetch, push and fast-forward cleared their label the moment a password prompt appeared, so the retried operation ran with no spinner and no Cancel button.',
          },
          {
            title: 'Reveal on a folder row opened the wrong folder',
            detail:
              '"Reveal in file manager" on a directory selected that folder inside its parent instead of opening it, because the action assumed its target was always a file. "Open in terminal" had the same fault and would open a folder\'s parent.',
          },
          {
            title: 'The Windows installer claimed GitHub published it',
            detail:
              'Add/Remove Programs listed the publisher as `github`. The field was never filled in, and the installer builder falls back to the second word of the app identifier — ours begins `io.github.…` — so every `.msi` up to and including 0.1.1 shipped that way. It now reads `Jonas Aasberg`. Upgrading over an older install behaves exactly as before; only the publisher line and one bookkeeping registry key change.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'The `.msi` upgrade identity is pinned',
            detail:
              'The value that tells Windows "this installer replaces that install" was derived from the product name, so renaming the app would have quietly stopped upgrades working and left two copies side by side. It is now written down explicitly, at the value it already had, so nothing changes for anyone already on 0.1.x.',
          },
          {
            title: 'winget submission is wired up',
            detail:
              'A wizard for the steps that live outside this repository, and a release job that publishes the manifest — self-disabling until the first submission has been made by hand, because the tooling needs an existing manifest as its template. Pinned to the `.msi`: the release also attaches a portable zip, and winget must never be pointed at that.',
          },
          {
            title: 'The Store package is built and checked by CI',
            detail:
              'The release builds x64 and arm64, combines them into one bundle, and gates on its shape — the executable, the `pgit` entry point, the app execution alias, and that each package declares the architecture it claims. The Store identity comes from repository variables and the job fails outright if they are missing, rather than attaching a bundle stamped with a development identity that installs fine everywhere and is rejected only at submission.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The Store listing is not live yet, and the package is not yet proven on Windows',
            detail:
              'This release produces the package; submitting it is a separate, manual step. Six behaviours specific to the packaged form have not been observed on a real Windows machine — most importantly whether git can invoke the app as its credential helper from inside a package directory, which if it fails would break authenticated operations quietly rather than loudly. Everything testable without Windows is covered by the test suite and CI. Stated here rather than discovered later.',
          },
          {
            title: 'Markdown commit bodies are still plain text',
            detail:
              'Notes and blame ignore-revs landed from the same issue; rendering markdown in commit bodies needs a dependency whose size and sanitisation are a separate decision, so it is deliberately not here.',
          },
          {
            title: 'The startup fan-out still queues behind one lock',
            detail:
              'The named loading tasks make this legible rather than fixing it: on a slow filesystem the dozen reads a launch makes finish in one cluster instead of spreading out, because reads of the same repository take turns. That is why a repository on a Windows drive under WSL takes so long to open. Tracked separately.',
          },
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-08-27',
    status: 'feature',
    summary:
      'Windows gets the treatment Debian got in 0.1.0: installing is two lines with Scoop, and staying current is `scoop update`. The app recognises a Scoop install and stands its own updater down, because self-updating one would have left two copies of platypusgit on the machine — and the `pgit` command comes with it rather than needing a second step.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Install on Windows with Scoop, and let Scoop own updates',
            detail:
              '`scoop bucket add platypusgit https://github.com/jonassaa/scoop-platypusgit` then `scoop install platypusgit`, and every later release arrives through `scoop update platypusgit`. It installs per-user, so nothing asks for elevation and `scoop uninstall platypusgit` removes every trace — and it shims both `platypusgit` and `pgit` onto your PATH itself, so the CLI needs no second step. Scoop installs a portable build rather than running the `.msi`, which is what makes all of that true; the trade is that it cannot install the WebView2 runtime for you the way the installer can. Windows 11 ships WebView2 and Windows 10 gets it with Edge, so it is almost certainly already there. The `.msi` is unchanged and remains the route that needs nothing installed first.',
          },
          {
            title: 'The update panel tells a Scoop install to run `scoop update`',
            detail:
              'Windows was the one platform that could always swap its own binary, and on a Scoop install that was exactly the wrong thing to do: the in-app update runs the per-machine `.msi`, which does not replace a Scoop install but adds a second one — the new copy in `C:\\Program Files`, Scoop\'s old one still on PATH and still behind the Start Menu shortcut, and `scoop list` reporting the old version from then on. Silently two installs, from one click. The app now recognises a Scoop install and offers the `scoop update` command instead, the same way an apt-managed `.deb` is told to run `apt upgrade`. It decides from Scoop\'s own layout on disk plus the `manifest.json` Scoop writes beside the binary — never from an environment variable, which is set for anyone who uses Scoop at all and would have told `.msi` users to update a package Scoop does not have. The `.msi` install keeps updating itself in place.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'A portable Windows build ships with every release',
            detail:
              '`PlatypusGit_x64_portable.zip` — the same binary the `.msi` wraps, plus a `pgit.cmd` and the licence. It exists so Scoop has something to install that is per-user and cleanly removable, and it is deliberately not offered on the download page as its own route: an unpacked copy with no package manager behind it would be told about new versions and then install them somewhere else. Take the `.msi` or Scoop.',
          },
          {
            title: 'The bucket manifest is generated, and a real install gates the release',
            detail:
              'The manifest is rendered by a script in the app repository rather than hand-edited in the bucket, so what you install from is reviewed in the same place as the code, and the release job pushes it with the same GitHub App and the same "never on a prerelease" gate that the Homebrew cask and the APT repository already use. Two checks stand between a build and a published manifest: the Windows job unpacks the zip it just built and refuses to attach one whose contents are wrong, and a clean Windows runner then does a real `scoop install` from the pushed manifest and asserts the binary, the `pgit` shim and the version — so a broken manifest fails the release instead of reaching anyone.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'Still no `winget` package',
            detail:
              'That one genuinely waits on a code-signing certificate rather than on code: an unsigned installer means a SmartScreen warning and a harder path through winget\'s review. Scoop never needed one, which is why it is here first. Chocolatey is not planned.',
          },
          {
            title: 'x64 only, on Windows as on Linux',
            detail:
              'Only a 64-bit Intel build is published. The bucket manifest is already written in the form that takes a second architecture as one more entry rather than a rewrite, so arm64 is additive when the build exists.',
          },
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-27',
    status: 'feature & fixes',
    summary:
      'Installing on Debian and Ubuntu is one line now, and staying current is `apt upgrade` — a signed package repository, an installer served from the bytes that were reviewed, and an update panel that knows which kind of `.deb` you have. Committing runs the hooks it had been silently skipping, a hung clone or fetch finally has a Cancel button, and the app can hand a file to your file manager or a repository to your terminal.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'One line installs the app on Debian and Ubuntu',
            detail:
              '`curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh` adds a signed APT repository and installs the app, so every later release arrives through `sudo apt update && sudo apt upgrade platypusgit`. It is safe under `curl | sh` the same way the `pgit` installer is: POSIX `sh`, `set -eu`, never reads stdin, every choice a flag or an environment variable, and a `--dry-run` that prints the plan and changes nothing. The served bytes ARE the repository\'s bytes — a build step copies the reviewed file rather than keeping a second copy — so what you pipe into a shell is what you can read first. It writes a deb822 `.sources` with an explicit `Architectures` and a pre-dearmored keyring, so the client needs no `gnupg` at all, and fetches to a temp file it moves into place, because an interrupted download that left a truncated keyring would break every later `apt update`. No `apt-get`, or an architecture other than amd64, prints why and points at the AppImage: a script that advertises an apt install and quietly drops a different package format costs more trust than it saves typing.',
          },
          {
            title: 'The update panel tells an apt-managed install to run `apt upgrade`',
            detail:
              'There are two kinds of `.deb` install now and they need different advice — `apt upgrade` on a sideloaded one reports "already the newest version" while the panel says an update exists, which is the exact dead end this hint was written to remove. The app decides by whether `/etc/apt/sources.list.d/platypusgit.sources` exists: one path check, on Linux only, no process spawn. A managed install gets the apt command, character-for-character the one on the download page, because two places giving one user two different upgrade commands is worse than either alone. A sideloaded install gets the one-liner, which upgrades now AND moves the install onto the path where `apt upgrade` works from then on. The AppImage remains the only Linux build that updates itself in-app — true before this release and nowhere on the page until now.',
          },
          {
            title: 'Committing runs the commit-side git hooks',
            detail:
              'Pushing ran `pre-push` while committing ran no hooks at all, so a repository with husky, lefthook, `pre-commit` or commitlint was enforced on push and silently bypassed on commit, with nothing in the UI saying so. `pre-commit`, `prepare-commit-msg`, `commit-msg` and `post-commit` now run around the commit. A non-zero `pre-commit`, `prepare-commit-msg` or `commit-msg` creates no object and moves no reference, mirroring the signing chain; `post-commit`\'s exit code is discarded, because git discards it. `commit-msg` may rewrite the message, so the panel now reports what was committed rather than what you typed. Hook output renders inline in the commit panel rather than in a toast, which auto-dismisses and cannot hold forty lines of eslint, or a modal, which would block the panel it is asking you to fix — and it is per-repository state, so switching tabs cannot carry one repository\'s rejected commit into another\'s panel.',
          },
          {
            title: 'A hook can be skipped once, and cannot become "never again"',
            detail:
              'The escape hatch is visible in both places you need it: a non-sticky checkbox before the fact, and "Commit without hooks" on the refusal itself. Pushing gains a confirmed, danger-marked "Push <branch> without hooks" command following the shape force-push already uses. Neither is ever persisted — a "skip once" that quietly becomes "never run hooks again" is a worse version of the bug this fixes. The commit itself stays libgit2\'s: shelling out to `git commit` would have run the hooks for free, but it would also have signed through git\'s own `gpg.program`, a second signing chain beside the app\'s one.',
          },
          {
            title: 'A clone, fetch, pull or push can be cancelled',
            detail:
              'One that hung could only be escaped by force-quitting the app. The Clone dialog\'s Cancel button now stays live while the clone runs and stops it, and the status bar grows a Cancel beside the "Fetching origin…" label that says what is stuck. Cancellation is keyed by scope rather than by an operation id on purpose: the auto-fetch timer stacks fetches behind a stalled one, and those are operations you never started and cannot point at — cancelling a scope reaches the whole pile where an id would leave it. Auto-fetch also skips a tick while a fetch is still running, so a stalled remote can no longer grow a pile of stuck processes. Pressing Cancel reports a cancellation, not a network failure: a killed git\'s dying stderr says "early EOF" and "the remote end hung up unexpectedly", and routed through the network error you would have been told your connection broke.',
          },
          {
            title: 'A cancelled clone cleans up after itself',
            detail:
              'A killed `git clone` cannot run its own cleanup, and the leftovers would fail the NEXT attempt with "already exists and is not empty" — a cancel button whose real effect is to poison the destination. The partial destination is removed, and an empty directory you picked yourself is put back. Safe only because the target validation already refused anything but "absent" or "your own empty directory", and only after an explicit kill and reap, so git is provably no longer writing into it. Deliberately not included: a timeout. One short enough to rescue a stalled host is short enough to kill a legitimately slow clone of a large repository over a poor link, and you are the only one who can tell those apart — which is what the button is for.',
          },
          {
            title: 'Reveal in Finder or Explorer, and open in terminal',
            detail:
              'Two context-menu actions on file rows in the Commit panel and the repository browser, beside Copy path, and on the repository tab strip\'s menu. Per-platform argv is built as pure functions and unit-tested for all three platforms from any host, and spawned only through the one sanctioned spawner. The Windows launchers are pinned to their system directories rather than looked up by name, because `CreateProcess` searches the current directory first and this app\'s working directory IS a repository whenever `pgit` launched it from inside one — a cloned repo shipping its own `cmd.exe` would otherwise be what runs. A missing Linux terminal falls through an ordered candidate list instead of failing silently.',
          },
          {
            title: 'The window title names the active repository and branch',
            detail:
              'With several repositories open in one window, the title bar now says which one you are in and what is checked out, so the window is identifiable from the OS window list and from a switcher.',
          },
          {
            title: '`pgit` opens every screen, and answers `--version`',
            detail:
              'The shim reached three of the app\'s eleven top-level screens — commit/status, log/history, branches — and a bare `pgit branch`, an easy typo, fell through to path handling instead of being recognised. All eleven resolve now: `branch`, `files`/`browse`/`tree`, `rebase`, `remote`/`remotes`, `pr`/`prs`/`pulls`, `reflog`, `submodules`, `worktrees` and `settings`/`config`, each in the alias test table, the usage text and the README. `pgit --version` and `-V` print the version. The deep views — diff, commit diff, compare, file history, blame — stay out deliberately: they need a payload the shell cannot restore from a screen id alone.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'The `.deb` declares that it needs git',
            detail:
              'The backend shells out to real git wherever libgit2 falls short, so a fresh-box install used to succeed and then fail at runtime in exactly the operations that matter most. `Depends: git` is what makes "one command and it works" survive a container or a minimal cloud image. A git GUI without git is not degraded, it is broken. The package also declares its `vcs` section, which the index builder wants.',
          },
          {
            title: 'An invalid branch name says what is wrong',
            detail:
              'Tags have given a clear message on a bad name since 0.0.13; branches passed the name straight to libgit2 and surfaced whatever came back. The ref-name rules are now shared between the two, so creating or renaming a branch with an invalid name is refused the same way an invalid tag name already was — and integration tests prove a rejected name never reaches the repository.',
          },
          {
            title: 'The download page opens on the platform you are on',
            detail:
              'The OS selector never actually sniffed: it returned macOS unless a URL hash said otherwise, so every Windows and Linux visitor landed on Homebrew instructions. It reads the platform now — Apple first, since iPadOS reports "like Mac OS X" and Android reports "Linux" — and resolves it above the panels so the correct one is the only one ever painted, rather than rendering all three and collapsing the page under the reader. With JavaScript off, macOS opens as a fallback. The page itself is rebuilt from a wall of prose into bordered cards in a grid, with the tab row sitting ON the panel it controls, arrow-key support and `aria-selected`, Gatekeeper and SmartScreen notes folded into disclosures, and exactly one card per platform carrying the accent so "Recommended" means something. The Linux panel leads with the apt one-liner and reframes the AppImage as what it is: the route for non-Debian distributions, and the only Linux build that self-updates.',
          },
          {
            title: 'The screenshots are sharp on whatever display you are reading on',
            detail:
              'The masters were 1x captures laid out at 1040 CSS px, so a 1x screen got a 0.65x downscale of 1px-stroke text and a Retina screen a 1.3x UPSCALE — both destroy glyph edges. The compression was never the cause and raising quality could not have helped: cropping the same region from the PNG master and the shipped q85 WebP at 1:1 gives visually identical output, so the detail was not in the file. One variant per device pixel ratio is emitted and offered in a `srcset` so each display paints 1:1, with the 1x variant pre-encoded at the layout width using lanczos3 rather than shipping 1600px for the browser to resample — 345KB down to 211KB. A master too small for an honest @2x variant gets a warning instead of an upscale that costs bytes and adds no detail, and the capture step now REJECTS a screenshot that is not 2x, because a capture size is not a detail to leave to whoever is holding the mouse.',
          },
          {
            title: 'A comparison table, with every competitor claim citing that vendor\'s own page',
            detail:
              'Price, account, telemetry, platforms and licence for GitKraken, Fork, Sourcetree and TortoiseGit — on the landing page directly under the "why" grid, because that grid makes four claims and the table is the evidence for them on facts you can check rather than adjectives. One JSON file is the source of truth for both the site and the README, and a test parses the README table and fails the build on drift in any cell, the checked-on date or a source link; two tables that disagree are worse than one. A claim about somebody else\'s product is never more than one click from the vendor page it came from, enforced rather than intended. The section ends by naming where this app is behind rather than hiding it.',
          },
          {
            title: 'The README and CONTRIBUTING were rebuilt, and audited against what the code does',
            detail:
              'The README leads with the product and moves install to the top; CONTRIBUTING is ordered clone → prerequisites → run → verify, with the timings said out loud, because the first `pnpm tauri dev` compiles the whole Rust tree for several minutes with no window and no output and a newcomer watching that assumes it has hung. The corrections matter more than the layout: the `pgit` shim was documented as unsupported on Windows when the `.msi` installs it; the feature list predated pull requests, multi-repo tabs, submodules, worktrees, LFS, bisect, branch compare, signed tags, log search, the minimap, syntax highlighting, side-by-side diffs, line-level staging and clone; `pnpm tauri build` was documented bare when it is a hard error without a signing key; and the Linux prerequisite list named a package CI does not install while omitting four that it does, so following it got you a linker error. Both files now have tests pinning the mechanically checkable half — links resolve, every `pnpm <name>` is a real script — so they cannot quietly drift back.',
          },
          {
            title: 'The e2e suite stopped waiting on itself',
            detail:
              'A reload race owned 70-80% of the suite\'s wall time. Settling it makes the gate quick enough to run per shard without the run length being the reason not to look.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'The Debian package is `platypusgit`, not `platypus-git`',
            detail:
              '`productName` was the one place the project spelled itself "PlatypusGit", and that inconsistency was load-bearing: Tauri derives the Debian `Package` field from `productName` alone by kebab-casing it, and the internal capital is a word boundary. Lowercase maps straight through, so `apt install platypusgit` and `apt upgrade platypusgit` are the real commands rather than an alias. Done in this release because the window was closing — no release had published to apt yet, so the repository has only ever had to know one name; after the first publish every apt-managed install would have needed a `Replaces`/`Conflicts` migration instead. The `.deb` keeps the old name as `provides`, `replaces` and `conflicts`, because both packages own `/usr/bin/platypusgit` and a sideloaded older `.deb` would otherwise upgrade into a hard dpkg file conflict; verified in a container, old package replaced cleanly with `pgit` still working. The macOS app bundle is renamed with it, and the release now FAILS if the Homebrew cask\'s `app` stanza does not match `productName`, rather than shipping a cask that points at an app which no longer exists.',
          },
          {
            title: 'Nothing reaches the package repository until a real `apt-get install` succeeds',
            detail:
              'The `.deb` is published to the signed index only after a gate installs it in a clean `debian:bookworm` container, driving the same installer the download page tells you to pipe into a shell, asserting the control fields, and running `pgit --help` — which proves the binary loads and every shared library resolved, where a permissions check cannot. A second job then installs from the live host, which the pre-push gate structurally cannot see: DNS, the Pages build, HTTPS, propagation. The `.deb` comes from the published release rather than a job artifact, so what lands in the pool is provably the bundle you get. The index is a pure function of the pool with no database — the pool is the state, git is the history — so a re-run against an existing tag is a genuine no-op, and a `Release` file that listed itself in its own checksums (measured on the first run, not theorised) is now refused outright.',
          },
          {
            title: 'The three public promises have tests behind them',
            detail:
              'No telemetry, no account, and no outbound traffic beyond your git remotes, the update check and forge APIs you configured. All three were true by inspection and nothing kept them true — one transitive dependency that "just" reports errors, or one well-meant "help us improve" toggle, and the claim becomes a lie. Two guards, one per tree, because a single test over both would be skipped by exactly the change it polices: no analytics package in `package.json` or anywhere in the lockfile, no network call or analytics global in shipped frontend source, one direct HTTP client in the backend with `ureq` confined to its two disclosed call sites, the updater endpoint exactly as disclosed, no permission handing the webview its own client, and every hard-coded hostname allow-listed with a written reason. Every guard was verified to fail on a planted violation before it landed.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The apt repository is amd64 only',
            detail:
              'There is no arm64 Linux build yet, so the installer detects the architecture and refuses with an explanation rather than installing a package that cannot run. The AppImage is the route in the meantime, and arm64 is tracked as its own issue. The client side of the smoke gate is pinned to amd64 for the same reason: on an arm64 machine apt verifies the index, fetches the package list and then reports "Unable to locate package", which reads as a broken repository rather than a wrong architecture.',
          },
          {
            title: 'In-place `.msi` upgrades break once, on this release only',
            detail:
              'The MSI UpgradeCode is derived from `productName`, so the rename gives 0.1.0 a different one and Windows will not treat it as an upgrade of an installed 0.0.17 — it installs alongside. Harmless today because there are no real `.msi` installs to migrate, which is precisely why the rename happened now; it is written down as something to pin before there are.',
          },
          {
            title: 'The installers are still unsigned, and macOS is not notarized',
            detail:
              'The app is ad-hoc signed but has no Developer ID, so Gatekeeper quarantines the `.dmg` — the Homebrew cask strips the flag, and a manual drag needs the `xattr` line the download page gives you — and Windows shows a SmartScreen warning on the `.msi`. Unchanged this release, and named in the comparison table rather than left out of it.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.17',
    date: '2026-08-25',
    status: 'feature & fixes',
    summary:
      'A diff you can select and copy — as source, not as a column of line numbers — with `Mod+C` and a right-click menu that reach past the rows the window happens to be rendering. `F7` now centres the change it lands on whatever its size, and the app icon lost the dark box it was sitting in.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Diff text can be selected and copied',
            detail:
              '`body` is `user-select: none` for a native desktop feel and no diff surface had opted back in, so the code you were reading could not be selected at all. Every row\'s code cell is selectable now, on all four diff surfaces, while the line-number cells and the `+`/`−` marker stay unselectable: a copied block pastes as source rather than as text you have to clean up by hand.',
          },
          {
            title: 'Copy the whole diff, not only the rows on screen',
            detail:
              'The diff surfaces are windowed, so rows outside the viewport are not in the document and a mouse drag stops at the edge of what is rendered. Two paths build their text from the row model instead, which has no such ceiling: `Mod+C` copies the line selection, and a right-click menu offers Copy, Copy N selected lines and Copy file diff as text on every surface. `Mod+C` still means "copy" — it declines whenever a text selection exists and whenever nothing is selected, which leaves the chord unhandled so the webview\'s own copy runs.',
          },
          {
            title: 'A transparent, full-bleed app icon',
            detail:
              'The shipped icons were a dark `#1c2020` square with the platypus head at about 42% of the canvas, so in the Dock and the taskbar the mark read as a small face inside a box. The plate is gone and the head is cropped to a 5.6% safe margin — about 89% of the canvas, sitting on whatever the OS paints behind it, legible on light and dark alike since the eyes live inside the teal head rather than on the backdrop. The whole bundled set (`icns`, `ico`, `png`, and the Windows Store squares) is regenerated from one transparent master.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: '`F7` centres the change instead of parking it near the top',
            detail:
              'The four-row lead-in shipped in 0.0.16 answered "one keypress must mean one thing" with a constant: a two-line change and a forty-line one both landed with their first row four rows down, so the big one ran off the bottom with nothing following it on screen. `F7`, `⇧F7` and the auto-open now put the middle of a hunk\'s changed extent — first changed row through last, any context between two runs of changes included — on the middle of the viewport, so context stays on both sides of the change at every size. A change TALLER than the viewport cannot be centred without hiding its own start, so it degrades to the old lead-in above its top row. The target snaps to a row boundary either way, so neither edge of the viewport shows a half-sliced line.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: '"Copy file diff as text" printed the `@@` range twice on a commit diff',
            detail:
              'It mapped over every line including libgit2\'s own hunk header, which came out space-prefixed directly under the real one. The shared builder drops it through the same content test the row model uses, so the line numbering cannot drift from what is on screen either.',
          },
          {
            title: 'Dragging a file row across the diff does not smear a selection over the code',
            detail:
              'Opting text back in defeats a body-level `user-select: none`, because a class beats an inherited value — and that inherited value was exactly what kept a row drag from selecting everything it passed over. The drag controller marks the body for the drag\'s duration now, which suppresses the opted-in cells while it lasts.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'A mouse selection still stops at the edge of the rendered rows',
            detail:
              'Windowing is what keeps a 10,000-line diff scrolling at all, and a selection cannot extend into rows the document does not hold. Dragging to the bottom of the pane selects what is rendered, not the rest of the file — `Mod+C` on a line selection, or "Copy file diff as text" from the right-click menu, is the path that reaches the whole thing.',
          },
          {
            title: 'A change near either end of a file cannot land centred',
            detail:
              'A hunk within half a viewport of the top or the bottom of the file clamps against that end, which is the price of a scroll range that stays honest. `F7` also still scrolls when the next hunk was already on screen: every change landing in the same place is the point of it.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.16',
    date: '2026-08-21',
    status: 'feature & fixes',
    summary:
      'Two detours removed: a diff opens where the change is and `F7` carries through the rest of the commit, and interactive rebase takes any commit as its base rather than only a branch. The app\'s last native dropdown went with them.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Interactive rebase onto any commit',
            detail:
              'The base picker took a branch. It now takes anything a rebase can start from — a diverged branch, a commit on another line of history, a bare hash — and the pick / squash / reword / drop plan is on screen before a single commit is replayed. `git rebase -i <newbase>`, with the plan first. A commit\'s own context menu in History offers "Rebase current branch onto this…", which is how a base you can already see is usually chosen.',
          },
          {
            title: 'A long range is replayed whole, not truncated',
            detail:
              'The commit range behind the plan is fetched against the exact ahead/behind count and its length verified, because the underlying listing stops at 200: a longer range would have come back short, and a plan that leaves commits unreplayed still moves the branch ref. A base that cannot be resolved now says so on the screen itself — reached from a context menu there is no picker open to say it in.',
          },
          {
            title: 'A diff opens at the first change',
            detail:
              'Whole file is the default view, so a diff opened on line 1 of unchanged context and reading one began by scrolling to hunt for the change. The first change is now revealed with the cursor already on it — once the geometry is genuinely final: the rows exist, the viewport has been measured, whole-file mode has its file text, and the row model belongs to the file now shown rather than the one being left.',
          },
          {
            title: '`F7` carries into the next file',
            detail:
              'On the last hunk of a file `F7` was a silent no-op that still claimed the chord, so there was no way to keep going from the keyboard. It now flashes "No more changes — press F7 again for the next file", naming the chord from your live keymap; the next press inside the hint\'s lifetime opens the next file at its first change and moves the file-list selection with it. `⇧F7` mirrors it, landing on the previous file\'s last change. Each end of the list flashes and stays put — no wrap-around.',
          },
          {
            title: 'The update panel\'s command can be copied',
            detail:
              'When an update belongs to a package manager the panel shows the line to run — `brew upgrade …`, `sudo apt install …` — and that line sat in a bare `<code>` element under the app-wide `user-select: none`, so the panel\'s only actionable content could neither be selected nor copied. You had to retype it character-exact from a popover that closes on the next click outside it. There is a copy button beside it now, and dragging across part of it selects it.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'Every dropdown in the app is an in-page listbox',
            detail:
              'The last native `<select>` is gone, and everything it gave for free is re-provided deliberately: arrows, Home/End, PageUp/PageDown, Enter and Space to commit, Tab to commit and move on, `Alt`+arrow per the ARIA pattern, native-style typeahead (one character cycles, a longer buffer narrows by prefix), combobox / listbox / option roles, focus that never leaves the trigger, and an intrinsic width equal to the widest option. Escape closes the dropdown without closing the dialog around it, and the control can finally be themed to match every other picker in the app.',
          },
          {
            title: 'A dropdown no longer drives the list behind it',
            detail:
              'The keymap\'s text-input policy is the only thing keeping bare-key chords out of list navigation, and it recognises inputs and text areas — not a native `<select>`. So `↓` inside the old picker also moved History\'s commit selection, and a letter also fed the focused pane\'s speed-search. The new control\'s focus host is a read-only `<input>`, which the policy does recognise: protection this control never had.',
          },
          {
            title: '`F7` parks the change below the top of the pane',
            detail:
              'Hunk navigation scrolled by the smallest move that reveals a row, so walking forward pinned every change to the bottom edge with no following context, and the Diff screen skipped the scroll entirely when the hunk was already on screen — one keypress meant two different things depending on where the last one had left the pane. The hunk now lands four rows below the top every time, degrading to flush with the top in a pane too short to park it there.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'The changed-file list showed the previous commit\'s files while the next diff loaded',
            detail:
              'The loading skeleton appeared directly above the previous commit\'s file rows, with that commit\'s diff still filling the view pane beside it. Every caller keeps the old diffs while the next fetch is in flight — History debounces `↑`/`↓` through the log by 100ms — so loading was always true together with a stale, non-empty list. The list blanks now and the view pane gets the same code-line skeleton the repository browser uses, while a refetch of the SAME commit still lands back on the file you were reading.',
          },
          {
            title: 'Three measurement bugs under the diff, each invisible on its own',
            detail:
              'The viewport height was measured once at mount, but every diff surface renders its scroll container only after the diff arrives — so the read found nothing, never ran again, and the height stayed 0 until you happened to scroll. It also kept a stale height when that container went away. And a programmatic `scrollTop` write is not a scroll event: measured on WebKitGTK, an assignment left the window of rendered rows describing the old position for seconds, so the row scrolled to stayed unmounted. Every programmatic diff scroll now assigns and publishes the new position in one call.',
          },
          {
            title: 'Repeated hints replace each other instead of stacking',
            detail:
              'The flash helper appended a fresh node per call, so two hints raised in quick succession piled onto the same fixed position. It is single-instance now — which the "press it again" hint, the one guaranteed to be raised twice, made unavoidable.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The Wayland dropdown freeze is mitigated, not verified fixed',
            detail:
              'Dropping the native `<select>` removes the surface the reported Linux freeze happens on: WebKitGTK maps one as a GDK popup, GDK\'s Wayland backend refuses to map a popup that would not be the topmost one, and History kept two mounted at all times while Rebase mounts one per plan row. The freeze itself was never reproduced here — the only Linux lane is xvfb on X11, which cannot emit a Wayland-only warning — so the issue stays open, and a report from a Wayland session is worth more than usual.',
          },
          {
            title: 'The new scroll positions were measured on the Linux webview',
            detail:
              'Where a diff opens, where `F7` parks a hunk, and the hand-off into the next file were all verified there. How they land on macOS, and at a high device-pixel ratio, is unverified.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          {
            title: '`pgit` no longer detaches the app in a dev build',
            detail:
              'Building from source, `tauri dev` runs the app as its own child with the developer\'s terminal inherited, which the launch\'s tty test read as "started from a shell" — so the app re-exec\'d itself detached, its parent exited 0, and the Tauri CLI concluded the app had closed and took the vite dev server down with it. It read as `tauri dev` returning instantly and a window that never painted. Shipped bundles are untouched: `pgit .` still hands the prompt straight back.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.15',
    date: '2026-08-19',
    status: 'feature & fixes',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Check out a branch from the commit it is sitting on',
            detail:
              'A commit\'s context menu in History offered to check out the commit — detaching HEAD — and to create a branch from it, but not to check out a branch already sitting there; you had to leave for the branch chip, the Branches screen or the palette. One branch is now an inline entry, several collapse into a submenu, and both sit above the detached-HEAD entry, which stays: on a commit that has a branch, checking the branch out is the safer and far more common intent.',
          },
          {
            title: 'The menu tells you where you are',
            detail:
              'The branch you are already on is listed and disabled rather than hidden. A ref that exists only on the remote offers to check it out as a new local branch and goes through the tracking-branch prompt — it never detaches silently. History\'s "local branches only" filter is deliberately not consulted: that filter thins out crowded ref pills, and hiding a pill must not remove an action from a menu.',
          },
          {
            title: 'pgit arrives with the app on every channel that can install it',
            detail:
              'The Homebrew cask now links `pgit` as part of installing the app, so a `brew install` — or a `brew upgrade` onto this version — gets the command without anyone finding Settings first. That closes both gaps 0.0.12 named.',
          },
          {
            title: 'A one-liner for the two channels that run no install code',
            detail:
              'The macOS `.dmg` executes nothing when you drag the app into place, and the Linux AppImage is not installed at all. Both now have a documented `curl -fsSL https://www.platypusgit.com/install-pgit.sh | sh` on the download page, with an `irm … | iex` form for Windows PowerShell. The scripts are served from the repository\'s own copies by a build step rather than a second checked-in copy, so the bytes you pipe into a shell are the bytes that were reviewed — and a missing source fails the site build instead of publishing a 404 at a URL that tells you to pipe it into a shell.',
          },
          {
            title: 'Read it before you run it',
            detail:
              'The download page leads with which channels already have the command rather than with the command itself. Both scripts open as plain text in a browser, both can be downloaded and inspected first, and both take a dry-run flag.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'The + button sits next to the last tab',
            detail:
              'It was pinned to the far right of the window, so with two repositories open it stood alone at the other end of a window-wide gap, reading as part of the window rather than as the end of the strip. It now renders inside the scrolling strip, immediately after the last tab, at every tab count — one layout rather than two picked by measuring the strip against itself, which on the Linux webview means measuring without a `ResizeObserver`.',
          },
          {
            title: 'The cost, stated: with enough tabs, the + scrolls off',
            detail:
              'Open enough repositories to overflow the strip and the button scrolls off to the right along with the tabs it follows — and the same scroll brings it back. `⌘O`, the command palette and the Welcome screen all still reach the action.',
          },
          {
            title: 'Two smaller things went with it',
            detail:
              'The button drew its own left border against the preceding tab\'s right border and rendered a double line; that is a single divider now. And scrolling the active tab into view used to stop at that tab\'s edge and leave the button half-clipped whenever the last tab was the active one, so the strip now aims at the button in exactly that case.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'A repository could open twice, and the diff pane died with it',
            detail:
              'Launching `pgit <path>` on a repository the session had already restored opened it a second time, because the two things that produce that path spelled it differently — libgit2 hands back a trailing slash and one of the two stripped it — so `/repo/` matched no tab in an open set holding `/repo`. Two backend handles then existed for one repository and the app went on referencing the one it had just discarded, so from that moment every commit you clicked answered "unknown repository" with no banner anywhere. One spelling for one path fixes the double open, and a second guard fixes the race that made the discarded handle the live one.',
          },
          {
            title: 'Three more leaked git handles, none of them in the report',
            detail:
              'The visible one is "New repository…", which opened the repository once to create it and once again to show it, leaking a git handle and its open file descriptors on every single use for as long as the app stayed running.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.14',
    date: '2026-08-18',
    status: 'performance & fixes',
    summary:
      'A performance pass: the app is faster where you feel it, and different nowhere. No new features, no behaviour changes — so what is listed is what you should notice.',
    sections: [
      {
        title: 'Performance',
        items: [
          {
            title: 'Scrolling a long diff no longer re-renders anything',
            detail:
              'Every scroll pixel used to rebuild the whole screen the diff sits in, at the rate a trackpad generates events. A scroll now costs nothing at all until the window of rendered rows genuinely has to move, with only the narrow minimap gutter following the viewport frame by frame.',
          },
          {
            title: 'Highlighting on the first paint',
            detail:
              'A file you have already opened comes up highlighted instead of showing plain text and then correcting itself, because the token cache is read straight away rather than a render later.',
          },
          {
            title: 'The first file in a language opens quicker',
            detail:
              'The syntax grammars ship precompiled, so a language\'s patterns are native from the start instead of being translated on first use, and the highlighter warms itself up while the app sits idle after launch — so the first file pays for its own work and not for the machinery.',
          },
          {
            title: 'Word-level highlighting is computed once per diff',
            detail:
              'Rather than redone every time syntax arrives, a fold expands, or you change the row density.',
          },
          {
            title: 'Locking is per repository, not per process',
            detail:
              'Every git operation in the whole process queued behind a single lock, so a log walk in one tab genuinely blocked a status refresh in another, and requests meant to go out together went out strictly one at a time. Two operations on the same repository still take their turn, as they must.',
          },
          {
            title: 'A commit\'s diff is one pass, not one per file',
            detail:
              'Its cost grew with the square of the number of files in the commit, because the patch for every file was regenerated once per file. Every surface showing a commit\'s diff inherits the fix: the panel under History, the commit-diff screen, branch compare, and a stash\'s contents.',
          },
          {
            title: 'A long tail of the same kind',
            detail:
              'A diff of one file no longer walks the entire working tree to find it; History\'s rows stop re-rendering as a group whenever anything at all changes; the file tree stops re-walking the worktree on every render; the commit panel stops paying a cost that grows with the number of changed files on every keystroke in the message box; the command palette stops rebuilding and re-sorting its whole index while closed; and the titlebar stops re-rendering on every write to the store.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'A long line no longer paints on top of the line beneath it',
            detail:
              'In the unified diff a line too wide for the pane wrapped while the row holding it kept its fixed height, so the wrapped remainder drew straight over the rows below and two or three source lines composited into a single row\'s worth of space. It was worst in the Repo Browser, where the diff is squeezed between the file tree and the file-info sidebar. Long lines now run off to the right and the pane scrolls, and a row stretches to the full width of its content so a changed line\'s colour, its gutter stripe and the focus ring cover the whole line.',
          },
          {
            title: 'The Diff screen\'s Wrap toggle does something at last',
            detail:
              'It was broken in both positions: off, it wrapped anyway, because wrapping was never conditional on it; on, it wrapped and still overlapped, because the fixed row height was applied regardless. Row heights have to stay knowable — the windowing, the jump to a given row, the `F7` anchors and the minimap all agree with the page without measuring it — so wrapping is real now, a row grows to fit while it is on, and everything that reads row heights switches off together with it. `F7` included, which until now jumped to offsets the rendered rows no longer had. The side-by-side view always wrapped correctly and is untouched.',
          },
          {
            title: 'Windows: the console flash is gone',
            detail:
              'A release build is a windowed process owning no console, so each time the app ran real `git`, Windows made a console for it and drew the window that hosts one — and of the twenty places this app starts a process, exactly one set the flag that prevents that. Selecting a commit was the mildest case: staging or discarding a hunk runs `git apply`, the git-LFS check fires for a feature your repository may not use, every read of bisect progress is another, and auto-fetch runs on a timer, so a console flashed with no action on your part at all. It only happens in an installed build, too: a build from source already owns a console and hands it down to its children, so anyone reproducing it from source concludes there is nothing wrong.',
          },
          {
            title: 'One sanctioned way to start a process, with a test behind it',
            detail:
              'All twenty sites go through it, and the build fails if a twenty-first appears — a helper you have to remember is exactly what nineteen of twenty forgot. Two keep their consoles deliberately, through separately named constructors: `git mergetool`, and your `$VISUAL` or `$EDITOR`. A console editor needs the console it is being given, and silencing it would leave an invisible process holding your file open with nothing able to cancel it.',
          },
          {
            title: 'Signature checks skip the subprocess when there is nothing to check',
            detail:
              'Verifying a commit now asks the git library whether there is a signature at all before running anything. Most commits in most repositories are unsigned — and an unsigned commit displays no badge — so the common case had been paying for a whole subprocess to render nothing. This one is a saving everywhere, not only on Windows.',
          },
          {
            title: 'A file whose name contains a glob character was diffed as a glob',
            detail:
              'A diff of one path did not switch pattern matching off, so a file named literally `*.txt` matched every other `.txt` file beside it: what you were shown was not that file\'s diff, and the per-hunk and per-line staging that indexes into that diff was indexing into something wider. Rare, entirely legal, and pinned by a test now.',
          },
          {
            title: 'Signature verification reported every failure as a bad object id',
            detail:
              'A broken `gpg` or `ssh-keygen` installation came back claiming the commit did not exist. It carries git\'s own message now, and an object that genuinely is unknown is settled before anything is run.',
          },
          {
            title: 'One git call could wait forever for an answer',
            detail:
              'It was the single call in that file setting neither the do-not-prompt environment nor a closed input, so a `git` that decided to ask a question could hang with nothing in the app able to cancel it.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'With Wrap off, a long line is no longer visible all at once',
            detail: 'The stated cost of scrolling horizontally instead of overlapping.',
          },
          {
            title: 'The diff work was measured on the Linux webview only',
            detail:
              'How the horizontal scrolling and the row backgrounds look on macOS is worth a report.',
          },
          {
            title: 'None of the Windows console behaviour has been confirmed on Windows',
            detail:
              'It wants a release build on a real machine, and one question is genuinely open: whether `gpg` and `ssh-keygen`, which git starts by itself when it checks a signed commit, still flash once their parent has been silenced. The report this came from stays open until somebody looks.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.13',
    date: '2026-08-18',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'The diff reads as a file, not a stack of labelled sections',
            detail:
              'The `@@ -12,7 +12,9 @@` banner is gone from every diff surface, and so are the `@@` lines that travelled inside each hunk and outlived the bar. A changed line carries a coloured background and nothing else — red for removed, green for added.',
          },
          {
            title: 'Stage and Discard are a gutter cluster on the first changed row',
            detail:
              'Drawn at rest rather than only under the pointer, on the first changed row of each block: a windowed diff cannot wrap a hunk in one element, and a control you can find only by hovering the exact row it sits on is not a control. `F7` and `⇧F7` anchor on that same row, which is where the change actually starts.',
          },
          {
            title: 'Fold separators instead of per-hunk collapse',
            detail:
              'In chunked-context mode every gap between blocks says how many lines it is hiding and which range they cover, and expands them in place. Per-hunk collapse is retired: it hid a change while leaving its context on screen, and its chevron would have sat beside a fold separator\'s chevron meaning the opposite.',
          },
          {
            title: 'Hunk staging has real chords',
            detail:
              'The old banner\'s Stage and Discard buttons were mouse-only — no key sequence could reach either. Staging and discarding the hunk you are on are `⌘⇧H` and `⌘⇧⌫` now, in both presets. And `F7`, which did nothing whatsoever in the commit panel or the repo browser, is wired into all four diff surfaces.',
          },
          {
            title: 'A minimap down the side of the diff, and you can scrub it',
            detail:
              'Every diff surface wide enough for one gets a narrow canvas showing the whole file at a glance — where the changes are, how large they are, how they are spread through the file — with a band marking the slice currently on screen. Click to jump, or drag to scrub: pressing inside the band keeps your grab offset, pressing outside centres the row you pointed at, and a drag past either end pins at the limit instead of sliding away with the cursor.',
          },
          {
            title: 'The minimap is painted, not measured',
            detail:
              'It comes from the diff the app already holds in memory rather than off the page, because a long file is windowed and most of its rows are not there to measure. It hides itself below a container width derived from the diff\'s own geometry rather than picked by eye, so the narrow commit panel earns one on a wide display and a pane you drag narrow gives it up. It follows the active theme, light modes included, and repaints when you edit the theme you are on.',
          },
          {
            title: 'Diff what you have selected in History, from the menu or ⌘D',
            detail:
              'One commit selected shows that commit\'s diff; several show the combined diff across the range they span. A single commit\'s context menu gained a View diff entry — it used to offer Compare with HEAD and nothing else diff-shaped — and `⌘D` reads the selection while the commit list has focus, without losing its meaning anywhere else. A selection with gaps in it now says so in the detail pane, since a range diff necessarily covers every commit between the outermost two.',
          },
          {
            title: 'Panels grow to the window instead of to a number somebody typed',
            detail:
              'Every resizable pane had a hard-coded pixel ceiling — a 520px file list, a 640px composer, a 600px tree — so on a large display the panels stayed far smaller than the space allowed. The constraint is expressed the other way round now, as how small the pane on the other side of the handle may get, and that removes the ceiling on its own.',
          },
          {
            title: 'Pane sizes follow you between displays',
            detail:
              'The size you drag is kept as your preference and clamped to whatever window it is being drawn in, so reopening a 720px panel on a laptop narrows it there without discarding what the external monitor earned. Double-click a handle to reset that pane to its default size — every handle in the app, twelve of them.',
          },
          {
            title: 'pgit hands the terminal back',
            detail:
              '`pgit .` held the prompt for as long as the app stayed open, and `Ctrl+C` killed the app; it returns immediately now, the way `code .` does. The detach lives in the binary rather than in the launcher shims, because a symlink cannot detach by construction and four shim-side implementations would have drifted apart. Three cases deliberately stay in the foreground: `--help`, a launch whose output is not a terminal (so `pgit . > file` still blocks), and the askpass helper git runs when it needs a credential. Unix for now; Windows is unchanged.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'The merge resolver window leaked the browser\'s own context menu',
            detail:
              'Right-clicking anywhere in the resolver, over the editable result pane included, offered reload and inspect-element on top of merged work that exists nowhere else yet — and on Linux that menu is a real GTK popup with spell-check and IME submenus hanging off it. The suppression the rest of the app uses is document-scoped, and the resolver is a separate window with its own document, so it had never applied there.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'The side-by-side view still shows its own @@ separator rows',
            detail:
              'It fills no gaps, so those rows have to stay, and turning them into folds needs counts that view does not compute. A follow-up.',
          },
          {
            title: 'The new diff area has only been rendered on the Linux webview',
            detail:
              'The continuous view, the gutter cluster, the fold separators and the minimap, all at a single device-pixel ratio. How they look on a high-density display, and on macOS in particular, is unverified — a report about it is more useful here than usual.',
          },
          {
            title: 'The Linux resolver freeze is not fixed',
            detail:
              'The context-menu fix was found while investigating it. That one is still unreproduced and its evidence increasingly points at WSLg rather than at this app.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.12',
    date: '2026-08-17',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Stash the files you picked',
            detail:
              'A stash used to be all-or-nothing. "Stash this file…" now sits on any row and "Stash 3 files…" on a selection, stashing just those paths from the same buckets Stage and Discard already read. The prompt says up front what you cannot see coming: untracked files in the selection come along, and staged ones are unstaged by the move and come back unstaged when you pop. A selection with nothing modified in it says so, instead of git exiting successfully having stashed nothing while the app said nothing either.',
          },
          {
            title: 'Rename a stash entry',
            detail:
              'It moves the entry to the top of the list — git\'s stash reflog can only be prepended to, so the prompt states that rather than letting you discover it. The rename is additive first, so a failure anywhere leaves you a duplicate you can drop rather than a gap.',
          },
          {
            title: 'Two comparisons that are both the right way round',
            detail:
              '"Show what it changed" runs against the entry\'s own first parent and folds in the untracked files a `-u` stash keeps in a third parent that no tree diff can reach. "Compare with working tree" cannot reach them and therefore excludes untracked on both sides, and says so in the header. The one previous way to look inside compared the entry against whatever HEAD is now, and backwards — so it mixed the stashed work with everything that had landed since and drew it as deletions.',
          },
          {
            title: 'pgit arrives with the app',
            detail:
              'The command-line launcher only ever appeared if you found Settings → Command line and clicked Install — and on macOS that usually failed, because `/usr/local/bin` needs root. The Linux `.deb` now ships `/usr/bin/pgit` and the Windows `.msi` installs a `pgit` command and puts its directory on your PATH, both as ordinary package contents, so removing the app removes them too.',
          },
          {
            title: 'The in-app install got better anyway',
            detail:
              'On macOS it walks an ordered list of directories and takes the first one it can actually write, so root is an edge case rather than the normal path; if that directory is not somewhere your shell looks, it tells you, with the line that fixes it, rather than reporting a successful install of something you cannot run. On Windows it is real — a per-user directory plus a per-user PATH entry.',
          },
          {
            title: 'A pgit that is not ours is named and left alone',
            detail:
              'One your package manager installed is never overwritten and never offered for overwrite: Settings names where it came from and shows no button at all.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Every backend failure reached the log file as [object Object]',
            detail:
              'An error crossing from Rust is a plain kind-and-message object rather than a JavaScript `Error`, so stringifying it threw the reason away, and a Linux bug report arrived as a burst of identical opaque ERROR lines with nothing in them to diagnose. A log line now leads with the error kind, which is the half you grep for, while a banner still never shows an enum\'s spelling.',
          },
          {
            title: 'Two failures nobody could see',
            detail:
              'A failed Apply in the merge resolver showed the user `[object Object]`, and the chooser\'s "Keep our version" / "Take theirs" — the resolver\'s fallback for a binary or deleted-side conflict — reported nothing at all, so a failure looked exactly like a button that does nothing.',
          },
          {
            title: 'Unhandled render errors reach the log file',
            detail:
              'With their component stack. They existed only in a devtools console that a reporting user never opens.',
          },
          {
            title: 'Clicking an ordinary submodule row cost three errors',
            detail:
              'A gitlink names a commit in the submodule\'s own object database and all three file readers looked for it in the wrong one. "There is no text at this path" is an answer now rather than a failure — for a submodule, for a directory, and for the side a diff legitimately does not have, since an added file has no old version and a deleted one has no new version.',
          },
          {
            title: 'A swallowed error took the credential prompt with it',
            detail:
              'An error the log formatter itself could not read used to replace the failure it was reporting, taking with it the one detail that raises a credential prompt: a fetch against a private remote then simply failed instead of asking for a password.',
          },
        ],
      },
      {
        title: 'Known limitations',
        items: [
          {
            title: 'Hunk-level stash is deliberately not here',
            detail:
              'The composition it needs rewrites and restores your index around a subprocess, and an interruption in that window would leave the selection as your index with no other copy of the staged work anywhere. There is no half-built affordance for it either.',
          },
          {
            title: 'Two channels still install pgit from Settings',
            detail:
              'The Homebrew cask does not carry the command yet, and a `.dmg` drag-install runs no code while an AppImage is never installed. Settings → Command line, or `scripts/install-pgit.sh` from the repository, remains the route for those.',
          },
          {
            title: 'The Linux freeze that report opened with is not fixed',
            detail:
              'It was never reproduced, the evidence points at a GTK popup on Wayland, and it stays open.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.11',
    date: '2026-08-17',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Branch compare — what is on that branch and not on this one',
            detail:
              'Right-click any branch, local or remote, and compare it with the current branch, with the working tree, or with another branch you marked earlier; the command palette has the same entries. You get the ahead/behind counts and the merge base, both commit lists, and the combined file diff rendered by the same pipeline every other diff surface uses — so word highlighting, syntax and `F7` come along. Either side can be changed or swapped without leaving the view.',
          },
          {
            title: 'The working tree is a right-hand side only',
            detail:
              'It is not a commit, so there is nothing to count or walk, and the summary and the two commit lists are absent rather than shown as zero. Untracked files count as additions — hiding a file you just wrote is the one case the view exists for — and if there are too many of them the untracked side is dropped whole and says how many, instead of truncating quietly. The diff also says out loud that it is a tree-against-tree comparison, so files that exist only on the base side reading as deletions is stated rather than discovered.',
          },
          {
            title: 'Signed tags',
            detail:
              'Annotated tags can be signed with GPG or SSH, through the same key resolution commit signing has used since 0.0.8: `tag.gpgsign` sets the default and any tag can override it. Creating a tag is one dialog now — name, annotation, sign — replacing three separate single-value prompts. The sign box has a third state meaning "follow the git config", because a plain unchecked box would claim a tag is unsigned in a repository that signs everything; and signing needs an annotation, since a lightweight tag is a reference with no object to sign. A signing failure creates no tag at all.',
          },
          {
            title: 'A tag verdict worth trusting',
            detail:
              'Signed tags are marked in the Branches list, and the selected tag carries a graded badge: Signed, Bad signature, or "Signed, key unavailable" for a signature from a key outside your `allowedSignersFile` — which is not the same thing as verified.',
          },
          {
            title: 'Branch lists in an order worth reading',
            detail:
              'Every list of branches — the titlebar picker, the Branches screen, `⌘P` — showed git\'s own ref order, which is alphabetical: `chore/bump-deps` above `main`, and a branch you touched five minutes ago below one abandoned last year. The default branch now pins to the top and everything else falls in recency order, newest commit first; remote branches get the same treatment within their own section. The default is git\'s own answer, `origin/HEAD`, falling back to whichever of `main`, `master` or `trunk` exists — deliberately not `init.defaultBranch`, which describes branches that do not exist yet.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Annotated tags were unreachable from the commit menu and the palette',
            detail:
              'Both paths passed no annotation, so creating a tag from either could only ever produce a lightweight one.',
          },
          {
            title: '"Compare with current" could silently no-op',
            detail:
              'The remote-branch menu resolved both tips itself and did nothing at all when either was missing. It is the ref-named compare now, which cannot.',
          },
          {
            title: 'The branch picker\'s keyboard cursor ignored the filter',
            detail:
              'It survived a change of query instead of following the filtered list. Filtering still beats pinning, so a query that excludes the default branch does not resurrect it, and the cursor now rests on the current branch — the one row where a stray Enter does nothing at all.',
          },
          {
            title: '"Create tag here" is hidden in an empty repository',
            detail: 'Rather than offered and then refused.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.10',
    date: '2026-08-16',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Several repositories open at once',
            detail:
              'Repositories are tabs now, on their own strip below the titlebar: open as many as you like, each with its own screen, its own dirty and conflict badges, and a right-click menu to close one, the others, or all. Colliding names are disambiguated by their parent directory. `⌘E` opens a switcher, `⌥1`–`⌥9` jump straight to a tab, `Ctrl+Tab` cycles, `⌘W` closes. Your open set is restored on the next launch, and lazily — five persisted repositories cost one open, not five.',
          },
          {
            title: 'Pull requests and merge requests, GitHub and GitLab',
            detail:
              'A new Pulls screen lists the open requests for whichever forge your remote points at — number, title, author, source → target, draft and fork markers — with the CI/checks summary for the selected one. Open it in the browser, check it out locally (forks included, via the ref the forge publishes on the base repository), or create one from the current branch with a title, body, target and draft flag. Self-hosted GitHub Enterprise and GitLab work the same way. The API token is per host, entered in Settings → Integrations, and handed to your own git credential helper under a key that cannot collide with the credential you push with.',
          },
          {
            title: 'Submodules get a screen',
            detail:
              'Init, update (recursively if you want), sync URLs, or open one as its own repository — and they are told apart from merely embedded repositories in the file tree.',
          },
          {
            title: 'Linked worktrees get a screen',
            detail:
              'Add on a new or existing branch, lock with a reason, remove, prune. Removing one that holds uncommitted work asks a second time before it will force.',
          },
          {
            title: 'git-LFS on the Remote screen',
            detail:
              'Fetch objects, pull objects, checkout — and an LFS pointer now renders as the object it stands for rather than as a two-line text diff.',
          },
          {
            title: 'Bisect in the operation bar',
            detail:
              'Good / Bad / Skip / Reset and git\'s own "N revisions left, ~M steps" estimate — including a bisect you started in a terminal, since git\'s files are the only record either of you reads.',
          },
          {
            title: 'Drag and drop where it earns its place',
            detail:
              'Drag files between Changes and Staged (both directions, tree or flat view); drag a ref or commit onto another in the graph to merge, rebase or cherry-pick, each behind a confirmation naming what it will do; drag rebase steps to reorder them. Illegal drops are refused with the reason on the cursor rather than silently ignored. Every gesture has a keyboard equivalent — reordering gained `Mod+Shift+↑/↓`, which it never had.',
          },
          {
            title: 'Space stages the focused diff line',
            detail:
              'The diff pane gained a line cursor beside the existing `F7` hunk cursor: arrow to a changed line, `Space` stages or unstages it — the same rule the checkbox follows, and switched off in exactly the cases the mouse is.',
          },
          {
            title: 'A HEAD indicator you can actually configure',
            detail:
              'The old four-value list had to name every combination; it is now six independent marks — edge bar, row tint, outline, HEAD badge, bold subject, graph ring — at subtle, strong or intense, with a live preview in Settings built from the real History row so it cannot drift from what you get. Existing settings are migrated to the nearest equivalent.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'Whole-file diffs, by default, on every diff surface',
            detail:
              'A change is easier to judge with the rest of the file around it, so the whole file is what you see — while each change block keeps its own Stage and Discard, so nothing about staging gets coarser. Chunked context remains a setting.',
          },
          {
            title: 'Inline vs. split is a real persisted preference',
            detail:
              'Instead of resetting on every navigation. The changed-word tint is stronger and calibrated per theme mode.',
          },
          {
            title: 'Highlighting moved off the main thread',
            detail:
              'Syntax tokenizing runs in a worker and returns packed token data, so clicking quickly between files no longer janks on the file you just left, and a commit warms its other files in the background. If the worker cannot start, it falls back to the old path rather than losing colour.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Tag pushes and remote-branch deletes ran without credentials',
            detail:
              'Against a private remote they simply failed with git\'s stderr and no way to answer. Both now prompt and retry like every other network operation, and neither can any longer be talked into running a program named by a crafted branch or remote name.',
          },
          {
            title: 'Every repository you opened stayed open behind your back',
            detail:
              'For the life of the process, leaking its handles. Closing a tab now closes it for real.',
          },
          {
            title: 'On Linux the bottom of a long diff could render blank',
          },
          {
            title: 'Dragging a rebase step reordered plans that could not be reordered',
            detail: 'The buttons correctly said so; the drag did not listen.',
          },
          {
            title: 'The Files screen\'s Unstage drop target did nothing at all',
          },
          {
            title: 'Checking out a pull request misread every existing branch as absent',
            detail:
              'So a name collision surfaced as git\'s own failure instead of a question.',
          },
          {
            title: 'History\'s "Mine" scope was a guess at your email',
            detail:
              'It filtered nothing on your own repositories and someone else\'s commits on everyone else\'s. It is gone; the real author filter is in advanced search.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.9',
    date: '2026-08-14',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Syntax highlighting on every code surface',
            detail:
              'The unified diff, split view, the inline commit diff, blame, the file preview, the repo browser\'s diff pane and all three panes of the merge resolver. Word-level highlighting inside a changed line composes with it rather than fighting it, and each theme carries its own syntax palette, so light themes are calibrated for a light canvas and switching mode never re-tokenizes.',
          },
          {
            title: 'Conflicts are a state the app announces, not a tab you visit',
            detail:
              'Whenever a merge, rebase or cherry-pick is in progress, a bar under the titlebar names the operation and branch, counts what is left, shows the rebase step, and offers one verb — Resolve conflicts, then Finalize or Continue — plus a confirmed Abort. The old Conflicts screen is gone; the resolver window gained a conflicted-file sidebar and now asks before you leave a file with unapplied work.',
          },
          {
            title: 'Interactive rebase understands merge commits',
            detail:
              'A merge in range used to fail partway through and leave the branch half-rewritten. Now the plan is validated before the repository is touched, and merge rows are badged with a warning strip saying what will happen. Flatten (the default, and git\'s own) drops the merge and replays its side branch linearly, or keeps it as one ordinary commit; Preserve recreates the merges — the equivalent of `git rebase --rebase-merges` — and states its limitations up front.',
          },
          {
            title: 'A rebase survives quitting the app',
            detail:
              'The replay runs on a detached HEAD and the branch moves exactly once, on completion, with the operation mirrored to disk and `ORIG_HEAD` re-asserted at every step — so Continue and Abort still work after a restart, and `git reset --hard ORIG_HEAD` remains a real escape hatch.',
          },
          {
            title: 'Squash and fixup run from History, in place',
            detail:
              'With a prefilled, editable message built from every commit being squashed; no detour through the plan screen. The rebase plan reorders by drag.',
          },
          {
            title: 'History scope that means something',
            detail:
              'All / Mine walk every branch, This branch walks HEAD, replacing a client-side approximation.',
          },
          {
            title: 'UI zoom on ⌘= / ⌘- / ⌘0',
            detail: 'Persisted across launches.',
          },
          {
            title: 'A customizable "you are here" HEAD indicator',
            detail: 'Edge bar, row highlight, both, or graph marker only.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'Large diffs stay responsive',
            detail:
              'Diff rows are windowed, so opening a thousand-line file mounts a screenful instead of the whole thing. `F7` hunk navigation scrolls by computed offset, so it still reaches a hunk that is not mounted yet.',
          },
          {
            title: 'Entering a screen focuses its main pane',
            detail:
              'So the first keystroke lands where you are looking. The app now opens on History.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'A .deb install would have been handed an AppImage as its update payload',
            detail:
              'Once Linux self-update opens up. The update panel now explains itself to `.deb` users instead of dead-ending.',
          },
          {
            title: 'Continue and abort work for a rebase git owns on disk',
            detail:
              'Which previously abandoned queued steps or left you detached mid-rebase.',
          },
          {
            title: 'A branch tip was truncated to seven characters',
            detail:
              'So the HEAD marker never drew and the ancestry filter silently matched nothing.',
          },
          {
            title: 'Squashing two commits could produce three',
            detail:
              'Rebase operations read the displayed log rather than HEAD\'s ancestry.',
          },
          {
            title: 'The split view\'s two columns drifted apart',
            detail: 'On any hunk mixing removals and additions.',
          },
          {
            title: 'Re-selecting the current screen stranded keyboard focus',
          },
          {
            title: 'The shell no longer side-scrolls',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.8',
    date: '2026-08-14',
    status: 'feature',
    summary:
      'A large release. The fixes below come from a full review of everything since 0.0.7.',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'In-app updates',
            detail:
              'Windows `.msi` and Linux `.AppImage` installs now download, verify and install updates in place, then relaunch. macOS and `.deb` are notify-only: they point at the release or `brew upgrade` rather than stepping on a package manager\'s bookkeeping.',
          },
          {
            title: 'Clone and create repositories',
            detail:
              'Clone from a URL with live progress, or initialise a new repository, from the Welcome screen, the command palette, or `⌘⇧O` / `⌘⇧N`.',
          },
          {
            title: 'Authenticated remotes',
            detail:
              'Fetch, pull, push and clone against private remotes. The first attempt stays prompt-less so an existing credential helper or SSH agent simply answers; only if that fails are you asked, and the operation is retried. "Remember" hands the credential to your own git credential helper, and only once it has actually worked.',
          },
          {
            title: 'Line-level staging',
            detail:
              'Click or shift-click individual lines in a hunk and stage, unstage or discard just those. Plus word-level highlighting within a changed line, tri-state staging checkboxes on files and folders in the tree, and an ignore-whitespace toggle on every diff surface.',
          },
          {
            title: 'Commit signing',
            detail:
              'Sign commits with GPG or SSH and see a verification badge on signed commits. The commit box is now a single field (subject and body, the shape git stores), Amend loads the previous message, and you can override the author or add `Co-Authored-By` trailers.',
          },
          {
            title: 'History upgrades',
            detail:
              'An inline commit diff that opens in place without switching screens, multi-select for a combined diff / squash / cherry-pick, and content search (`content:` / `contains:`) alongside author, path, date and SHA filters.',
          },
          {
            title: 'Editable branch tracking',
            detail:
              'Set or change a branch\'s upstream from the Branches inspector or its context menu; a first push of an untracked branch establishes tracking instead of leaving it dangling.',
          },
        ],
      },
      {
        title: 'Improvements',
        items: [
          {
            title: 'Rewritten commit graph',
            detail:
              'Proper lane colouring, crossing edges, a HEAD marker and accessible labelling. History pages in as you scroll, and both the log and the file tree are virtualized, so large repositories stay responsive.',
          },
          {
            title: 'Polish',
            detail:
              'Light themes are properly calibrated (diff colours, graph lanes, pills and shadows no longer keep a dark calibration over a light canvas), per-file-type icons throughout, in-app dialogs with real danger styling and type-the-name confirmation for destructive actions, bundled Inter + JetBrains Mono, loading skeletons, and find-in-tree with `⌘⇧F`.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Repositories on a Windows drive under WSL (/mnt/c/…) open',
            detail:
              'They tripped git\'s dubious-ownership check and refused outright; you now get an explanation and a one-click way to trust the path.',
          },
          {
            title: 'Discarding a conflicted file deleted it instead of restoring the conflict',
          },
          {
            title: 'Pull with auto-stash could strand your uncommitted work',
            detail: 'In a stash it never popped or mentioned.',
          },
          {
            title: 'Staging part of a file could then stage the wrong lines',
            detail: 'Because the diff pane kept showing the pre-stage version.',
          },
          {
            title: 'Whole branch lanes could vanish from the paginated log',
          },
          {
            title: 'Staging a hunk or lines of a brand-new file failed outright',
          },
          {
            title: 'The commit summary counted unstaged edits toward the commit',
          },
          {
            title: 'Discarding an untracked file silently did nothing',
          },
          {
            title: 'UI density skipped some row surfaces',
          },
          {
            title: 'A signed commit with an expired key read as unsigned',
          },
          {
            title: 'Embedded repositories are detected as data, not guessed from the path',
            detail:
              'And they stay out of batch operations that would write an unresolvable gitlink.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.7',
    date: '2026-07-08',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Rider-style merge conflict resolver',
            detail:
              'A dedicated resolver window with a three-pane diff3 layout (ours · editable result · theirs). Accept ours / theirs / both per conflict from the gutter or the keyboard — `F7` / `⇧F7` to navigate, `⌘1/2/3` to pick, `⌘↵` to apply and auto-advance through conflicted files. Manual edits and CRLF are preserved, with a chooser for binary and deleted-side conflicts. Open it from the Conflict screen.',
          },
          {
            title: 'App logo on the Welcome screen and titlebar',
            detail:
              'With themeable logo colors — every built-in theme carries its own logo palette, and the theme editor exposes the head and bill fills.',
          },
          {
            title: 'Branded macOS installer',
            detail:
              'The `.dmg` now opens to a classic drag-to-Applications layout with artwork styled to match the site.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'The branch/ref picker scrolls within the popover',
            detail: 'Instead of overflowing the viewport.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.6',
    date: '2026-07-07',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Keyboard navigation',
            detail:
              'A full keymap system with a Rider-style default (Classic preset available), type-to-jump speed-search, commit chords, `F7` / `⇧F7` hunk navigation, spatial `Alt+Arrow` pane focus, and a `?` cheat sheet.',
          },
          {
            title: 'pgit command-line launcher',
            detail:
              'Open a repo from the terminal with `pgit [subcommand] [path]`; it forwards into a running instance, and the shim is installable from Settings.',
          },
          {
            title: 'Ref-scoped history',
            detail:
              'Browse the commit log of any branch, tag or revspec and cherry-pick from unmerged refs, via the History ref selector.',
          },
          {
            title: 'Command palette upgrades',
            detail:
              'An actions catalog, frecency ranking, drill-in steps, and type-filter chips (`⌘P` / `Ctrl+P`).',
          },
          {
            title: 'Multi-file selection',
            detail:
              'Select several files in the commit panel or repo browser and stage / unstage / discard them from the context menu.',
          },
          {
            title: 'Settings',
            detail:
              'Configurable diff context lines and UI density; non-functional toggles removed.',
          },
        ],
      },
      {
        title: 'Fixes',
        items: [
          {
            title: 'Interactive-rebase conflict resume now completes',
            detail: 'And aborting no longer discards a resolved commit.',
          },
          {
            title: 'The palette\'s type chips run the highlighted row',
          },
          {
            title: 'Palette Pull honours your pull-mode setting and tracking branch',
          },
          {
            title: 'The commit shortcut no longer double-commits on key-repeat',
          },
          {
            title: 'History selection resets when a filter shrinks the list',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.5',
    date: '2026-07-01',
    status: 'build',
    sections: [
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'Windows .msi now builds',
            detail:
              'Added an `.ico` to the icon set so the Windows bundler stops failing.',
          },
          {
            title: 'Multi-platform release assets',
            detail:
              'macOS universal `.dmg`, Windows x64 `.msi`, Linux amd64 `.deb` and `.AppImage`.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.4',
    date: '2026-07-01',
    status: 'build',
    sections: [
      {
        title: 'Build & packaging',
        items: [
          {
            title: 'First release built for all three platforms via CI',
            detail: 'macOS `.dmg`, Windows `.msi`, Linux `.deb` and `.AppImage`.',
          },
          {
            title: 'Validates the Windows and Linux build jobs',
            detail:
              'Assets attach automatically once the release workflow completes.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.3',
    date: '2026-06-30',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Recent commit messages',
            detail:
              'A "Recent" button in the commit panel refills the message from your recent commit subjects and bodies — newest-first, de-duplicated, skipping merges.',
          },
          {
            title: 'Sign-off (-s) toggle',
            detail:
              'Appends a `Signed-off-by` trailer from your committer identity with full `git commit -s` semantics: idempotent, correct blank-line separation, git-accurate trailer-key rule. Applied on normal and amend commits; the preference persists and stays in sync with Settings.',
          },
          {
            title: 'Browse the repo tree at any revision',
            detail:
              'Type a revspec (SHA, branch, tag, `HEAD~2`, …) or quick-pick a branch or tag to list the full file tree and view file contents as they were then, with syntax highlighting and binary-blob handling.',
          },
          {
            title: 'Commit and log search in History',
            detail:
              'Filter by message, author, SHA prefix, date range and path, with free-text qualifiers (`author:` / `path:` / `sha:` / `since:` / `until:` / `message:`). Backend-filtered over a revwalk; results render through the commit graph.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.2',
    date: '2026-06-30',
    status: 'feature',
    sections: [
      {
        title: 'New features',
        items: [
          {
            title: 'Command palette / fuzzy finder',
            detail:
              'Open with `⌘P` / `Ctrl+P` to jump to any branch, file, recent commit, or app command from one overlay.',
          },
          {
            title: 'Fuzzy matching that ranks the right things',
            detail:
              'Consecutive runs, word boundaries and camelCase, with keyboard-first navigation (↑/↓, Enter), match highlighting and a trapped focus ring.',
          },
          {
            title: 'Selecting a result acts on it',
            detail:
              'Branches check out, files open in the diff view, commits show their diff, commands switch screens.',
          },
        ],
      },
    ],
  },
  {
    version: '0.0.1',
    date: '2026-06-30',
    status: 'initial release',
    summary:
      'First public release of platypusgit — a dev-first git desktop app built with Tauri 2 + React.',
    sections: [
      {
        title: 'What shipped',
        items: [
          {
            title: 'Staging',
            detail:
              'Stage / unstage / discard whole files and individual hunks; commit with amend and author override.',
          },
          {
            title: 'Diff & viewing',
            detail:
              'Worktree / index / HEAD diffs, commit-to-commit diffs, line-by-line blame, and a repo file browser at HEAD.',
          },
          {
            title: 'Branches & tags',
            detail:
              'List / create / checkout / rename / delete branches; lightweight and annotated tags; push and delete tags.',
          },
          {
            title: 'History',
            detail:
              'Commit graph layout, per-file history, reflog viewer, detached-HEAD checkout.',
          },
          {
            title: 'History manipulation',
            detail: 'Reset (soft / mixed / hard), cherry-pick, revert.',
          },
          {
            title: 'Stash',
            detail: 'Save / apply / pop / drop, and stash to a new branch.',
          },
          {
            title: 'Conflict resolution',
            detail:
              '3-way sides, accept ours / theirs, external mergetool, continue / abort.',
          },
          {
            title: 'Interactive rebase',
            detail:
              'Pick / reword / edit / squash / fixup / drop, continue / abort, and a rebase base picker.',
          },
          {
            title: 'Remotes & network',
            detail:
              'Add / remove / rename / prune remotes, fetch / pull / push (with-lease and force), merge branches.',
          },
          {
            title: 'App shell',
            detail:
              'Centralized branch UI — titlebar branch chip and popover picker — a native window titlebar with platform-aware window controls, and light / dark themes.',
          },
        ],
      },
      {
        title: 'Build & packaging',
        items: [
          { title: 'Universal macOS .dmg build published via CI' },
        ],
      },
    ],
  },
];
