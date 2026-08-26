// Encodes the app captures in screenshots/*.png to public/screenshots/*.webp,
// at ONE variant per device pixel ratio. Run after replacing a capture:
// `pnpm screenshots`.
//
// Same arrangement as `pnpm og`: the encoded files are COMMITTED, so CI never
// runs this and `astro build` needs no image pipeline. The masters stay in
// screenshots/ (outside src/ and public/, so Astro neither processes nor
// deploys them) — a future recrop or requality then needs no recapture.
//
// Why two variants and not one. A screenshot of a UI is mostly TEXT, and text
// is the one thing that does not survive being resampled: the browser is
// handed 1600px and has to paint 2080 device pixels on any Retina display
// (1040 CSS px x 2), so every glyph edge gets interpolated and the whole
// window reads as blurry. The fix is not a higher WebP quality — measured, q85
// is visually identical to the PNG master at 1:1 — it is giving each display
// an asset it can paint 1:1. So: RENDER_W for 1x screens, RENDER_W*2 for
// Retina, chosen by the browser from the srcset in Screenshot.astro.
//
// This is why MASTERS MUST BE 2x CAPTURES (3200x2224). A 1x master cannot be
// made sharp here; upscaling it to 2080 would only add bytes. When a master is
// too small the 2x variant is SKIPPED and a warning is printed, rather than
// shipping an upscale that pretends to be detail — see `pnpm capture`.
//
// Why WebP at q85 and not the PNG: 1741 KB -> 345 KB for the three at the old
// single 1600px variant, with no visible difference at 1:1 on the smallest text
// in the densest capture. Lossless WebP was measured too (779 KB); it is not
// worth 434 KB on a landing page. Alpha is preserved at alphaQuality 100 — the
// captures are a window over a TRANSPARENT margin with a baked drop shadow, and
// that shadow is what lets one dark asset sit on the light theme.
import { readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'screenshots');
const out = resolve(here, '..', 'public', 'screenshots');
const QUALITY = 85;

// The CSS width the figures are laid out at: --maxw (1080px) minus the
// .container gutter (--s-7, 20px each side). Screenshot.astro's `sizes`
// attribute is written against the same number — change one, change both.
const RENDER_W = 1040;

// Every capture is this shape. Screenshot.astro hardcodes the same ratio to
// reserve the box before the bytes arrive, so a master that disagrees would
// shift the page on load; fail loudly instead.
const RATIO_W = 1600;
const RATIO_H = 1112;

// sharp is a dev-machine tool here, not a dependency. It is already on disk
// after `pnpm install`, because astro declares it as an OPTIONAL dependency
// for its own image service — but pnpm's isolated node_modules does not hoist
// it, so a bare `import 'sharp'` cannot see it from this script. Look in both
// places rather than making the site depend on it: adding it to package.json
// would put a native binary in the deploy install for images that are already
// encoded.
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {}
  const pnpmDir = resolve(here, '..', 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    const dir = readdirSync(pnpmDir).find((d) => d.startsWith('sharp@'));
    if (dir) {
      const entry = join(pnpmDir, dir, 'node_modules', 'sharp', 'lib', 'index.js');
      if (existsSync(entry)) return (await import(pathToFileURL(entry).href)).default;
    }
  }
  console.error(
    'No sharp found. Run `pnpm install` in site/ (astro brings sharp in as an\n' +
      'optional dependency), or install it yourself: `pnpm add -D sharp`.',
  );
  process.exit(1);
}

const sharp = await loadSharp();
const files = readdirSync(src)
  .filter((f) => f.endsWith('.png'))
  .sort();

if (files.length === 0) {
  console.error(`No PNG captures in ${src}`);
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
let before = 0;
let after = 0;
let lowRes = 0;

for (const file of files) {
  const from = join(src, file);
  const stem = file.replace(/\.png$/, '');
  const master = await sharp(from).metadata();

  // A master whose aspect ratio drifts would silently break the reserved box.
  const want = (RATIO_W / RATIO_H).toFixed(4);
  const got = (master.width / master.height).toFixed(4);
  if (want !== got) {
    console.error(
      `${file}: aspect ratio ${master.width}x${master.height} (${got}) is not ` +
        `${RATIO_W}x${RATIO_H} (${want}). Recrop it, or update RATIO_W/RATIO_H here ` +
        `AND the matching constants in src/components/Screenshot.astro.`,
    );
    process.exit(1);
  }

  // 1x always; 2x only when the master actually has the pixels for it.
  const variants = [{ suffix: '', width: RENDER_W }];
  if (master.width >= RENDER_W * 2) {
    variants.push({ suffix: '@2x', width: RENDER_W * 2 });
  } else {
    lowRes++;
    const stale = join(out, `${stem}@2x.webp`);
    if (existsSync(stale)) unlinkSync(stale);
    console.warn(
      `  ! ${file} is ${master.width}px wide — under ${RENDER_W * 2}px, so NO 2x variant.\n` +
        `    Retina displays will upscale and the text will look soft. Recapture at 2x: pnpm capture`,
    );
  }

  const a = statSync(from).size;
  before += a;
  const parts = [];
  for (const v of variants) {
    const to = join(out, `${stem}${v.suffix}.webp`);
    await sharp(from)
      // lanczos3 (sharp's default) beats the browser's runtime downscale on
      // 1px-stroke UI text, and the 1x variant is a downscale in every case.
      .resize({ width: v.width, kernel: 'lanczos3' })
      .webp({ quality: QUALITY, alphaQuality: 100, effort: 6 })
      .toFile(to);
    const b = statSync(to).size;
    after += b;
    parts.push(`${stem}${v.suffix}.webp ${v.width}w ${kb(b)}`);
  }
  console.log(`${file} ${master.width}x${master.height} ${kb(a)} -> ${parts.join(' + ')}`);
}

console.log(`total ${kb(before)} master -> ${kb(after)} shipped`);
if (lowRes > 0) {
  console.log(
    `\n${lowRes} of ${files.length} master(s) are 1x. Those figures CANNOT be made\n` +
      `sharp by re-encoding — the detail is not in the file. Recapture at 2x\n` +
      `(${RATIO_W * 2}x${RATIO_H * 2}) with \`pnpm capture\`, then re-run this.`,
  );
}
