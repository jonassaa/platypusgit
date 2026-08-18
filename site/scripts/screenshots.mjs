// Encodes the app captures in screenshots/*.png to public/screenshots/*.webp.
// Run after replacing a capture: `pnpm screenshots`.
//
// Same arrangement as `pnpm og`: the encoded file is COMMITTED, so CI never
// runs this and `astro build` needs no image pipeline. The masters stay in
// screenshots/ (outside src/ and public/, so Astro neither processes nor
// deploys them) — a future recrop or requality then needs no recapture.
//
// Why WebP at q85 and not the PNG: 1741 KB -> 345 KB for the three, with no
// visible difference at 1:1 on the smallest text in the densest capture, and
// the window is displayed at ~0.65x of its captured width on a 1x screen
// anyway. Lossless WebP was measured too (779 KB); it is not worth 434 KB on a
// landing page. Alpha is preserved at alphaQuality 100 — the captures are a
// window over a TRANSPARENT margin with a baked drop shadow, and that shadow
// is what lets one dark asset sit on the light theme.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'screenshots');
const out = resolve(here, '..', 'public', 'screenshots');
const QUALITY = 85;

// sharp is a dev-machine tool here, not a dependency. It is already on disk
// after `pnpm install`, because astro declares it as an OPTIONAL dependency
// for its own image service — but pnpm's isolated node_modules does not hoist
// it, so a bare `import 'sharp'` cannot see it from this script. Look in both
// places rather than making the site depend on it: adding it to package.json
// would put a native binary in the deploy install for three images that are
// already encoded.
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

let before = 0;
let after = 0;
for (const file of files) {
  const from = join(src, file);
  const to = join(out, file.replace(/\.png$/, '.webp'));
  await sharp(from).webp({ quality: QUALITY, alphaQuality: 100, effort: 6 }).toFile(to);
  const { width, height } = await sharp(to).metadata();
  const a = statSync(from).size;
  const b = statSync(to).size;
  before += a;
  after += b;
  console.log(
    `${file} ${(a / 1024).toFixed(0)}KB -> ${to.split('/').pop()} ` +
      `${width}x${height} ${(b / 1024).toFixed(0)}KB (${((100 * b) / a).toFixed(0)}%)`,
  );
}
console.log(
  `total ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB ` +
    `(${((100 * after) / before).toFixed(0)}%)`,
);
