# platypusgit marketing site

Astro static site for [platypusgit](https://github.com/jonassaa/platypusgit).
Deployed to GitHub Pages, served at https://www.platypusgit.com (the apex
domain 301s to `www`).

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # output -> dist/
pnpm preview      # serve the build locally
pnpm og           # regenerate public/og.png from scripts/og-image.html
pnpm capture <n>  # capture a 2x app-window master into screenshots/ (macOS)
pnpm screenshots  # re-encode public/screenshots/*.webp from screenshots/*.png
pnpm installers   # copy ../scripts/install-pgit.* into public/ (dev + build do this)
```

## The `pgit` installer scripts

`https://www.platypusgit.com/install-pgit.sh` and `install-pgit.ps1` are the
copy-paste route to the `pgit` CLI for the two channels that run no install code
— the macOS `.dmg` and the Linux AppImage (#144). Homebrew, the `.deb` and the
`.msi` install `pgit` themselves; the download page's `#cli` section says so
rather than presenting the one-liner as the general way to get it.

The served files are **not committed here.** `scripts/copy-installers.mjs` copies
`../scripts/install-pgit.sh` and `.ps1` into `public/` before every `dev` and
`build`, and `.gitignore` covers the copies. A second checked-in copy of a shell
script drifts from the first, and the drifted one is the one users pipe into
`sh`; a build-time copy makes the served bytes the repo's bytes by construction.
It is a plain byte copy with no templating — the scripts have to stay
`curl … | sh`-safe, and a substitution pass here could break that without
touching the file anyone reviews.

`.github/workflows/site.yml` therefore triggers on `scripts/install-pgit.*` as
well as `site/**`, and its build step runs `pnpm build` (not `astro build`), so
the copy actually happens in CI.

## Configuration

All external links live in `src/data/site.ts`. Set the real **Buy Me a Coffee**
URL there (`buyMeACoffee`) and in `../.github/FUNDING.yml` (`buy_me_a_coffee` handle).

Feature/changelog content lives in `src/data/features.ts`.

SEO copy (per-page meta descriptions) and the schema.org JSON-LD live in
`src/data/seo.ts`. `ORIGIN` there must match `site` in `astro.config.mjs`.

## URL shape

`trailingSlash: 'always'`. GitHub Pages 301s `/features` to `/features/`, so
every internal link and the canonical tag carry the slash — a redirect hop on
each internal click wastes crawl budget and slows navigation. Asset paths in
`src/styles/tokens.css` are root-absolute (`/fonts/...`), not
`/platypusgit/...`: the site is served from the domain root, not a project
sub-path.

## Social preview image

`public/og.png` (1200x630) is referenced by `og:image` / `twitter:image`. Its
source is `scripts/og-image.html`; `pnpm og` screenshots it with headless
Chrome (override the browser with `CHROME_PATH`). The PNG is committed, so CI
never needs Chrome — but re-run `pnpm og` and commit the result whenever the
template changes.

## App screenshots

The hero on `/` and the two figures on `/features/` are real captures of the
app, replacing a hand-built HTML replica of the History screen that drifted
from the UI on every change with nothing to catch it.

**Capture at 2x, always.** This section used to say "capture at 1600x1112",
which is a 1x capture — and the figures are laid out at 1040 CSS px, so every
Retina visitor was handed a 1.3x *upscale* of 1x text and the windows read as
blurry. Nothing downstream can fix that: raising the WebP quality does nothing
(q85 is already visually identical to the PNG master at 1:1), because the
detail was never in the file. The masters have to carry 2x the rendered width.

- **Masters:** `screenshots/*.png`, **3200x2224** — a 1600x1112 *point* window
  captured on a Retina display — with the macOS window chrome and drop shadow
  over a **transparent** margin. Outside `src/` and `public/`, so Astro neither
  processes nor deploys them.
- **Shipped:** `public/screenshots/*.webp`, encoded by `pnpm screenshots` at
  quality 85 and **committed**, so `astro build` needs no image pipeline and CI
  installs nothing extra. Same arrangement as `og.png`. Two variants per figure
  — `name.webp` at 1040px for 1x screens and `name@2x.webp` at 2080px for
  Retina — and `Screenshot.astro` offers both in a `srcset` so the browser
  picks by device pixel ratio.
- A master under 2080px wide gets **no** `@2x` variant and a loud warning
  instead of an upscale that costs bytes and adds no detail. `Screenshot.astro`
  resolves which variants exist from disk, so a 1x master degrades to exactly
  today's behaviour rather than breaking the page.
- `RENDER_W` in `scripts/screenshots.mjs` and the `sizes` attribute in
  `Screenshot.astro` both encode the 1040px layout width. Change the column
  width and both have to move, or the browser picks the wrong variant while
  everything still *looks* fine.
- The transparent margin is why `Screenshot.astro` draws **no** border, radius
  or shadow: the capture carries its own, and a frame of ours would double it.
- There is one asset per view, not a light/dark pair. A framed dark window on
  the light theme reads as a photograph of an app; it gets a faint accent halo
  behind it so it has something to sit on.

### Replacing a capture

```bash
pnpm capture --resize          # size the running app window to 1600x1112 pt
pnpm capture history-dark      # then click the window; verifies it came out 2x
pnpm screenshots               # encode both variants
```

`pnpm capture` is macOS-only (only `screencapture -o` returns a window with its
shadow on transparency) and **rejects a capture that is not 2x** — an external
1x monitor silently produces a 1x master that looks fine in Preview and blurry
on the site, which is the whole failure this guards. `--resize` drives the
window through System Events and needs Accessibility permission for your
terminal, once; size the window by hand otherwise.

What the script cannot do for you: put the UI in the state the figure is meant
to show, in dark theme, with nothing personal on screen. Keep the existing
figure names when replacing one — the `alt` text in `index.astro` /
`features.astro` describes what is in that specific window, and a different
window makes it wrong.

## Search-engine setup (manual, one-time)

Code-side SEO is done: `robots.txt`, `sitemap-index.xml` (generated by
`@astrojs/sitemap`), canonical URLs, Open Graph / Twitter cards, and
`WebSite` + `SoftwareApplication` JSON-LD. Getting indexed still needs a human:

1. [Google Search Console](https://search.google.com/search-console) → add the
   `www.platypusgit.com` property, verify (DNS `TXT` record is easiest), submit
   `https://www.platypusgit.com/sitemap-index.xml`, then **URL Inspection →
   Request indexing** for the homepage.
2. [Bing Webmaster Tools](https://www.bing.com/webmasters) → same; also feeds
   DuckDuckGo and friends.
3. Inbound links are what actually move rankings for a new domain: the GitHub
   repo's homepage field, release notes, awesome-lists, alternativeto.net, and
   any post that mentions the project.

## Deploy

Pushing to `main` with changes under `site/**` triggers `.github/workflows/site.yml`,
which builds and deploys to Pages.

**One-time repo setting (required):** GitHub → Settings → Pages → Build and
deployment → Source = **GitHub Actions**.
