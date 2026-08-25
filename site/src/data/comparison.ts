// The competitor comparison (#210), shown twice: as a markdown table in the
// README and as a real table on /features.
//
// THE CELLS LIVE IN `comparison.json`, not here. `test/comparison.test.ts` (the
// root vitest `docs` project) reads that JSON and fails the build when the
// README's table, its checked-on date, its runtime note, or its source links
// disagree with it. JSON rather than a TS literal only because the root package
// cannot import this directory's TypeScript — the site's tsconfig extends
// Astro's, which the root package does not have. This file adds the types the
// site renders against, and is where the reasoning is written down.
//
// Every claim about another vendor cites that vendor's own page. When you
// re-verify, re-read those pages, fix the cells, and then move `checkedOn` —
// never move the date without re-reading, because the date IS the claim. A
// comparison table is the first thing a competitor's users fact-check, and a
// cell that is quietly wrong costs more than no table at all.
//
// Keep our own row conservative. Understating our maturity costs nothing.

import data from './comparison.json';

export type ComparisonRow = {
  /** Product name. `us: true` marks our row so surfaces can style it. */
  name: string;
  /** Vendor home or pricing page. Absent for our own row. */
  href?: string;
  us?: boolean;
  price: string;
  account: string;
  telemetry: string;
  platforms: string;
  licence: string;
};

export type ComparisonSource = {
  vendor: string;
  /** Label → the vendor page that backs the cells above. */
  links: { label: string; url: string }[];
};

/** The day the cells were last read off the vendors' own pages. */
export const checkedOn: string = data.checkedOn;

/**
 * The one claim that does not fit a cell. Kept beside the table so the README
 * and the site make it in the same words.
 */
export const runtimeNote: string = data.runtimeNote;

export const comparisonRows: ComparisonRow[] = data.rows;

export const comparisonSources: ComparisonSource[] = data.sources;
