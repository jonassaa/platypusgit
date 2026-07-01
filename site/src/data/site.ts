export const site = {
  name: 'platypusgit',
  tagline: 'A dev-first git desktop app.',
  description:
    'Cross-platform, developer-focused git desktop app. Tauri 2 + React. A dev-first alternative to TortoiseGit with extreme usability as the north star.',
  repo: 'https://github.com/jonassaa/platypusgit',
  releases: 'https://github.com/jonassaa/platypusgit/releases',
  releasesLatest: 'https://github.com/jonassaa/platypusgit/releases/latest',
  buyMeACoffee: 'https://buymeacoffee.com/REPLACE_ME', // TODO: user supplies real URL
  license: 'GPL-3.0-only',
  author: 'Jonas Aasberg',
};

// Per-OS downloads shown on the landing page. `available: false` renders a
// non-clickable "Coming soon" button. Only macOS ships a build today.
export const downloads = [
  { key: 'macos', label: 'macOS', anchor: '/download#macos', note: 'Apple Silicon & Intel · .dmg', available: true },
  { key: 'windows', label: 'Windows', anchor: '/download#windows', note: 'Windows 10 & 11 · .msi', available: false },
  { key: 'linux', label: 'Linux', anchor: '/download#linux', note: '.deb & AppImage', available: false },
] as const;

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const nav = [
  { label: 'Features', href: `${base}/features` },
  { label: 'Download', href: `${base}/download` },
  { label: 'Changelog', href: `${base}/changelog` },
];
