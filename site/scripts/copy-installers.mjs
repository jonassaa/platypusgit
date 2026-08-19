// Copy the repo's `pgit` installer scripts into site/public/ so they are served
// at https://www.platypusgit.com/install-pgit.sh (and .ps1) — the URLs the
// download page's one-liners pipe into `sh` / `iex` (#144).
//
// Why a build step and not a committed copy: a second copy of a shell script
// drifts from the first, and the drifted one is the one users pipe into `sh`.
// This runs before every `dev` and `build`, so the served bytes ARE the repo's
// bytes by construction; the copies are gitignored so they can never be
// committed and reviewed as if they were the source.
//
// It is a plain byte copy — no templating, ever. The scripts must stay
// `curl … | sh`-safe (POSIX sh, `set -eu`, never reads stdin, because stdin IS
// the script), and a substitution pass here would be a way to break that
// without touching the file anyone reviews.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(siteDir);
const destDir = join(siteDir, 'public');

const INSTALLERS = ['install-pgit.sh', 'install-pgit.ps1'];

await mkdir(destDir, { recursive: true });

for (const name of INSTALLERS) {
  const from = join(repoRoot, 'scripts', name);
  // A missing or unreadable source must FAIL the build. The alternative — skip
  // it — deploys a 404 at a URL the page tells people to pipe into a shell,
  // or keeps serving a stale local copy after the source was renamed.
  await copyFile(from, join(destDir, name));
  console.log(`copy-installers: scripts/${name} -> site/public/${name}`);
}
