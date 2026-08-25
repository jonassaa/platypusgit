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
