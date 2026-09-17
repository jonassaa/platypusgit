// Regenerates the site figures from the real app, headlessly.
//
//   pnpm shoot                 every scene
//   pnpm shoot history         one scene
//   pnpm shoot history --report   what fixtures that scene still wants
//
// It starts the rig's vite server, renders each scene in headless Chrome at
// device scale factor 2, composites the macOS window chrome, and writes
// site/screenshots/<figure>.png. Then run `pnpm screenshots` to encode.
//
// Why this exists rather than `pnpm capture`: that path needed a human on a
// Retina display to size a window and click it, which is why the figures went
// thirty days and 112 src/ commits out of date. See
// docs/superpowers/specs/2026-09-17-screenshot-rig-design.md.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import { composite, GEOM } from './composite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, '..', '..');
const repoRoot = resolve(siteDir, '..');
const outDir = join(siteDir, 'screenshots');
// OUTSIDE the vite root (which is `here`). Chrome's user-data-dir writes
// thousands of files; inside the served tree that fires vite's watcher, the
// page reloads in a loop and the screenshot never settles — it looks exactly
// like "Chrome produced nothing".
const tmpDir = join(os.tmpdir(), 'platypusgit-shoot');
const PORT = 1430;

const argv = process.argv.slice(2);
const report = argv.includes('--report');
const wanted = argv.filter((a) => !a.startsWith('-'));

// The scene list lives in TypeScript (it is typed against src/lib/types.ts), so
// read the names off the registry source rather than duplicating them here.
const registry = readFileSync(join(here, 'scenes', 'index.ts'), 'utf8');
const allScenes = [...registry.matchAll(/^\s{2}(\w+),$/gm)].map((m) => m[1]);
const scenes = wanted.length ? wanted : allScenes;

for (const s of scenes) {
  if (!allScenes.includes(s)) {
    console.error(`Unknown scene "${s}". Known: ${allScenes.join(', ')}`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "localhost", not "127.0.0.1": vite binds to localhost, which resolves to the
// IPv6 loopback on macOS, so an IPv4-only probe reports a live server as down
// and the driver starts a second one that then fails on strictPort.
function portOpen(port) {
  return new Promise((done) => {
    const sock = net.connect(port, 'localhost');
    sock.once('connect', () => (sock.destroy(), done(true)));
    sock.once('error', () => done(false));
    sock.setTimeout(500, () => (sock.destroy(), done(false)));
  });
}

async function waitForPort(port, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await portOpen(port)) return true;
    await sleep(300);
  }
  return false;
}

// Chrome WRITES THE PNG AND THEN DOES NOT EXIT in this environment. So: launch
// detached, poll for the file, then kill it. Treating the non-exit as failure
// throws away a screenshot that is already on disk.
async function shootOne(scene, bodyPath) {
  const profile = join(tmpDir, `profile-${scene}`);
  rmSync(profile, { recursive: true, force: true });
  rmSync(bodyPath, { force: true });

  const url =
    `http://localhost:${PORT}/?scene=${encodeURIComponent(scene)}` +
    (report ? '&report=1' : '');

  const child = spawn(
    join(here, 'chrome.sh'),
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      // CSS px; the scale factor doubles it into GEOM.window.
      `--window-size=${GEOM.window.w / 2},${GEOM.window.h / 2}`,
      `--screenshot=${bodyPath}`,
      // Lets fonts, the syntax worker and Shiki's grammar imports settle.
      '--virtual-time-budget=12000',
      // Each shot gets its OWN profile: re-using one across concurrent shots
      // collides and silently produces nothing.
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: 'ignore', detached: true },
  );

  const until = Date.now() + 90000;
  let ok = false;
  while (Date.now() < until) {
    // Wait for the size to stop changing, not merely for the file to appear:
    // Chrome creates it before it has finished writing.
    if (existsSync(bodyPath)) {
      const a = statSync(bodyPath).size;
      await sleep(400);
      if (a > 0 && existsSync(bodyPath) && statSync(bodyPath).size === a) {
        ok = true;
        break;
      }
    }
    await sleep(400);
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
  try {
    execFileSync('pkill', ['-f', profile], { stdio: 'ignore' });
  } catch {}
  rmSync(profile, { recursive: true, force: true });

  if (!ok) throw new Error(`Chrome produced no screenshot for scene "${scene}"`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

let server = null;
if (await portOpen(PORT)) {
  console.log(`Using the vite server already on :${PORT}`);
} else {
  console.log(`Starting the rig's vite server on :${PORT}…`);
  server = spawn(
    join(repoRoot, 'node_modules', '.bin', 'vite'),
    ['--config', join(here, 'vite.config.ts')],
    { cwd: repoRoot, stdio: 'ignore', detached: true },
  );
  if (!(await waitForPort(PORT))) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
    console.error(`vite never came up on :${PORT}`);
    process.exit(1);
  }
}

try {
  for (const scene of scenes) {
    // The figure's output name is declared in the scene, next to its content.
    const src = readFileSync(join(here, 'scenes', `${scene}.ts`), 'utf8');
    const figure = src.match(/figure:\s*"([^"]+)"/)?.[1];
    if (!figure) throw new Error(`scene "${scene}" declares no figure name`);

    const bodyPath = join(tmpDir, `${scene}-body.png`);
    process.stdout.write(`${scene} → `);
    await shootOne(scene, bodyPath);

    if (report) {
      // The overlay is already in the render; no chrome needed to read it.
      console.log(`fixture report at ${bodyPath}`);
      continue;
    }

    const out = join(outDir, `${figure}.png`);
    await composite(readFileSync(bodyPath), out);
    console.log(`${figure}.png ${GEOM.canvas.w}x${GEOM.canvas.h}`);
  }
} finally {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
}

if (!report) {
  console.log('\nNow encode them: pnpm screenshots');
}
