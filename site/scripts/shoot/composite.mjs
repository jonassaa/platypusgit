// Puts the native macOS pixels back on a browser render.
//
// The app sets titleBarStyle "Overlay" + hiddenTitle, so it draws its ENTIRE
// titlebar in HTML. macOS contributes exactly two things: a drop shadow and
// three traffic lights. Chrome renders everything else, so this file is the
// whole native half of a figure.
//
// The geometry is not invented. It is 2x the shipped 2026-08-18 master,
// measured by alpha bounding box: a 1462x975 window in a 1600x1112 canvas,
// margins 69 left/right, 47 top, 90 bottom. Reproducing it exactly is what lets
// these figures drop into the site without touching Screenshot.astro, which
// hardcodes the 1600/1112 aspect to reserve the layout box before the bytes
// arrive.
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const GEOM = {
  canvas: { w: 3200, h: 2224 },
  window: { w: 2924, h: 1950 },
  margin: { left: 138, top: 94, right: 138, bottom: 180 },
  // macOS window corner radius is 10pt; at 2x that is 20px.
  radius: 20,
  // Traffic lights, measured off the master and doubled. macOS spaces them 20pt
  // apart at 6pt radius, inset 20pt from the left and 20pt down.
  lights: {
    cy: 40,
    r: 12,
    cx: [40, 80, 120],
    fill: ['#ff5f57', '#febc2e', '#28c840'],
  },
};

// sharp is a dev-machine tool, not a site dependency: astro brings it in as an
// OPTIONAL dependency for its own image service, but pnpm's isolated
// node_modules does not hoist it, so a bare import cannot see it. Same lookup
// screenshots.mjs already does.
export async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {}
  // Look in site/ and in the repo root — a worktree may have either installed.
  const roots = [
    resolve(here, '..', '..', 'node_modules', '.pnpm'),
    resolve(here, '..', '..', '..', 'node_modules', '.pnpm'),
  ];
  for (const pnpmDir of roots) {
    if (!existsSync(pnpmDir)) continue;
    // A pnpm dir name carries its peer suffix ("sharp@0.35.4_@types+node@26.5.1"),
    // so match the prefix and take the newest.
    const dirs = readdirSync(pnpmDir)
      .filter((d) => d.startsWith('sharp@'))
      .sort();
    for (const dir of dirs.reverse()) {
      // sharp 0.35 MOVED its entry: lib/index.js became dist/index.mjs. Trying
      // both is what keeps this working across that bump — the loaders in
      // screenshots.mjs and capture.mjs hardcode the old path and break on 0.35.
      for (const rel of [
        ['dist', 'index.mjs'],
        ['lib', 'index.js'],
      ]) {
        const entry = join(pnpmDir, dir, 'node_modules', 'sharp', ...rel);
        if (existsSync(entry)) return (await import(pathToFileURL(entry).href)).default;
      }
    }
  }
  throw new Error('No sharp found. Run `pnpm install` in site/.');
}

/**
 * @param {Buffer} bodyPng  the browser render, exactly GEOM.window
 * @param {string} outPath  where the 3200x2224 master goes
 */
export async function composite(bodyPng, outPath) {
  const sharp = await loadSharp();

  const meta = await sharp(bodyPng).metadata();
  if (meta.width !== GEOM.window.w || meta.height !== GEOM.window.h) {
    throw new Error(
      `body is ${meta.width}x${meta.height}, need exactly ` +
        `${GEOM.window.w}x${GEOM.window.h}. Chrome's --window-size is in CSS px ` +
        `and --force-device-scale-factor doubles it, so pass ` +
        `${GEOM.window.w / 2},${GEOM.window.h / 2}.`,
    );
  }

  const { w: W, h: H } = GEOM.canvas;
  const { w: winW, h: winH } = GEOM.window;
  const { left, top } = GEOM.margin;
  const R = GEOM.radius;

  // Round the body's corners: macOS clips the webview to the window shape, and
  // a square corner under a rounded shadow is the tell that a figure was
  // assembled rather than captured.
  const cornerMask = Buffer.from(
    `<svg width="${winW}" height="${winH}">` +
      `<rect width="${winW}" height="${winH}" rx="${R}" ry="${R}" fill="#fff"/></svg>`,
  );
  const roundedBody = await sharp(bodyPng)
    .composite([{ input: cornerMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // The drop shadow. macOS draws a soft, downward-biased shadow; the master's
  // asymmetric margins (94 top vs 180 bottom) are that bias. Offsetting the
  // shadow rect down by half the difference reproduces it.
  const shadowDy = (GEOM.margin.bottom - GEOM.margin.top) / 2;
  const shadowSvg = Buffer.from(
    `<svg width="${W}" height="${H}">` +
      `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feGaussianBlur stdDeviation="28"/></filter></defs>` +
      `<rect x="${left}" y="${top + shadowDy}" width="${winW}" height="${winH}" ` +
      `rx="${R}" ry="${R}" fill="#000" opacity="0.55" filter="url(#b)"/></svg>`,
  );

  // The three traffic lights, positioned relative to the window.
  const { cy, r, cx, fill } = GEOM.lights;
  const lightsSvg = Buffer.from(
    `<svg width="${W}" height="${H}">` +
      cx
        .map(
          (x, i) =>
            `<circle cx="${left + x}" cy="${top + cy}" r="${r}" fill="${fill[i]}"/>`,
        )
        .join('') +
      `</svg>`,
  );

  await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadowSvg, top: 0, left: 0 },
      { input: roundedBody, top, left },
      { input: lightsSvg, top: 0, left: 0 },
    ])
    .png()
    .toFile(outPath);
}
