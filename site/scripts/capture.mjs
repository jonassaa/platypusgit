// Captures a platypusgit window into screenshots/<name>.png at 2x, ready for
// `pnpm screenshots`. macOS only — the shipped figures carry macOS window
// chrome, and this is the only platform whose screencapture(1) hands back the
// window with its drop shadow over a TRANSPARENT margin.
//
//   pnpm capture history-dark      # then click the app window
//
// Why this script exists rather than a line in the README. The old README said
// "capture at 1600x1112", which is a 1x capture of a ~1460pt window — and the
// site lays those figures out at 1040 CSS px, so every Retina visitor got a
// 1.3x upscale of 1x text. Nothing downstream can recover from that: the pixels
// were never in the file. The size of a capture is not a detail to leave to
// whoever is holding the mouse, so it is checked here.
//
// What you have to do by hand, because it is a design act and not a crop:
//   - Run the app on a Retina display (backing scale 2). An external 1x monitor
//     silently produces a 1x capture; this script rejects it.
//   - Size the window so it is REND_PT points wide. `pnpm capture --resize`
//     does it for you via System Events.
//   - Put the UI in the state the figure is meant to show, dark theme, and make
//     sure nothing personal is on screen — these end up on the landing page.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'screenshots');

// The window width, in POINTS, that the masters are captured at. At backing
// scale 2 that is a 3200px master, which is 2x the 1040 CSS px the figures are
// laid out at — so a Retina visitor paints it 1:1.
const REND_PT = 1600;
const RATIO = 1600 / 1112;
const WINDOW_PT = { width: REND_PT, height: Math.round(REND_PT / RATIO) };

if (process.platform !== 'darwin') {
  console.error(
    'macOS only: the shipped figures carry macOS window chrome, and only\n' +
      'screencapture(1) returns a window with its shadow on transparency.\n' +
      'Capture on a Mac, or hand-produce a 3200x2224 PNG in site/screenshots/.',
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const resizeOnly = argv.includes('--resize');
const name = argv.find((a) => !a.startsWith('-'));

if (!resizeOnly && !name) {
  console.error(
    'Usage: pnpm capture <name>      e.g. pnpm capture history-dark\n' +
      '       pnpm capture --resize   size the app window and exit\n\n' +
      'Existing figures (replacing one keeps its alt text valid):\n' +
      (existsSync(out)
        ? readdirSync(out)
            .filter((f) => f.endsWith('.png'))
            .map((f) => `  ${f.replace(/\.png$/, '')}`)
            .join('\n')
        : '  (none)'),
  );
  process.exit(1);
}

// Resize the app window to exactly WINDOW_PT via System Events. Needs
// Accessibility permission for the terminal, once; the error says so.
function resizeWindow() {
  const script = `
    tell application "System Events"
      if not (exists process "PlatypusGit") then error "PlatypusGit is not running"
      tell process "PlatypusGit"
        set frontmost to true
        set position of window 1 to {60, 60}
        set size of window 1 to {${WINDOW_PT.width}, ${WINDOW_PT.height}}
        return (size of window 1) as string
      end tell
    end tell`;
  try {
    const got = execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
    console.log(`window sized to ${got.replace(/,\s*/, 'x')} pt (wanted ${WINDOW_PT.width}x${WINDOW_PT.height})`);
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/not allowed assistive|osascript is not allowed/i.test(msg)) {
      console.error(
        'System Events was refused. Grant your terminal Accessibility access:\n' +
          '  System Settings -> Privacy & Security -> Accessibility\n' +
          `Or size the window to ${WINDOW_PT.width}x${WINDOW_PT.height} pt by hand and run without --resize.`,
      );
    } else if (/not running/.test(msg)) {
      console.error('PlatypusGit is not running. Launch it first (pgit . / pnpm tauri dev).');
    } else {
      console.error(msg.trim());
    }
    process.exit(1);
  }
}

if (resizeOnly) {
  resizeWindow();
  process.exit(0);
}

mkdirSync(out, { recursive: true });
const to = join(out, `${name}.png`);
const replacing = existsSync(to);

console.log(
  `${replacing ? 'Replacing' : 'Creating'} ${name}.png\n\n` +
    `  1. Put the app in the state this figure should show (dark theme).\n` +
    `  2. Window must be ${WINDOW_PT.width}x${WINDOW_PT.height} pt on a RETINA display.\n` +
    `     Run \`pnpm capture --resize\` first if you have not.\n` +
    `  3. Click the app window when the crosshair appears.\n`,
);

// -o drops the window's shadow from the ALPHA but keeps the transparent margin
//    around it, which is what Screenshot.astro relies on (it draws no frame).
// -w window mode, -a exclude other windows, -r no display-profile conversion.
try {
  execFileSync('screencapture', ['-w', '-o', '-a', '-r', to], { stdio: 'inherit' });
} catch {
  console.error('screencapture failed or was cancelled.');
  process.exit(1);
}

if (!existsSync(to) || statSync(to).size === 0) {
  console.error('Nothing captured (cancelled?). Nothing written.');
  process.exit(1);
}

// Verify we actually got 2x. A capture from a 1x external display looks fine
// in Preview and is useless on the site, so this is the whole point.
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
  return null;
}

const sharp = await loadSharp();
if (!sharp) {
  console.log(`Wrote ${to} (no sharp — dimensions unverified). Run \`pnpm screenshots\`.`);
  process.exit(0);
}

const { width, height } = await sharp(to).metadata();
const want = REND_PT * 2;
console.log(`\nWrote ${to} — ${width}x${height}`);

if (width < want) {
  const scale = (width / REND_PT).toFixed(2);
  console.error(
    `\nTOO SMALL: ${width}px wide, need >= ${want}px.\n` +
      `That is a ~${scale}x capture. Either the window was not ${REND_PT}pt wide,\n` +
      `or the display is not Retina (an external 1x monitor does this). The file\n` +
      `is kept so you can look at it, but re-encoding it will NOT make the site\n` +
      `sharp — recapture on the built-in display.`,
  );
  process.exit(1);
}

const ratio = (width / height).toFixed(4);
if (ratio !== RATIO.toFixed(4)) {
  console.warn(
    `\nAspect ratio ${ratio} is not ${RATIO.toFixed(4)} — the window was not\n` +
      `${WINDOW_PT.width}x${WINDOW_PT.height} pt. \`pnpm screenshots\` will refuse this until it\n` +
      `matches the other masters. Re-run with \`pnpm capture --resize\` first.`,
  );
  process.exit(1);
}

console.log(`Good — a true ${(width / REND_PT).toFixed(0)}x capture. Now: pnpm screenshots`);
