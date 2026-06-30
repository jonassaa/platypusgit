// Hardcoded example repo for the app showcase component.
// Commits are newest-first (git log order); `parents` reference older oids.
// The graph layout engine turns these into lanes/nodes at build time.

export interface MockRef {
  name: string;
  tone: 'accent' | 'violet' | 'green' | 'amber' | 'red';
  remote?: string;
  active?: boolean;
  icon?: 'branch' | 'tag';
}

export interface MockCommitRow {
  oid: string;
  parents: string[];
  sha: string;
  message: string;
  author: string;
  date: string;
  refs?: MockRef[];
  tag?: string;
  fullSha?: string;
  email?: string;
  body?: string;
}

export const repoName = 'platypusgit';
export const repoPath = '/Users/jonas/dev/fun/platypusgit/';
export const headBranch = 'main';
export const aheadBehind = { ahead: 2, behind: 0 };
export const changedCount = 0;

export const emails: Record<string, string> = {
  'Jonas Aasberg': 'jonas.aasberg@clave.no',
  'Lena Fischer': 'lena.fischer@example.dev',
  'Tom Okafor': 'tom.okafor@example.dev',
  'Priya Nair': 'priya.nair@example.dev',
  'dependabot[bot]': '49699333+dependabot[bot]@users.noreply.github.com',
};

export const commits: MockCommitRow[] = [
  {
    oid: 'm9', parents: ['m8', 'sb2'], sha: 'a1f9c02',
    fullSha: 'a1f9c0250014e17ce9357c69a05c676673bc79f5c',
    message: "Merge branch 'feature/side-by-side-diff'",
    author: 'Jonas Aasberg', date: '2 min ago',
    email: 'jonas.aasberg@clave.no',
    body:
      'Brings the side-by-side diff view to main. Adds a toggle in the diff\n' +
      'header and word-level intra-line highlighting on top of the existing\n' +
      'inline renderer.',
    refs: [
      { name: 'HEAD → main', tone: 'accent', active: true, icon: 'flag' },
      { name: 'main', tone: 'accent', remote: 'origin', icon: 'branch' },
    ],
  },
  {
    oid: 'cp1', parents: ['m8'], sha: '7b3e418',
    message: 'wip: command palette fuzzy matcher',
    author: 'Priya Nair', date: '41 min ago',
    refs: [{ name: 'feature/command-palette', tone: 'violet', icon: 'branch' }],
  },
  {
    oid: 'm8', parents: ['m7'], sha: 'c0d5a9f',
    message: 'perf(graph): virtualize 50k-commit history',
    author: 'Jonas Aasberg', date: '3 hours ago',
  },
  {
    oid: 'sb2', parents: ['sb1'], sha: 'e42b7d1',
    message: 'feat(diff): word-level intra-line highlight',
    author: 'Lena Fischer', date: '5 hours ago',
  },
  {
    oid: 'm7', parents: ['m6'], sha: '9af1c34',
    message: 'fix(blame): follow renames across moves',
    author: 'Tom Okafor', date: '8 hours ago',
  },
  {
    oid: 'sb1', parents: ['m6'], sha: '2c8e6b0',
    message: 'feat(diff): side-by-side view toggle',
    author: 'Lena Fischer', date: '9 hours ago',
    refs: [{ name: 'feature/side-by-side-diff', tone: 'green', remote: 'origin', icon: 'branch' }],
  },
  {
    oid: 'm6', parents: ['m5', 'rb2'], sha: 'd71f8a3',
    message: 'Merge pull request #128 from feature/rebase-ui',
    author: 'Jonas Aasberg', date: '1 day ago',
    tag: 'v0.4.0',
  },
  {
    oid: 'm5', parents: ['m4'], sha: '4e9b210',
    message: 'refactor(store): split repo store by concern',
    author: 'Priya Nair', date: '1 day ago',
  },
  {
    oid: 'rb2', parents: ['rb1'], sha: 'f30c7e5',
    message: 'feat(rebase): drag-to-reorder todo steps',
    author: 'Tom Okafor', date: '2 days ago',
  },
  {
    oid: 'm4', parents: ['m3'], sha: 'b6a1d88',
    message: 'feat(stash): stash to a new branch',
    author: 'Jonas Aasberg', date: '2 days ago',
  },
  {
    oid: 'rb1', parents: ['m3'], sha: '8c24f60',
    message: 'feat(rebase): interactive plan editor',
    author: 'Tom Okafor', date: '3 days ago',
  },
  {
    oid: 'm3', parents: ['m2'], sha: '1d7e9a4',
    message: 'feat(remotes): push --force-with-lease',
    author: 'Jonas Aasberg', date: '4 days ago',
    refs: [{ name: 'release/0.3', tone: 'amber', remote: 'origin', icon: 'branch' }],
  },
  {
    oid: 'm2', parents: ['m1'], sha: '5fb0c13',
    message: 'test: libgit2 smoke coverage',
    author: 'dependabot[bot]', date: '5 days ago',
    tag: 'v0.3.0',
  },
  {
    oid: 'm1', parents: [], sha: '0a93e77',
    message: 'Initial commit',
    author: 'Jonas Aasberg', date: '6 days ago',
  },
];
