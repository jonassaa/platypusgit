// 9 hero feature areas (from README "Features")
export const heroFeatures = [
  { icon: 'git-commit', title: 'Staging & commit', blurb: 'Stage/unstage/discard files and individual hunks. Commit with amend + author override.' },
  { icon: 'diff', title: 'Diff & viewing', blurb: 'Worktree/index/HEAD diffs, commit-to-commit diffs, blame, repo browser.' },
  { icon: 'git-branch', title: 'Branches & tags', blurb: 'List/create/checkout/rename/delete branches. Lightweight + annotated tags.' },
  { icon: 'history', title: 'History', blurb: 'Commit graph, file history, reflog viewer, detached-HEAD checkout.' },
  { icon: 'rewind', title: 'History manipulation', blurb: 'Reset (soft/mixed/hard), cherry-pick, revert.' },
  { icon: 'archive', title: 'Stash', blurb: 'Save/apply/pop/drop, stash-to-branch.' },
  { icon: 'merge', title: 'Conflict resolution', blurb: '3-way sides, accept ours/theirs, external mergetool, continue/abort.' },
  { icon: 'list', title: 'Interactive rebase', blurb: 'Pick/reword/edit/squash/fixup/drop, continue/abort, base picker.' },
  { icon: 'cloud', title: 'Remotes & network', blurb: 'Add/remove/rename/prune remotes, fetch/pull/push (with-lease/force), merge.' },
];

// Full grouped list (from implemented-features.md)
export const featureGroups = [
  { title: 'Staging', blurb: 'Granular control over what goes into a commit.', items: [
    'Stage / unstage / discard whole files',
    'Stage / unstage / discard individual hunks',
    'Commit with amend and author override',
  ]},
  { title: 'Diff & viewing', blurb: 'See exactly what changed, anywhere.', items: [
    'Worktree / index / HEAD diffs',
    'Commit-to-commit diffs',
    'Line-by-line blame',
    'Repo file browser at HEAD',
  ]},
  { title: 'Branches & tags', blurb: 'Full ref management.', items: [
    'List / create / checkout / rename / delete branches',
    'Lightweight and annotated tags',
    'Push and delete tags',
  ]},
  { title: 'History', blurb: 'Navigate the past.', items: [
    'Commit graph layout',
    'Per-file history',
    'Reflog viewer',
    'Detached-HEAD checkout',
  ]},
  { title: 'History manipulation', blurb: 'Rewrite with care.', items: [
    'Reset — soft / mixed / hard',
    'Cherry-pick',
    'Revert',
  ]},
  { title: 'Stash', blurb: 'Park work in progress.', items: [
    'Save / apply / pop / drop',
    'Stash to new branch',
  ]},
  { title: 'Conflict resolution', blurb: 'Resolve merges without leaving the app.', items: [
    '3-way conflict sides',
    'Accept ours / theirs',
    'External mergetool launch',
    'Continue / abort operation',
  ]},
  { title: 'Interactive rebase', blurb: 'Reshape history visually.', items: [
    'Pick / reword / edit / squash / fixup / drop',
    'Continue / abort',
    'Rebase base picker',
  ]},
  { title: 'Remotes & network', blurb: 'Sync with anywhere.', items: [
    'Add / remove / rename / prune remotes',
    'Fetch / fetch-all / pull',
    'Push with-lease and force',
    'Merge branches',
  ]},
];

// Roadmap teaser (from features.md P0/P1 — clearly "planned")
export const roadmap = [
  'Commit/log search — filter by message, author, SHA, date, path',
  'Side-by-side diff view + intra-line highlighting',
  'Command palette / fuzzy finder (⌘P)',
  'Browse full repo file tree at any revision',
  'Branch compare — branch↔branch and branch↔working tree',
  'GPG/SSH commit + tag signing with verified badge',
  'Multi-repo tabs / fast recent-repo switcher',
];

export const changelog = [
  {
    version: '0.0.1',
    date: '2026-06-30',
    status: 'initial release',
    notes: [
      'First public release of platypusgit — a dev-first git desktop app built with Tauri 2 + React.',
      'Staging: stage / unstage / discard whole files and individual hunks; commit with amend and author override.',
      'Diff & viewing: worktree / index / HEAD diffs, commit-to-commit diffs, line-by-line blame, repo file browser at HEAD.',
      'Branches & tags: list / create / checkout / rename / delete branches; lightweight and annotated tags; push and delete tags.',
      'History: commit graph layout, per-file history, reflog viewer, detached-HEAD checkout.',
      'History manipulation: reset (soft / mixed / hard), cherry-pick, revert.',
      'Stash: save / apply / pop / drop, and stash to a new branch.',
      'Conflict resolution: 3-way sides, accept ours / theirs, external mergetool, continue / abort.',
      'Interactive rebase: pick / reword / edit / squash / fixup / drop, continue / abort, rebase base picker.',
      'Remotes & network: add / remove / rename / prune remotes, fetch / pull / push (with-lease and force), merge branches.',
      'Centralized branch UI — titlebar branch chip + popover picker.',
      'Native window titlebar with platform-aware window controls; light / dark theme.',
      'Universal macOS .dmg build published via CI.',
    ],
  },
];
