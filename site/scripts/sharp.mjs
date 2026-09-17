// Finding sharp, which is not a dependency of this site.
//
// astro declares sharp as an OPTIONAL dependency for its own image service, so
// it is already on disk after `pnpm install` — but pnpm's isolated node_modules
// does not hoist it, so a bare `import "sharp"` cannot see it from a script.
// Adding it to package.json would put a native binary in the deploy install for
// images that are already encoded and committed, so instead: look for it.
//
// One module rather than a copy per script, because the copies drifted. Both
// looked only at `lib/index.js`, and **sharp 0.35 moved its entry to
// `dist/index.mjs`** — so `pnpm screenshots` failed with "No sharp found" on
// any machine that resolved 0.35, which reads like a missing install rather
// than a moved file.
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Newest first, and both entry spellings.
const ENTRIES = [
  ['dist', 'index.mjs'], // sharp >= 0.35
  ['lib', 'index.js'], // sharp <= 0.34
];

export async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {}

  // site/scripts -> site, and the repo root: a worktree may have installed
  // either, and the rig runs from both.
  const roots = [
    resolve(here, '..', 'node_modules', '.pnpm'),
    resolve(here, '..', '..', 'node_modules', '.pnpm'),
  ];

  for (const pnpmDir of roots) {
    if (!existsSync(pnpmDir)) continue;
    // A pnpm directory name carries its peer suffix
    // ("sharp@0.35.4_@types+node@26.5.1"), so match the prefix, and prefer the
    // highest version when several are installed.
    const dirs = readdirSync(pnpmDir)
      .filter((d) => d.startsWith('sharp@'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const rel of ENTRIES) {
        const entry = join(pnpmDir, dir, 'node_modules', 'sharp', ...rel);
        if (existsSync(entry)) return (await import(pathToFileURL(entry).href)).default;
      }
    }
  }

  throw new Error(
    'No sharp found. Run `pnpm install` in site/ (astro brings sharp in as an\n' +
      'optional dependency), or install it yourself: `pnpm add -D sharp`.',
  );
}
