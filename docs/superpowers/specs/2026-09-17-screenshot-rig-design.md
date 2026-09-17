# A screenshot rig for the site figures — spec

No issue: requested directly — "we need crisp screenshots for the site. the
current ones are blurry and old."

## What is on the site today, and why both halves of that sentence are true

Three figures carry every pixel of product information the marketing site
shows: `history-dark` is the hero on `index.astro`, and `commit-dark` plus
`welcome-dark` sit on `features.astro`. They are real captures of the app over
a purpose-built demo repository (`pgit-showcase`, fictional authors), taken on
**2026-08-18**.

**Blurry** is a resolution fact, not a taste. The masters in `site/screenshots/`
are 1600x1112 — a 1x capture. `Screenshot.astro` lays the figures out at 1040
CSS px and already ships a `srcset` offering a `@2x` variant, and
`scripts/screenshots.mjs` already knows how to encode one. Both refuse to
produce it, correctly, because the master does not contain the pixels: the
2x variant is emitted only when `master.width >= RENDER_W * 2` (2080). So every
Retina visitor is handed the 1040px variant and paints it into 2080 device
pixels, and a screenshot of a UI is almost entirely text — the one content that
does not survive resampling. No WebP quality setting reaches this; the detail
was never in the file.

**Old** is the larger problem, and it is invisible in a diff. 112 commits have
touched `src/` since those captures. The decisive one is `a73f5ef feat(design):
replace the hand-drawn icon set with lucide-react (#425)` — *every* icon in all
three figures belongs to a set the app no longer ships. Alongside it, and all
visible in the hero: `babc0f7` runs the activity bar to the window's bottom
edge, `0530187` gives a tag pill a tag icon rather than a branch's, `a666295`
stops a narrow log pane from eating the subject column, `75bd3c4` adds the
global Text size and Spacing presets that move every row's geometry. The demo
repository's commits are pinned to 2026-06-26, so the "1mo ago" column in the
hero would read "2mo ago" today.

So the site is advertising an August build with a retired icon set, softly.

## Why the existing capture path cannot fix it

`scripts/capture.mjs` was written on 2026-08-27 — *after* those masters — to
solve exactly this, by demanding a 2x capture and rejecting a 1x one. It has
never produced a master, and on inspection it cannot in its current form.

It sizes the app **window** to `WINDOW_PT` = 1600x1112 points, then validates
the **resulting PNG** against `RATIO = 1600/1112` (1.4388). Those are different
rectangles. `screencapture -o` returns the window plus its drop shadow over a
transparent margin, so the PNG is always larger than the window. Measured from
the shipped master: a 1462x975 window sits in a 1600x1112 canvas, with margins
of 69px left and right, 47 above and 90 below. Apply margins of that order to a
1600x1112 window and the PNG lands near 1738x1249 — a ratio of 1.39, which
trips the script's own aspect check and exits 1. The aspect gate and the resize
target disagree by construction.

Beyond that bug, the path is manual by design and says so: *"What you have to do
by hand, because it is a design act and not a crop."* It needs a human on a
Retina display to put the UI in the right state and click the window.
`screencapture -w` blocks on that click, and `osascript`/System Events is
permission-refused in an assistant session, so `--resize` cannot run either.
Every refresh of the figures costs a human sitting down with the app, which is
precisely why they went thirty days and 112 commits without one.

## The decision: render the real frontend headlessly, composite the chrome

The app sets `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`. That is the
fact the whole design rests on: **the app draws its entire titlebar itself, in
HTML and CSS.** macOS contributes exactly three traffic-light circles and a drop
shadow. Everything else in those three figures — the repository name, the branch
chip, Refresh/Fetch/Pull/Push, the tab strip, the activity bar, the commit
table, the diff pane and its minimap, the status bar — is web content that a
browser can render.

So: render `src/` in headless Chrome at device scale factor 2, and composite the
drop shadow and the three traffic lights afterwards.

### Why not the two alternatives

**The real binary over WebDriver on macOS** would be ideal and does not exist:
`tauri-driver` supports Linux (WebKitWebDriver) and Windows (msedgedriver), not
macOS. There is no headless route to the real WKWebView.

**The real binary in the Docker e2e stack** is reachable — the suite already
drives it with a real Rust backend over real temporary repositories, which would
mean zero mock drift and real `git` data. It is rejected on fidelity: it renders
in WebKitGTK on Linux with Linux font stacks, and the site frames these figures
in macOS window chrome. Pasting a macOS titlebar onto a Linux rendering produces
a picture of a product that does not exist.

Headless Chrome on macOS keeps the system font stack and the real stylesheet.
Its text rasterisation is not bit-identical to WKWebView's, which is an accepted
cost, agreed explicitly: the difference is subpixel, and the figures are viewed
at 1040 CSS px.

### The mock surface is one function, not 167

`src/lib/tauri.ts` exports 167 wrappers across 1983 lines, and the convention
that nothing may call `invoke` directly is load-bearing here: all 167 funnel
through one private `invoke(cmd, args)` at line 110. Mocking the backend is
therefore mocking a `cmd -> fixture` map, not a wrapper-by-wrapper reimplementation.

The vitest suite already does this. `src/test/invokeMock.ts` is a 41-line
registry — `mockInvoke(cmd, handler)` — that **throws** on an unregistered
command. That throw is the design's best feature: it converts fixture-building
from guesswork into a worklist. Run a scene, read which command it asked for,
add it, repeat, until the screen paints.

The rig does not import the vitest mocks (they are wired by `vi.mock` in
`setup.ts`, which only exists under vitest). It reuses their *shape* through
Vite `resolve.alias`, which is the build-time equivalent.

Beyond `@tauri-apps/api/core`, `src/` imports `api/window` (11 sites),
`plugin-log` (10), `api/event` (8), `plugin-dialog` (7), `api/webviewWindow`
(4), `plugin-os` and `api/dpi` (1 each). All are aliased to shims; most are
inert stubs, since a still figure neither listens for an event nor opens a
dialog.

### Layout

```
site/scripts/shoot/
  vite.config.ts          aliases every @tauri-apps/* entry to a shim
  shim/core.ts            invoke() over the cmd -> fixture map; throws on a miss
  shim/{event,window,webviewWindow,dpi,log,dialog,os}.ts
  fixtures/showcase.ts    the pgit-showcase data, typed against src/lib/types.ts
  scenes/{history,commit,welcome}.ts   per-figure state, route and clock
  entry.tsx               mounts the real app with a scene applied
  shoot.mjs               Chrome at DPR 2 -> sharp composite -> screenshots/*.png
```

`fixtures/showcase.ts` importing the real types from `src/lib/types.ts` is what
contains the drift risk that the hand-built `AppShowcase.astro` replica died of:
a backend shape change breaks `tsc`, loudly, instead of quietly producing a
wrong picture. The e2e typecheck gate pattern (`tsc -p <dir>/tsconfig.json
--noEmit`) applies here too.

### Geometry, and why it is exact

The rig reproduces the established composition rather than inventing one.
Measured from `history-dark.png`: window 1462x975 in a 1600x1112 canvas.
Doubled, the rig renders a **2924x1950** viewport and composites into a
**3200x2224** canvas, with shadow margins of 138 left and right, 94 above and
180 below. That is 2x `RENDER_W` with room to spare, so `screenshots.mjs` emits
the `@2x` variant, and it holds the 1600/1112 aspect ratio that both
`screenshots.mjs` and `Screenshot.astro` hardcode — so neither file changes, and
the reserved layout box on the page does not move.

The composite is two operations in sharp: a rounded-corner mask with a blurred
black shadow beneath, and three circles at the traffic-light positions. Their
coordinates come from the existing master, so the result sits where the eye
already expects it.

### Determinism

Three things are pinned, because a figure that changes when nothing changed is a
figure nobody trusts:

- **The clock.** Relative ages ("1mo ago") are computed against a frozen `Date`
  in the scene, not the calendar. This is also what fixes the demo repository's
  drift toward "2mo ago" without touching the repository.
- **Text size and Spacing.** #459's presets drive `--row-scale` and `--row-step`;
  scenes set them explicitly rather than inheriting whatever `localStorage`
  holds.
- **The theme.** Dark, with the accent pinned — #455 added palette shuffling.

### What runs when

`pnpm shoot` regenerates the masters on demand, locally. Masters and encoded
WebP stay committed, exactly as `pnpm og` and `pnpm screenshots` already work,
so `astro build` keeps needing no image pipeline and CI installs no Chrome. No
CI drift check: font and Chrome-version differences across runners are a flake
surface, and the composition of a marketing figure stays a deliberate act.

The rig replaces `scripts/capture.mjs`, which is removed — leaving a broken
manual path beside a working automated one invites someone to use it.
`screenshots.mjs` and `Screenshot.astro` are untouched.

## Scope

Three figures, re-shot at the same names and the same composition:
`history-dark`, `commit-dark`, `welcome-dark`. Replacing them in place keeps
every call site and layout decision valid. Their **alt text changes** where the
UI did — it is unusually load-bearing on this site (the only images carrying
product information) and currently describes a retired icon set and a stale
branch list.

Out of scope: new figures for surfaces shipped since August (settings, theme
editor, branch folders), light-theme variants, and any change to how the site
lays figures out.

## How it is verified

- `pnpm exec tsc -p site/scripts/shoot/tsconfig.json --noEmit` — fixtures still
  match `src/lib/types.ts`.
- `pnpm shoot` produces three 3200x2224 masters; `pnpm screenshots` then emits
  both variants per figure with no 1x warning, which is the machine-checkable
  form of "crisp".
- The rendered figures are read back and compared against the current app
  surface for the specific drift this spec names: lucide icons, the activity bar
  meeting the bottom edge, the tag pill's icon.
- `pnpm test` and `pnpm vite build` in `site/`.
