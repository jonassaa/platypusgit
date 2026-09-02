export const site = {
  name: 'platypusgit',
  tagline: 'A dev-first git desktop app.',
  description:
    'Cross-platform, developer-focused git desktop app. Tauri 2 + React. A dev-first alternative to TortoiseGit with extreme usability as the north star.',
  repo: 'https://github.com/jonassaa/platypusgit',
  releases: 'https://github.com/jonassaa/platypusgit/releases',
  releasesLatest: 'https://github.com/jonassaa/platypusgit/releases/latest',
  buyMeACoffee: 'https://buymeacoffee.com/jonassaa', // kept in sync with ../.github/FUNDING.yml
  license: 'GPL-3.0-only',
  author: 'Jonas Aasberg',
};

// Per-OS downloads shown on the landing page. `available: false` renders a
// non-clickable "Coming soon" button. macOS, Windows, and Linux all ship
// builds via the release workflow.
export const downloads = [
  { key: 'macos', label: 'macOS', anchor: '/download/#macos', note: 'Apple Silicon & Intel · .dmg', available: true },
  { key: 'windows', label: 'Windows', anchor: '/download/#windows', note: 'Windows 10 & 11 · .msi or Scoop', available: true },
  { key: 'linux', label: 'Linux', anchor: '/download/#linux', note: '.deb & AppImage', available: true },
] as const;

// Direct download links to the stable-named assets the release workflow
// attaches to every published GitHub Release (releases/latest/download/...).
const releaseAsset = (file: string) => `${site.releases}/latest/download/${file}`;
export const assets = {
  macosDmg: releaseAsset('PlatypusGit_universal.dmg'),
  windowsMsi: releaseAsset('PlatypusGit_x64.msi'),
  linuxDeb: releaseAsset('PlatypusGit_amd64.deb'),
  linuxAppImage: releaseAsset('PlatypusGit_amd64.AppImage'),
};

// The Scoop bucket (#187, Windows half). Its own repo, like the Homebrew tap and
// the apt repo — but unlike the apt repo it needs no host of its own, because
// `scoop bucket add` clones a git repository rather than fetching an index.
//
// Deliberately NOT offering `assets.windowsPortableZip` here: the zip exists so
// Scoop has something to install, and advertising it as its own download route
// would create a class of user with no package manager AND no installer, whose
// in-app update would land a second copy in Program Files. The page offers the
// .msi and Scoop.
export const scoop = {
  bucket: 'https://github.com/jonassaa/scoop-platypusgit',
  // The name `scoop bucket add` registers it under, and the manifest's own
  // basename — which is also the directory Scoop installs into, and therefore
  // what `update::is_scoop_layout` matches on. Three things, one string.
  bucketName: 'platypusgit',
  pkg: 'platypusgit',
};

// The APT repository (#187). Its own repo + GitHub Pages host, NOT this site:
// site.yml uploads site/dist as the whole Pages artifact, so every deploy here
// would wipe a pool that the release job pushed in out of band.
export const apt = {
  // Kept in sync with scripts/install-platypusgit.sh's DEFAULT_APT_URL and
  // scripts/apt-repo-seed/CNAME.
  url: 'https://apt.platypusgit.com',
  // The Debian package name — derived by Tauri from `productName` via
  // heck::AsKebabCase, so a lowercase productName maps straight through.
  // The former `platypus-git` still resolves via the .deb's `Provides:`.
  pkg: 'platypusgit',
  // Fingerprint of the repository signing key, printed on the download page so
  // it is verifiable against something other than the script that installed it.
  // Empty until the key exists — scripts/apt-repo-wizard.sh prints it and says
  // to paste it here. The page renders the block only when this is non-empty,
  // so an unset value shows nothing rather than a placeholder that reads as a
  // real fingerprint.
  keyFingerprint: '294C261A1641704535EAC137DDA53BD2C15FB1FB',
};

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

// Trailing slashes are deliberate — the bare form 301s on GitHub Pages.
export const nav = [
  { label: 'Features', href: `${base}/features/` },
  { label: 'Download', href: `${base}/download/` },
  { label: 'Changelog', href: `${base}/changelog/` },
];
