// SEO copy + structured data. One place, so the per-page <meta> tags and the
// JSON-LD can never drift from each other.
import { site } from './site.ts';
import { changelog } from './features.ts';

// Absolute origin. Must match `site` in astro.config.mjs — schema.org URLs and
// og:image have to be absolute, relative ones are ignored by most crawlers.
export const ORIGIN = 'https://www.platypusgit.com';

export const OG_IMAGE = '/og.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_ALT =
  'platypusgit — a free, open source, dev-first git client for macOS, Windows and Linux.';

// One unique description per page. Duplicated descriptions across a site are a
// wasted signal: search engines pick their own snippet instead.
export const descriptions = {
  home:
    'platypusgit is a free, open source git client for macOS, Windows and Linux. ' +
    'A dev-first TortoiseGit alternative: keyboard-driven, native, no account, no paywall.',
  features:
    'Everything platypusgit does today — hunk staging, side-by-side diffs, blame, commit ' +
    'graph, interactive rebase, a three-pane conflict resolver, stashes, remotes and a command palette.',
  download:
    'Download platypusgit free for macOS (.dmg), Windows (.msi) or Linux (.deb / AppImage) — ' +
    'or build the open source git client from source.',
  changelog:
    'Release notes for platypusgit, the free open source git desktop client — what shipped ' +
    'in every version, newest first.',
  support:
    'Help platypusgit grow: star the repo, report bugs, request features, contribute code, ' +
    'sponsor development, or tell another developer about it.',
  privacy:
    'platypusgit collects nothing: no telemetry, no analytics, no account, no crash ' +
    'reporting. What it does contact, why, and the tests that keep it that way.',
} as const;

const latestVersion = changelog[0]?.version;

const author = { '@type': 'Person', name: site.author } as const;

/** Establishes the brand as a named site (Google's site-name feature reads this). */
export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: site.name,
  alternateName: 'PlatypusGit',
  url: `${ORIGIN}/`,
  description: descriptions.home,
  inLanguage: 'en',
  publisher: author,
};

/** The app itself — what a "free git client for <os>" query is actually looking for. */
export const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: site.name,
  alternateName: 'PlatypusGit',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Git client',
  operatingSystem: 'macOS, Windows, Linux',
  description: descriptions.home,
  url: `${ORIGIN}/`,
  downloadUrl: `${ORIGIN}/download/`,
  image: `${ORIGIN}${OG_IMAGE}`,
  screenshot: `${ORIGIN}${OG_IMAGE}`,
  ...(latestVersion ? { softwareVersion: latestVersion } : {}),
  license: `${site.repo}/blob/main/LICENSE`,
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author,
  maintainer: author,
  sameAs: [site.repo],
  codeRepository: site.repo,
  programmingLanguage: ['Rust', 'TypeScript'],
};
