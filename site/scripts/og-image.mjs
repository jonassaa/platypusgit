// Renders scripts/og-image.html to public/og.png (1200x630) with headless
// Chrome. Run after editing the template: `pnpm og`.
//
// Chrome is a dev-machine tool here, not a dependency: the PNG is committed, so
// CI never runs this and contributors without Chrome are unaffected.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = resolve(here, 'og-image.html');
const out = resolve(here, '..', 'public', 'og.png');

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH to its binary.');
  process.exit(1);
}

execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${out}`,
    '--allow-file-access-from-files',
    `file://${template}`,
  ],
  { stdio: 'inherit' },
);

console.log(`wrote ${out}`);
