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

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const nav = [
  { label: 'Features', href: `${base}/features` },
  { label: 'Download', href: `${base}/download` },
  { label: 'Changelog', href: `${base}/changelog` },
];
