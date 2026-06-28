# platypusgit Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Astro static site under `site/` that markets platypusgit (hero, features, download, changelog), matches the app's visual language, and auto-deploys to GitHub Pages.

**Architecture:** Astro 5 static-output site in `site/` subdir with its own pnpm workspace. Design tokens ported from the app's `src/index.css`. Four pages built from shared layout + components. A central `site.ts` holds all external links. A GitHub Action builds and deploys to Pages on push.

**Tech Stack:** Astro 5, TypeScript, pnpm, Node 22, plain CSS (ported tokens — no Tailwind in the site), GitHub Actions (`actions/deploy-pages`).

## Global Constraints

- Package manager: **pnpm** only. Node 22. Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before pnpm in this environment.
- Site lives entirely in `site/` with its own `package.json` / lockfile — must NOT touch the app's root `package.json` or pull app deps.
- Astro config: `site: 'https://jonassaa.github.io'`, `base: '/platypusgit'`. All internal links/assets use Astro's `import.meta.env.BASE_URL` or relative resolution so they work under the subpath.
- Repo URL: `https://github.com/jonassaa/platypusgit`. License: `GPL-3.0-only`.
- Buy Me a Coffee URL is a placeholder: `https://buymeacoffee.com/REPLACE_ME` — only ever set in `src/data/site.ts`.
- Brand colors: teal `#3E9B91`, amber `#E6A95A`. Dark theme default. Fonts: JetBrains Mono (display/code) + Inter (body), self-hosted.
- No external CDN requests at runtime (fonts self-hosted). Shields.io badge `<img>` is allowed (static image).
- Verification per task: `pnpm build` (in `site/`) exits 0. Where noted, also `pnpm preview` and visual check.

---

### Task 1: Scaffold Astro project in `site/`

**Files:**
- Create: `site/package.json`
- Create: `site/pnpm-lock.yaml` (generated)
- Create: `site/astro.config.mjs`
- Create: `site/tsconfig.json`
- Create: `site/.gitignore`
- Create: `site/src/pages/index.astro` (temporary placeholder)
- Modify: root `.gitignore` (ignore `site/node_modules`, `site/dist`)

**Interfaces:**
- Produces: a buildable Astro project. Build output at `site/dist/`. Dev server via `pnpm --dir site dev`.

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "platypusgit-site",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `site/astro.config.mjs`**

```js
// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jonassaa.github.io',
  base: '/platypusgit',
  trailingSlash: 'ignore',
});
```

- [ ] **Step 3: Create `site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Create `site/.gitignore`**

```
node_modules
dist
.astro
*.local
```

- [ ] **Step 5: Add a temporary placeholder page `site/src/pages/index.astro`**

```astro
---
---
<html lang="en">
  <head><meta charset="utf-8" /><title>platypusgit</title></head>
  <body><h1>platypusgit</h1></body>
</html>
```

- [ ] **Step 6: Add site output dirs to root `.gitignore`**

Append to root `.gitignore`:

```
# marketing site
site/node_modules
site/dist
site/.astro
```

- [ ] **Step 7: Install and build**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm install && pnpm build
```
Expected: install succeeds (generates `site/pnpm-lock.yaml`), build exits 0, `site/dist/index.html` exists.

- [ ] **Step 8: Commit**

```bash
git add site/package.json site/pnpm-lock.yaml site/astro.config.mjs site/tsconfig.json site/.gitignore site/src/pages/index.astro .gitignore
git commit -m "chore(site): scaffold astro project for marketing site"
```

---

### Task 2: Port design tokens + base styles

**Files:**
- Create: `site/src/styles/tokens.css`
- Create: `site/public/fonts/` (woff2 files — see step 2)

**Interfaces:**
- Produces: CSS custom properties consumed by every component:
  `--bg-0..4`, `--bg-titlebar`, `--fg-0..4`, `--border-0..2`, `--accent` (teal),
  `--accent-2` (amber), `--git-added`, `--git-removed`, `--git-modified`,
  `--font-sans`, `--font-mono`, `--font-display`, spacing `--s-1..11`,
  radius `--r-1..6`, shadows `--shadow-1..3`, transitions `--t-fast/med/slow`.
  Light overrides under `[data-theme-mode="light"]`.

- [ ] **Step 1: Create `site/src/styles/tokens.css`**

Port the `:root` block from the app (`src/index.css` lines 9–128), adapting accents to brand and adding a light palette + base element styles. Full content:

```css
:root {
  --font-sans: "Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, "Menlo", Consolas, monospace;
  --font-display: "JetBrains Mono", "SF Mono", ui-monospace, monospace;

  --s-1: 2px;  --s-2: 4px;  --s-3: 6px;  --s-4: 8px;  --s-5: 12px;
  --s-6: 16px; --s-7: 20px; --s-8: 24px; --s-9: 32px; --s-10: 40px; --s-11: 56px;
  --s-12: 80px; --s-13: 120px;

  --r-1: 2px; --r-2: 3px; --r-3: 4px; --r-4: 6px; --r-5: 8px; --r-6: 12px; --r-7: 16px;

  /* dark palette (default) */
  --bg-0: oklch(0.17 0.008 260);
  --bg-1: oklch(0.195 0.008 260);
  --bg-2: oklch(0.22 0.008 260);
  --bg-3: oklch(0.255 0.008 260);
  --bg-4: oklch(0.30 0.008 260);
  --bg-titlebar: oklch(0.21 0.008 260);

  --fg-0: oklch(0.96 0.005 260);
  --fg-1: oklch(0.82 0.005 260);
  --fg-2: oklch(0.65 0.008 260);
  --fg-3: oklch(0.48 0.008 260);
  --fg-4: oklch(0.38 0.008 260);

  --border-0: oklch(0.27 0.008 260);
  --border-1: oklch(0.33 0.008 260);
  --border-2: oklch(0.42 0.008 260);

  /* brand accents */
  --accent: oklch(0.68 0.09 185);      /* teal #3E9B91-ish */
  --accent-ink: oklch(0.15 0.02 185);
  --accent-2: oklch(0.78 0.12 75);     /* amber #E6A95A-ish */

  --git-added: oklch(0.72 0.15 155);
  --git-added-bg: oklch(0.35 0.08 155 / 0.25);
  --git-removed: oklch(0.68 0.18 25);
  --git-removed-bg: oklch(0.35 0.10 25 / 0.25);
  --git-modified: oklch(0.75 0.14 75);

  --shadow-1: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-2: 0 4px 12px rgba(0,0,0,0.35);
  --shadow-3: 0 12px 40px rgba(0,0,0,0.5);

  --t-fast: 80ms cubic-bezier(0.4, 0, 0.2, 1);
  --t-med: 160ms cubic-bezier(0.4, 0, 0.2, 1);
  --t-slow: 240ms cubic-bezier(0.4, 0, 0.2, 1);

  --maxw: 1080px;
}

[data-theme-mode="light"] {
  --bg-0: oklch(0.99 0.003 260);
  --bg-1: oklch(0.97 0.004 260);
  --bg-2: oklch(0.94 0.005 260);
  --bg-3: oklch(0.90 0.006 260);
  --bg-4: oklch(0.86 0.007 260);
  --bg-titlebar: oklch(0.96 0.004 260);
  --fg-0: oklch(0.20 0.01 260);
  --fg-1: oklch(0.32 0.01 260);
  --fg-2: oklch(0.45 0.01 260);
  --fg-3: oklch(0.58 0.01 260);
  --fg-4: oklch(0.68 0.01 260);
  --border-0: oklch(0.88 0.006 260);
  --border-1: oklch(0.82 0.007 260);
  --border-2: oklch(0.74 0.008 260);
  --shadow-1: 0 1px 2px rgba(0,0,0,0.08);
  --shadow-2: 0 4px 12px rgba(0,0,0,0.10);
  --shadow-3: 0 12px 40px rgba(0,0,0,0.14);
}

@font-face {
  font-family: "Inter"; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url("/platypusgit/fonts/inter-var.woff2") format("woff2");
}
@font-face {
  font-family: "JetBrains Mono"; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url("/platypusgit/fonts/jetbrains-mono-var.woff2") format("woff2");
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  color: var(--fg-0);
  background: var(--bg-0);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
h1, h2, h3 { font-family: var(--font-display); letter-spacing: -0.02em; line-height: 1.15; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: var(--font-mono); }
.container { max-width: var(--maxw); margin: 0 auto; padding: 0 var(--s-7); }
::selection { background: oklch(0.68 0.09 185 / 0.3); }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: var(--border-1); border-radius: 10px; border: 2px solid var(--bg-0); }
```

- [ ] **Step 2: Add self-hosted fonts**

Download the variable woff2 files and place them:
- `site/public/fonts/inter-var.woff2`
- `site/public/fonts/jetbrains-mono-var.woff2`

Commands:
```bash
mkdir -p site/public/fonts
curl -fsSL "https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2" -o site/public/fonts/inter-var.woff2
curl -fsSL "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/JetBrainsMono-Regular.woff2" -o site/public/fonts/jetbrains-mono-var.woff2
```
If a download fails (URL drift), substitute any current Inter/JetBrains Mono woff2 source; the `@font-face` `src` filename must match what lands in `public/fonts/`. The `font-weight: 400 700` range is correct only for a variable file — if you fall back to a static weight, set `font-weight: 400` and add a separate `@font-face` for the bold if needed. Verify both files are >10KB (not HTML error pages):
```bash
ls -l site/public/fonts/
```

- [ ] **Step 3: Build to confirm no CSS errors**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build
```
Expected: exits 0. (tokens.css not imported yet — no visual effect; just confirms the file parses when imported next task.)

- [ ] **Step 4: Commit**

```bash
git add site/src/styles/tokens.css site/public/fonts
git commit -m "feat(site): port design tokens and self-host fonts"
```

---

### Task 3: Central data — `site.ts` + `features.ts`

**Files:**
- Create: `site/src/data/site.ts`
- Create: `site/src/data/features.ts`

**Interfaces:**
- Produces:
  - `site` object: `{ name, tagline, description, repo, releases, releasesLatest, buyMeACoffee, license, author }` (all strings).
  - `nav` array: `{ label: string, href: string }[]`.
  - `featureGroups`: `{ title: string, blurb: string, items: string[] }[]`.
  - `heroFeatures`: `{ icon: string, title: string, blurb: string }[]` (the 9 README areas).
  - `platforms`: `{ os: string, ext: string, note: string }[]`.
  - `changelog`: `{ version: string, date: string, status: string, notes: string[] }[]`.

- [ ] **Step 1: Create `site/src/data/site.ts`**

```ts
export const site = {
  name: 'platypusgit',
  tagline: 'A dev-first git desktop app.',
  description:
    'Cross-platform, developer-focused git desktop app. Tauri 2 + React. A dev-first alternative to TortoiseGit with extreme usability as the north star.',
  repo: 'https://github.com/jonassaa/platypusgit',
  releases: 'https://github.com/jonassaa/platypusgit/releases',
  releasesLatest: 'https://github.com/jonassaa/platypusgit/releases/latest',
  buyMeACoffee: 'https://buymeacoffee.com/REPLACE_ME', // TODO: user supplies real URL
  license: 'GPL-3.0-only',
  author: 'Jonas Aasberg',
};

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const nav = [
  { label: 'Features', href: `${base}/features` },
  { label: 'Download', href: `${base}/download` },
  { label: 'Changelog', href: `${base}/changelog` },
];
```

- [ ] **Step 2: Create `site/src/data/features.ts`**

```ts
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

export const platforms = [
  { os: 'macOS', ext: '.dmg', note: 'Universal (Apple Silicon + Intel)' },
  { os: 'Windows', ext: '.msi', note: 'WebView2 (ships with Windows 11)' },
  { os: 'Linux', ext: '.deb / .AppImage', note: 'webkit2gtk 4.1' },
];

export const changelog = [
  {
    version: '0.1.0',
    date: 'Unreleased',
    status: 'active development',
    notes: [
      'Core git operations implemented end-to-end: staging, hunks, commit, diff, blame.',
      'Branches, tags, history, commit graph, reflog viewer.',
      'Stash, conflict resolution, interactive rebase.',
      'Remotes with fetch / pull / push, merge.',
      'Centralized branch UI — titlebar branch chip + popover picker.',
    ],
  },
];
```

- [ ] **Step 3: Build**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build
```
Expected: exits 0 (data files unused yet — TS compiles via Astro).

- [ ] **Step 4: Commit**

```bash
git add site/src/data
git commit -m "feat(site): add central site config and feature data"
```

---

### Task 4: Layout, Nav, Footer, ThemeToggle

**Files:**
- Create: `site/src/layouts/Layout.astro`
- Create: `site/src/components/Nav.astro`
- Create: `site/src/components/Footer.astro`
- Create: `site/src/components/ThemeToggle.astro`
- Create: `site/public/logo.svg` (copy of app logo)
- Create: `site/public/favicon.svg`

**Interfaces:**
- Consumes: `site`, `nav` from `src/data/site.ts`.
- Produces: `Layout.astro` accepting props `{ title: string, description?: string }` and a default slot. Wraps content with Nav + Footer, imports `tokens.css`, sets `<html data-theme-mode="dark">`, inlines the no-flash theme script.

- [ ] **Step 1: Copy the logo into the site**

```bash
cp src-tauri/icons/logo.svg site/public/logo.svg
cp src-tauri/icons/logo.svg site/public/favicon.svg
```

- [ ] **Step 2: Create `site/src/components/ThemeToggle.astro`**

```astro
---
---
<button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme" type="button">
  <span class="t-dark">◐</span>
</button>
<style>
  .theme-toggle {
    background: transparent; border: 1px solid var(--border-1); color: var(--fg-1);
    width: 32px; height: 32px; border-radius: var(--r-4); cursor: pointer;
    font-size: 15px; line-height: 1; transition: border-color var(--t-fast), color var(--t-fast);
  }
  .theme-toggle:hover { border-color: var(--border-2); color: var(--fg-0); }
</style>
<script>
  const btn = document.getElementById('theme-toggle');
  btn?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme-mode') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme-mode', next);
    try { localStorage.setItem('pg-site-theme', next); } catch {}
  });
</script>
```

- [ ] **Step 3: Create `site/src/components/Nav.astro`**

```astro
---
import { site, nav } from '../data/site.ts';
import ThemeToggle from './ThemeToggle.astro';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
---
<header class="nav">
  <div class="container nav-inner">
    <a class="brand" href={base + '/'}>
      <img src={base + '/logo.svg'} alt="" width="28" height="28" />
      <span class="brand-name mono">platypusgit</span>
    </a>
    <nav class="nav-links">
      {nav.map((n) => <a href={n.href}>{n.label}</a>)}
      <a href={site.repo} target="_blank" rel="noopener">GitHub</a>
      <a class="coffee" href={site.buyMeACoffee} target="_blank" rel="noopener">☕ Sponsor</a>
      <ThemeToggle />
    </nav>
  </div>
</header>
<style>
  .nav { position: sticky; top: 0; z-index: 50; background: color-mix(in oklab, var(--bg-titlebar) 88%, transparent);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-0); }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; height: 56px; }
  .brand { display: flex; align-items: center; gap: var(--s-3); color: var(--fg-0); }
  .brand:hover { text-decoration: none; }
  .brand-name { font-weight: 600; font-size: 15px; }
  .nav-links { display: flex; align-items: center; gap: var(--s-6); }
  .nav-links a { color: var(--fg-1); font-size: 14px; }
  .nav-links a:hover { color: var(--fg-0); text-decoration: none; }
  .coffee { border: 1px solid var(--border-1); padding: 5px 10px; border-radius: var(--r-4); }
  .coffee:hover { border-color: var(--accent); color: var(--accent) !important; }
  @media (max-width: 640px) { .nav-links { gap: var(--s-4); } .nav-links a:not(.coffee) { font-size: 13px; } }
</style>
```

- [ ] **Step 4: Create `site/src/components/Footer.astro`**

```astro
---
import { site } from '../data/site.ts';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const year = 2026;
---
<footer class="footer">
  <div class="container footer-inner">
    <div>
      <div class="mono footer-brand">platypusgit</div>
      <p class="footer-tag">{site.tagline}</p>
    </div>
    <div class="footer-cols">
      <div>
        <h4>Project</h4>
        <a href={site.repo} target="_blank" rel="noopener">GitHub</a>
        <a href={base + '/changelog'}>Changelog</a>
        <a href={site.repo + '/blob/main/LICENSE'} target="_blank" rel="noopener">License (GPLv3)</a>
      </div>
      <div>
        <h4>Get involved</h4>
        <a href={site.repo + '/issues'} target="_blank" rel="noopener">Issues</a>
        <a href={site.repo + '/blob/main/CONTRIBUTING.md'} target="_blank" rel="noopener">Contributing</a>
        <a href={site.buyMeACoffee} target="_blank" rel="noopener">☕ Sponsor</a>
      </div>
    </div>
  </div>
  <div class="container footer-legal">
    <span>© {year} {site.author}</span>
    <span>{site.license}</span>
  </div>
</footer>
<style>
  .footer { border-top: 1px solid var(--border-0); margin-top: var(--s-13); padding: var(--s-11) 0 var(--s-8); background: var(--bg-1); }
  .footer-inner { display: flex; justify-content: space-between; gap: var(--s-10); flex-wrap: wrap; }
  .footer-brand { font-weight: 600; font-size: 16px; color: var(--fg-0); }
  .footer-tag { color: var(--fg-2); font-size: 14px; margin: var(--s-2) 0 0; max-width: 260px; }
  .footer-cols { display: flex; gap: var(--s-10); }
  .footer-cols h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-3); margin: 0 0 var(--s-4); }
  .footer-cols a { display: block; color: var(--fg-1); font-size: 14px; margin-bottom: var(--s-3); }
  .footer-legal { display: flex; justify-content: space-between; margin-top: var(--s-9);
    padding-top: var(--s-6); border-top: 1px solid var(--border-0); color: var(--fg-3); font-size: 13px; }
</style>
```

- [ ] **Step 5: Create `site/src/layouts/Layout.astro`**

```astro
---
import '../styles/tokens.css';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import { site } from '../data/site.ts';

interface Props { title: string; description?: string; }
const { title, description = site.description } = Astro.props;
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
---
<!doctype html>
<html lang="en" data-theme-mode="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="icon" type="image/svg+xml" href={base + '/favicon.svg'} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:type" content="website" />
    <script is:inline>
      try {
        const t = localStorage.getItem('pg-site-theme');
        if (t) document.documentElement.setAttribute('data-theme-mode', t);
      } catch {}
    </script>
  </head>
  <body>
    <Nav />
    <main><slot /></main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 6: Update placeholder `index.astro` to use the layout**

Replace `site/src/pages/index.astro` with:

```astro
---
import Layout from '../layouts/Layout.astro';
import { site } from '../data/site.ts';
---
<Layout title={site.name + ' — ' + site.tagline}>
  <div class="container" style="padding-top: 80px;">
    <h1>platypusgit</h1>
    <p>{site.tagline}</p>
  </div>
</Layout>
```

- [ ] **Step 7: Build + preview, verify nav/footer render and theme toggle works**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build && pnpm preview &
```
Open `http://localhost:4321/platypusgit` (preview honors `base`). Verify: nav sticky with logo + links, footer renders, clicking ☐ toggles dark/light. Stop preview after.
Expected: build exits 0, page renders with chrome.

- [ ] **Step 8: Commit**

```bash
git add site/src/layouts site/src/components site/public/logo.svg site/public/favicon.svg site/src/pages/index.astro
git commit -m "feat(site): add layout, nav, footer, theme toggle"
```

---

### Task 5: Reusable components — CTAButton, FeatureCard, CodeBlock

**Files:**
- Create: `site/src/components/CTAButton.astro`
- Create: `site/src/components/FeatureCard.astro`
- Create: `site/src/components/CodeBlock.astro`

**Interfaces:**
- Consumes: nothing external.
- Produces:
  - `CTAButton.astro` props `{ href: string, variant?: 'primary' | 'secondary', external?: boolean }` + slot (label).
  - `FeatureCard.astro` props `{ title: string, blurb: string }` (icon rendered as a small monospace glyph badge — no icon lib).
  - `CodeBlock.astro` props `{ code: string, lang?: string }` rendering a `<pre>` with a copy button.

- [ ] **Step 1: Create `site/src/components/CTAButton.astro`**

```astro
---
interface Props { href: string; variant?: 'primary' | 'secondary'; external?: boolean; }
const { href, variant = 'primary', external = false } = Astro.props;
const rel = external ? 'noopener' : undefined;
const target = external ? '_blank' : undefined;
---
<a href={href} class={`cta cta-${variant}`} target={target} rel={rel}><slot /></a>
<style>
  .cta { display: inline-flex; align-items: center; gap: var(--s-3); padding: 10px 18px;
    border-radius: var(--r-5); font-weight: 600; font-size: 14px; font-family: var(--font-sans);
    transition: transform var(--t-fast), background var(--t-fast), border-color var(--t-fast); }
  .cta:hover { text-decoration: none; transform: translateY(-1px); }
  .cta-primary { background: var(--accent); color: var(--accent-ink); }
  .cta-primary:hover { background: color-mix(in oklab, var(--accent) 88%, white); }
  .cta-secondary { background: transparent; color: var(--fg-0); border: 1px solid var(--border-2); }
  .cta-secondary:hover { border-color: var(--accent); color: var(--accent); }
</style>
```

- [ ] **Step 2: Create `site/src/components/FeatureCard.astro`**

```astro
---
interface Props { title: string; blurb: string; }
const { title, blurb } = Astro.props;
---
<div class="fcard">
  <h3 class="fcard-title">{title}</h3>
  <p class="fcard-blurb">{blurb}</p>
</div>
<style>
  .fcard { background: var(--bg-1); border: 1px solid var(--border-0); border-radius: var(--r-6);
    padding: var(--s-7); transition: border-color var(--t-med), transform var(--t-med); }
  .fcard:hover { border-color: var(--border-2); transform: translateY(-2px); }
  .fcard-title { font-size: 16px; margin: 0 0 var(--s-3); color: var(--fg-0);
    border-left: 3px solid var(--accent); padding-left: var(--s-4); }
  .fcard-blurb { color: var(--fg-2); font-size: 14px; margin: 0; line-height: 1.5; }
</style>
```

- [ ] **Step 3: Create `site/src/components/CodeBlock.astro`**

```astro
---
interface Props { code: string; lang?: string; }
const { code, lang = 'bash' } = Astro.props;
---
<div class="codeblock" data-lang={lang}>
  <button class="copy-btn" type="button" aria-label="Copy">copy</button>
  <pre><code>{code}</code></pre>
</div>
<style>
  .codeblock { position: relative; background: var(--bg-2); border: 1px solid var(--border-0);
    border-radius: var(--r-5); overflow: hidden; }
  .codeblock pre { margin: 0; padding: var(--s-6); overflow-x: auto; }
  .codeblock code { font-family: var(--font-mono); font-size: 13px; color: var(--fg-1); line-height: 1.6; }
  .copy-btn { position: absolute; top: var(--s-4); right: var(--s-4); background: var(--bg-3);
    border: 1px solid var(--border-1); color: var(--fg-2); font-size: 11px; padding: 3px 8px;
    border-radius: var(--r-3); cursor: pointer; font-family: var(--font-mono); }
  .copy-btn:hover { color: var(--fg-0); border-color: var(--border-2); }
</style>
<script>
  document.querySelectorAll('.codeblock').forEach((block) => {
    const btn = block.querySelector('.copy-btn');
    const code = block.querySelector('code');
    btn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code?.textContent ?? '');
        btn.textContent = 'copied';
        setTimeout(() => (btn.textContent = 'copy'), 1500);
      } catch {}
    });
  });
</script>
```

- [ ] **Step 4: Build**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build
```
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/CTAButton.astro site/src/components/FeatureCard.astro site/src/components/CodeBlock.astro
git commit -m "feat(site): add CTA button, feature card, code block components"
```

---

### Task 6: Home page (`index.astro`)

**Files:**
- Modify: `site/src/pages/index.astro` (full rewrite)
- Create: `site/public/screenshots/.gitkeep` (placeholder dir)

**Interfaces:**
- Consumes: `Layout`, `CTAButton`, `FeatureCard`, `site`, `heroFeatures` from data.

- [ ] **Step 1: Rewrite `site/src/pages/index.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import CTAButton from '../components/CTAButton.astro';
import FeatureCard from '../components/FeatureCard.astro';
import { site } from '../data/site.ts';
import { heroFeatures } from '../data/features.ts';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
---
<Layout title={site.name + ' — ' + site.tagline}>
  <!-- HERO -->
  <section class="hero">
    <div class="container hero-inner">
      <div class="hero-copy">
        <span class="badge mono">open source · GPLv3 · Tauri 2</span>
        <h1 class="hero-title">A git desktop app<br />built for developers.</h1>
        <p class="hero-sub">{site.description}</p>
        <div class="hero-ctas">
          <CTAButton href={base + '/download'}>Download</CTAButton>
          <CTAButton href={site.repo} variant="secondary" external>View on GitHub →</CTAButton>
        </div>
        <a class="stars" href={site.repo} target="_blank" rel="noopener">
          <img src="https://img.shields.io/github/stars/jonassaa/platypusgit?style=flat&label=star&color=3E9B91" alt="GitHub stars" height="20" />
        </a>
      </div>
      <div class="hero-visual">
        <div class="fake-window">
          <div class="fw-bar"><span></span><span></span><span></span><span class="fw-title mono">platypusgit — main</span></div>
          <div class="fw-body mono">
            <div class="ln added">+ feat(diff): hunk-level staging</div>
            <div class="ln">  src/features/diff/DiffViewer.tsx</div>
            <div class="ln removed">- old inline-only diff path</div>
            <div class="ln modified">~ src/lib/derive.ts</div>
            <div class="ln graph"><span class="g1">●</span> <span class="g2">│</span> <span class="g3">╮</span> merge branch 'rebase-ui'</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FEATURES -->
  <section class="container section">
    <h2 class="section-title">Everything you do with git. In one window.</h2>
    <div class="feature-grid">
      {heroFeatures.map((f) => <FeatureCard title={f.title} blurb={f.blurb} />)}
    </div>
    <div class="section-cta">
      <CTAButton href={base + '/features'} variant="secondary">See the full feature list →</CTAButton>
    </div>
  </section>

  <!-- WHY -->
  <section class="why">
    <div class="container why-grid">
      <div class="why-item"><h3>Dev-first</h3><p>A TortoiseGit alternative designed around how developers actually work — keyboard-driven, dense, no hand-holding.</p></div>
      <div class="why-item"><h3>Extreme usability</h3><p>The north star. Every operation reachable, fast, and visible. Hunks, rebases, conflicts — all first-class.</p></div>
      <div class="why-item"><h3>Cross-platform & native</h3><p>Tauri 2 + Rust backend, React frontend. Small binary, real native windows on macOS, Windows, and Linux.</p></div>
      <div class="why-item"><h3>Open source</h3><p>GPLv3. Read the code, file issues, send patches. No telemetry, no account, no lock-in.</p></div>
    </div>
  </section>

  <!-- TECH -->
  <section class="container tech">
    <span class="mono tech-badge">Tauri 2</span>
    <span class="mono tech-badge">Rust</span>
    <span class="mono tech-badge">React 19</span>
    <span class="mono tech-badge">TypeScript</span>
    <span class="mono tech-badge">libgit2</span>
  </section>
</Layout>

<style>
  .hero { padding: var(--s-13) 0 var(--s-12); border-bottom: 1px solid var(--border-0);
    background: radial-gradient(1200px 400px at 70% -10%, color-mix(in oklab, var(--accent) 12%, transparent), transparent); }
  .hero-inner { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: var(--s-11); align-items: center; }
  .badge { display: inline-block; font-size: 12px; color: var(--accent); border: 1px solid var(--border-1);
    padding: 4px 10px; border-radius: 999px; margin-bottom: var(--s-6); }
  .hero-title { font-size: 44px; margin: 0 0 var(--s-6); }
  .hero-sub { color: var(--fg-2); font-size: 16px; max-width: 480px; margin: 0 0 var(--s-8); }
  .hero-ctas { display: flex; gap: var(--s-4); margin-bottom: var(--s-6); flex-wrap: wrap; }
  .stars { display: inline-block; }
  .fake-window { background: var(--bg-1); border: 1px solid var(--border-1); border-radius: var(--r-7);
    box-shadow: var(--shadow-3); overflow: hidden; }
  .fw-bar { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-4) var(--s-5);
    background: var(--bg-titlebar); border-bottom: 1px solid var(--border-0); }
  .fw-bar > span:not(.fw-title) { width: 11px; height: 11px; border-radius: 999px; background: var(--border-2); }
  .fw-title { margin-left: var(--s-4); color: var(--fg-3); font-size: 12px; }
  .fw-body { padding: var(--s-6); font-size: 13px; line-height: 1.9; }
  .ln { color: var(--fg-2); white-space: pre; }
  .ln.added { color: var(--git-added); }
  .ln.removed { color: var(--git-removed); }
  .ln.modified { color: var(--git-modified); }
  .g1 { color: var(--accent); } .g2 { color: var(--accent-2); } .g3 { color: var(--git-added); }
  .section { padding-top: var(--s-12); }
  .section-title { font-size: 30px; text-align: center; margin: 0 0 var(--s-10); }
  .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-6); }
  .section-cta { text-align: center; margin-top: var(--s-9); }
  .why { background: var(--bg-1); border-top: 1px solid var(--border-0); border-bottom: 1px solid var(--border-0);
    margin-top: var(--s-13); padding: var(--s-12) 0; }
  .why-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s-9); }
  .why-item h3 { font-size: 18px; margin: 0 0 var(--s-3); color: var(--accent); }
  .why-item p { color: var(--fg-2); margin: 0; font-size: 15px; }
  .tech { display: flex; gap: var(--s-4); justify-content: center; flex-wrap: wrap; padding-top: var(--s-12); }
  .tech-badge { font-size: 13px; color: var(--fg-2); border: 1px solid var(--border-1);
    padding: 6px 12px; border-radius: var(--r-4); background: var(--bg-1); }
  @media (max-width: 820px) {
    .hero-inner { grid-template-columns: 1fr; }
    .hero-title { font-size: 34px; }
    .feature-grid { grid-template-columns: 1fr; }
    .why-grid { grid-template-columns: 1fr; }
  }
</style>
```

- [ ] **Step 2: Create screenshots placeholder dir**

```bash
mkdir -p site/public/screenshots && touch site/public/screenshots/.gitkeep
```

- [ ] **Step 3: Build + preview, verify hero/features/why/tech render and are responsive**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build && pnpm preview &
```
Open `http://localhost:4321/platypusgit`. Verify hero two-column layout, faux-window with colored diff lines, 9 feature cards in a grid, why section, tech badges. Resize to mobile width — columns collapse. Stop preview.
Expected: build exits 0.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/index.astro site/public/screenshots/.gitkeep
git commit -m "feat(site): build home page with hero, features, why sections"
```

---

### Task 7: Features page (`features.astro`)

**Files:**
- Create: `site/src/pages/features.astro`

**Interfaces:**
- Consumes: `Layout`, `site`, `featureGroups`, `roadmap` from data.

- [ ] **Step 1: Create `site/src/pages/features.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import { site } from '../data/site.ts';
import { featureGroups, roadmap } from '../data/features.ts';
---
<Layout title={'Features — ' + site.name}>
  <section class="container page-head">
    <h1>Features</h1>
    <p class="lead">Everything implemented end-to-end today. platypusgit is in active development — the list grows.</p>
  </section>

  <section class="container groups">
    {featureGroups.map((g) => (
      <div class="group">
        <div class="group-head">
          <h2>{g.title}</h2>
          <p>{g.blurb}</p>
        </div>
        <ul class="group-list">
          {g.items.map((i) => <li><span class="tick">✓</span>{i}</li>)}
        </ul>
      </div>
    ))}
  </section>

  <section class="container roadmap">
    <h2 class="roadmap-title">Planned</h2>
    <p class="lead">On the roadmap, not yet shipped.</p>
    <ul class="roadmap-list">
      {roadmap.map((r) => <li><span class="soon mono">soon</span>{r}</li>)}
    </ul>
  </section>
</Layout>

<style>
  .page-head { padding-top: var(--s-12); }
  .page-head h1 { font-size: 38px; margin: 0 0 var(--s-4); }
  .lead { color: var(--fg-2); font-size: 16px; max-width: 600px; margin: 0; }
  .groups { margin-top: var(--s-11); display: grid; gap: var(--s-9); }
  .group { display: grid; grid-template-columns: 280px 1fr; gap: var(--s-8);
    padding-bottom: var(--s-9); border-bottom: 1px solid var(--border-0); }
  .group-head h2 { font-size: 20px; margin: 0 0 var(--s-3); }
  .group-head p { color: var(--fg-3); font-size: 14px; margin: 0; }
  .group-list { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--s-4); }
  .group-list li { display: flex; gap: var(--s-4); align-items: baseline; color: var(--fg-1); font-size: 15px; }
  .tick { color: var(--git-added); font-weight: 700; }
  .roadmap { margin-top: var(--s-11); }
  .roadmap-title { font-size: 24px; margin: 0 0 var(--s-3); }
  .roadmap-list { list-style: none; padding: 0; margin: var(--s-7) 0 0; display: grid; gap: var(--s-5); max-width: 720px; }
  .roadmap-list li { display: flex; gap: var(--s-5); align-items: baseline; color: var(--fg-2); font-size: 15px; }
  .soon { font-size: 11px; color: var(--accent-2); border: 1px solid var(--border-1);
    padding: 2px 7px; border-radius: var(--r-3); flex-shrink: 0; }
  @media (max-width: 720px) { .group { grid-template-columns: 1fr; gap: var(--s-5); } }
</style>
```

- [ ] **Step 2: Build + preview**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build && pnpm preview &
```
Open `http://localhost:4321/platypusgit/features`. Verify 9 feature groups with two-column layout, roadmap section with "soon" tags. Stop preview.
Expected: build exits 0.

- [ ] **Step 3: Commit**

```bash
git add site/src/pages/features.astro
git commit -m "feat(site): add features page with grouped list and roadmap"
```

---

### Task 8: Download page (`download.astro`)

**Files:**
- Create: `site/src/pages/download.astro`
- Create: `site/src/components/PlatformCard.astro`

**Interfaces:**
- Consumes: `Layout`, `CTAButton`, `CodeBlock`, `site`, `platforms` from data.
- Produces: `PlatformCard.astro` props `{ os: string, ext: string, note: string, href: string }`.

- [ ] **Step 1: Create `site/src/components/PlatformCard.astro`**

```astro
---
interface Props { os: string; ext: string; note: string; href: string; }
const { os, ext, note, href } = Astro.props;
---
<a class="pcard" href={href} target="_blank" rel="noopener">
  <div class="pcard-os">{os}</div>
  <div class="pcard-ext mono">{ext}</div>
  <div class="pcard-note">{note}</div>
  <div class="pcard-link">Get from Releases →</div>
</a>
<style>
  .pcard { display: block; background: var(--bg-1); border: 1px solid var(--border-0);
    border-radius: var(--r-6); padding: var(--s-7); transition: border-color var(--t-med), transform var(--t-med); }
  .pcard:hover { border-color: var(--accent); transform: translateY(-2px); text-decoration: none; }
  .pcard-os { font-size: 18px; font-weight: 600; color: var(--fg-0); font-family: var(--font-display); }
  .pcard-ext { color: var(--accent); font-size: 14px; margin: var(--s-3) 0; }
  .pcard-note { color: var(--fg-3); font-size: 13px; }
  .pcard-link { color: var(--fg-2); font-size: 13px; margin-top: var(--s-5); }
</style>
```

- [ ] **Step 2: Create `site/src/pages/download.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import CTAButton from '../components/CTAButton.astro';
import CodeBlock from '../components/CodeBlock.astro';
import PlatformCard from '../components/PlatformCard.astro';
import { site } from '../data/site.ts';
import { platforms } from '../data/features.ts';

const buildSteps = `# 1. Prerequisites: Node 22+, pnpm, Rust stable
#    macOS: xcode-select --install
#    Linux: libwebkit2gtk-4.1-dev build-essential libssl-dev
#    Windows: WebView2 + MSVC Build Tools

git clone ${site.repo}.git
cd platypusgit
pnpm install
pnpm tauri build   # produces .dmg / .msi / .deb / .AppImage`;
---
<Layout title={'Download — ' + site.name}>
  <section class="container page-head">
    <h1>Download</h1>
    <p class="lead">platypusgit is in active development. Prebuilt binaries land on GitHub Releases — meanwhile, build from source below.</p>
    <div class="head-ctas">
      <CTAButton href={site.releasesLatest} external>Latest release</CTAButton>
      <CTAButton href={site.releases} variant="secondary" external>All releases</CTAButton>
    </div>
  </section>

  <section class="container">
    <div class="notice">
      <strong>No published releases yet.</strong> Binaries will appear on the
      <a href={site.releases} target="_blank" rel="noopener">Releases page</a> once tagged. Build from source today.
    </div>
    <div class="platforms">
      {platforms.map((p) => <PlatformCard os={p.os} ext={p.ext} note={p.note} href={site.releases} />)}
    </div>
  </section>

  <section class="container build">
    <h2>Build from source</h2>
    <p class="lead">Standard Tauri toolchain. Full instructions in the README.</p>
    <CodeBlock code={buildSteps} lang="bash" />
    <p class="readme-link"><a href={site.repo + '#development'} target="_blank" rel="noopener">Full development guide on GitHub →</a></p>
  </section>
</Layout>

<style>
  .page-head { padding-top: var(--s-12); }
  .page-head h1 { font-size: 38px; margin: 0 0 var(--s-4); }
  .lead { color: var(--fg-2); font-size: 16px; max-width: 620px; margin: 0; }
  .head-ctas { display: flex; gap: var(--s-4); margin-top: var(--s-7); flex-wrap: wrap; }
  .notice { background: color-mix(in oklab, var(--accent-2) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--accent-2) 40%, transparent);
    color: var(--fg-1); padding: var(--s-5) var(--s-6); border-radius: var(--r-5);
    margin: var(--s-10) 0 var(--s-8); font-size: 14px; }
  .platforms { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-6); }
  .build { margin-top: var(--s-12); }
  .build h2 { font-size: 26px; margin: 0 0 var(--s-3); }
  .build .lead { margin-bottom: var(--s-7); }
  .readme-link { margin-top: var(--s-6); font-size: 14px; }
  @media (max-width: 720px) { .platforms { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 3: Build + preview**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build && pnpm preview &
```
Open `http://localhost:4321/platypusgit/download`. Verify 3 platform cards, notice banner, build-from-source code block with working copy button. Stop preview.
Expected: build exits 0.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/download.astro site/src/components/PlatformCard.astro
git commit -m "feat(site): add download page with platform cards and build guide"
```

---

### Task 9: Changelog page (`changelog.astro`)

**Files:**
- Create: `site/src/pages/changelog.astro`

**Interfaces:**
- Consumes: `Layout`, `CTAButton`, `site`, `changelog` from data.

- [ ] **Step 1: Create `site/src/pages/changelog.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import CTAButton from '../components/CTAButton.astro';
import { site } from '../data/site.ts';
import { changelog } from '../data/features.ts';
---
<Layout title={'Changelog — ' + site.name}>
  <section class="container page-head">
    <h1>Changelog</h1>
    <p class="lead">Release notes. For the full commit history, see <a href={site.repo + '/commits/main'} target="_blank" rel="noopener">GitHub</a>.</p>
    <div class="head-ctas">
      <CTAButton href={site.releases} variant="secondary" external>Releases on GitHub →</CTAButton>
    </div>
  </section>

  <section class="container log">
    {changelog.map((entry) => (
      <article class="entry">
        <div class="entry-meta">
          <span class="ver mono">v{entry.version}</span>
          <span class="date">{entry.date}</span>
          <span class="status">{entry.status}</span>
        </div>
        <ul class="entry-notes">
          {entry.notes.map((n) => <li>{n}</li>)}
        </ul>
      </article>
    ))}
  </section>
</Layout>

<style>
  .page-head { padding-top: var(--s-12); }
  .page-head h1 { font-size: 38px; margin: 0 0 var(--s-4); }
  .lead { color: var(--fg-2); font-size: 16px; max-width: 600px; margin: 0; }
  .head-ctas { margin-top: var(--s-7); }
  .log { margin-top: var(--s-11); display: grid; gap: var(--s-9); max-width: 760px; }
  .entry { border-left: 2px solid var(--border-1); padding-left: var(--s-7); position: relative; }
  .entry::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px;
    border-radius: 999px; background: var(--accent); }
  .entry-meta { display: flex; align-items: center; gap: var(--s-5); margin-bottom: var(--s-5); flex-wrap: wrap; }
  .ver { font-size: 18px; font-weight: 700; color: var(--fg-0); }
  .date { color: var(--fg-3); font-size: 14px; }
  .status { font-size: 11px; color: var(--accent-2); border: 1px solid var(--border-1);
    padding: 2px 8px; border-radius: 999px; }
  .entry-notes { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--s-4); }
  .entry-notes li { color: var(--fg-1); font-size: 15px; padding-left: var(--s-5); position: relative; }
  .entry-notes li::before { content: '–'; position: absolute; left: 0; color: var(--fg-3); }
</style>
```

- [ ] **Step 2: Build + preview**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build && pnpm preview &
```
Open `http://localhost:4321/platypusgit/changelog`. Verify timeline entry with version/date/status and notes. Stop preview.
Expected: build exits 0.

- [ ] **Step 3: Commit**

```bash
git add site/src/pages/changelog.astro
git commit -m "feat(site): add changelog page"
```

---

### Task 10: GitHub Pages deploy workflow + supporting files

**Files:**
- Create: `.github/workflows/site.yml`
- Create: `.github/FUNDING.yml`
- Create: `site/README.md`

**Interfaces:**
- Consumes: the built `site/dist` from `pnpm build`.

- [ ] **Step 1: Create `.github/workflows/site.yml`**

```yaml
name: Deploy site

on:
  push:
    branches: [main]
    paths: ['site/**', '.github/workflows/site.yml']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: site/pnpm-lock.yaml
      - name: Install
        run: pnpm install --frozen-lockfile
        working-directory: site
      - name: Build
        run: pnpm build
        working-directory: site
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create `.github/FUNDING.yml`**

```yaml
# Buy Me a Coffee handle — replace REPLACE_ME with the real handle.
buy_me_a_coffee: REPLACE_ME
```

- [ ] **Step 3: Create `site/README.md`**

```markdown
# platypusgit marketing site

Astro static site for [platypusgit](https://github.com/jonassaa/platypusgit).
Deployed to GitHub Pages at https://jonassaa.github.io/platypusgit.

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:4321/platypusgit
pnpm build    # output -> dist/
pnpm preview  # serve the build locally
```

## Configuration

All external links live in `src/data/site.ts`. Set the real **Buy Me a Coffee**
URL there (`buyMeACoffee`) and in `../.github/FUNDING.yml` (`buy_me_a_coffee` handle).

Feature/changelog content lives in `src/data/features.ts`.

## Deploy

Pushing to `main` with changes under `site/**` triggers `.github/workflows/site.yml`,
which builds and deploys to Pages.

**One-time repo setting (required):** GitHub → Settings → Pages → Build and
deployment → Source = **GitHub Actions**.
```

- [ ] **Step 4: Validate workflow YAML + final build**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm build
```
Expected: build exits 0. Confirm `.github/workflows/site.yml` exists and is valid YAML (indentation correct).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/site.yml .github/FUNDING.yml site/README.md
git commit -m "ci(site): add GitHub Pages deploy workflow and funding config"
```

---

### Task 11: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Clean build from scratch**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && rm -rf dist .astro && pnpm build
```
Expected: exits 0, no warnings about broken links. `site/dist/` contains `index.html`, `features/index.html`, `download/index.html`, `changelog/index.html`.

- [ ] **Step 2: Preview and click through every page + both themes**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cd site && pnpm preview &
```
Open `http://localhost:4321/platypusgit`. Click every nav link (Home, Features, Download, Changelog, GitHub, Sponsor). Toggle theme on each page — confirm dark/light both legible and persisted across navigation. Test mobile width. Verify copy buttons work. Stop preview.

- [ ] **Step 3: Confirm no stray placeholders leaked except intended ones**

Run:
```bash
grep -rn "REPLACE_ME" site/src .github/FUNDING.yml
```
Expected: matches only in `site/src/data/site.ts` (buyMeACoffee) and `.github/FUNDING.yml` — both intentional, awaiting the user's real URL/handle.

- [ ] **Step 4: Final commit if any fixes were made during verification**

```bash
git add -A site .github
git commit -m "fix(site): polish from final verification pass"
```
(Skip if nothing changed.)

---

## Post-implementation — user actions required

1. Set GitHub repo **Pages source = GitHub Actions** (Settings → Pages).
2. Provide the real Buy Me a Coffee URL → update `site/src/data/site.ts` (`buyMeACoffee`) and `.github/FUNDING.yml` (`buy_me_a_coffee`).
3. (Optional) Add real app screenshots to `site/public/screenshots/` and wire into the home page screenshot band.
