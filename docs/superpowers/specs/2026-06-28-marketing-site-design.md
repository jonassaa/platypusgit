# platypusgit Marketing Site — Design

**Date:** 2026-06-28
**Status:** Approved
**Topic:** Astro-based GitHub Pages marketing/landing site for platypusgit.

## Goal

Public-facing site for the open-source platypusgit app. Covers the usual OSS landing-page
points: what it is, features, downloads, changelog, links to GitHub, funding (Buy Me a
Coffee). Visual language matches the app 1:1 (dark hero, brand teal/amber, monospace-forward,
dense/utilitarian).

## Decisions (locked during brainstorming)

- **Location & deploy:** lives in `site/` subdir of this repo. GitHub Action builds and deploys
  to GitHub Pages. Project page at `https://jonassaa.github.io/platypusgit`.
- **Releases:** static changelog page. Download buttons link to the GitHub Releases page
  (works once releases are published). No build-time GitHub API fetch.
- **Funding:** Buy Me a Coffee button; user supplies URL. Placeholder until then.

## Stack

- **Astro 5**, static output (`output: 'static'`).
- Zero client JS except two tiny islands: theme toggle, copy-to-clipboard on code blocks.
- Config: `site: 'https://jonassaa.github.io'`, `base: '/platypusgit'` so all internal links
  and assets resolve under the project-page subpath.
- Package manager: **pnpm** (matches repo toolchain, Node 22).
- `site/` has its own `package.json` / `pnpm-lock.yaml` — independent of the app's, so the
  site build never pulls Tauri/React deps.

## Visual language

Port app design tokens directly. Source of truth: `src/index.css` `:root` block.

- **Palette:** dark default — `--bg-0..4` (oklch cool), `--fg-0..4`. Light mode via
  `[data-theme-mode="light"]` override (same pattern as app).
- **Brand:** teal `#3E9B91` (platypus head), amber `#E6A95A` (bill). Map to `--accent` /
  secondary accent for the site. Logo source: `src-tauri/icons/logo.svg`.
- **Type:** JetBrains Mono (display/headings + code), Inter (body). Self-host both as woff2
  under `site/public/fonts/` with `@font-face` — no external font CDN (works offline, no
  layout shift, GDPR-clean).
- **Git-state colors:** reuse `--git-added` (green) / `--git-removed` (red) to decorate a
  faux-diff element in the hero (on-brand for a git tool).
- **Density:** tight spacing scale, hairline borders (`--border-0/1`), subtle shadows —
  mirror the app's utilitarian feel. Not a typical airy SaaS landing page.

## Site structure

```
site/
├── package.json
├── pnpm-lock.yaml
├── astro.config.mjs          # site/base, integrations
├── tsconfig.json
├── public/
│   ├── logo.svg              # copied from src-tauri/icons/logo.svg
│   ├── favicon.svg
│   ├── og-image.png          # social card (1200x630)
│   ├── fonts/                # JetBrains Mono + Inter woff2
│   └── screenshots/          # app screenshots (placeholder if none yet)
└── src/
    ├── styles/
    │   └── tokens.css        # trimmed copy of app :root tokens + base styles
    ├── data/
    │   ├── features.ts       # feature list (mirrors implemented-features.md groups)
    │   └── site.ts           # central config: repo URL, BMC URL, download links, nav
    ├── layouts/
    │   └── Layout.astro      # <head>, tokens import, Nav, Footer, slot
    ├── components/
    │   ├── Nav.astro
    │   ├── Footer.astro
    │   ├── Hero.astro
    │   ├── FeatureCard.astro
    │   ├── FeatureGrid.astro
    │   ├── CTAButton.astro
    │   ├── PlatformCard.astro
    │   ├── ThemeToggle.astro     # island (client:load)
    │   └── CopyButton.astro      # island for code blocks
    └── pages/
        ├── index.astro
        ├── features.astro
        ├── changelog.astro
        └── download.astro
```

### Central config (`src/data/site.ts`)

Single source for all external links so they're trivial to update:

```ts
export const site = {
  name: 'platypusgit',
  tagline: 'A dev-first git desktop app. Extreme usability.',
  repo: 'https://github.com/jonassaa/platypusgit',
  releases: 'https://github.com/jonassaa/platypusgit/releases',
  releasesLatest: 'https://github.com/jonassaa/platypusgit/releases/latest',
  buyMeACoffee: 'https://buymeacoffee.com/REPLACE_ME', // TODO: user supplies
  license: 'GPL-3.0-only',
};
```

## Pages

### `/` (index)
- **Hero:** logo, name, tagline, primary CTA (Download) + secondary (View on GitHub),
  GitHub-star badge (static shields.io image, no JS). Decorative faux-diff/commit-graph
  visual using git-state colors.
- **Feature grid:** the 9 README feature areas as cards (icon + title + blurb).
- **Screenshot band:** app screenshot(s). Placeholder frame if none committed yet.
- **"Why platypusgit":** short pitch — dev-first, TortoiseGit alternative, standalone GUI,
  cross-platform, open source (GPLv3).
- **Tech badges:** Tauri 2 · Rust · React · TypeScript.

### `/features`
- Full implemented-feature list grouped (staging, diff, branches, history, stash, conflict,
  rebase, remotes) sourced from `implemented-features.md`.
- Short roadmap teaser from `features.md` P0/P1 (clearly labeled "planned").

### `/changelog`
- Static, hand-maintained release notes. Top entry for current state (v0.1.0, active dev).
- "Download latest" button → GitHub Releases. Note that binaries land here once published.

### `/download`
- Platform cards: macOS (.dmg), Windows (.msi), Linux (.deb / .AppImage) — each links to
  GitHub Releases. Caveat banner: "no published releases yet — build from source below."
- Build-from-source block (prerequisites + commands), copy buttons, sourced from README.

Nav: Home · Features · Download · Changelog · GitHub · ☕ (Buy Me a Coffee) · theme toggle.

## Deploy — GitHub Action

`.github/workflows/site.yml`:
- Trigger: `push` to `main` on paths `site/**` (+ manual `workflow_dispatch`).
- Steps: checkout → setup-pnpm → setup-node 22 (cache pnpm) → `pnpm install` in `site/` →
  `pnpm build` → `actions/upload-pages-artifact` (`site/dist`) → `actions/deploy-pages`.
- Permissions: `pages: write`, `id-token: write`. Concurrency group `pages`.
- Repo setting required (manual, one-time): Settings → Pages → Source = GitHub Actions.
  Documented in the spec + a short note in `site/README.md`.

## Supporting files

- `.github/FUNDING.yml` — Buy Me a Coffee (placeholder) so the repo's Sponsor button works.
- `site/README.md` — how to run/build the site locally, where to set the BMC URL, the
  one-time Pages source setting.

## Out of scope (YAGNI)

- Blog, docs portal, i18n, search, analytics/tracking.
- Build-time GitHub API release fetching (static changelog instead).
- App screenshots are placeholders until real captures are supplied.

## Open items for user

- Buy Me a Coffee URL (placeholder `REPLACE_ME` until provided).
- Real app screenshots (optional; placeholder frame ships meanwhile).
- One-time GitHub repo setting: Pages source = GitHub Actions.
