/**
 * @vitest-environment node
 */
// The comparison table appears twice — as markdown in the README and as a real
// table on /features (#210) — so it is exactly the shape of thing that drifts:
// somebody re-checks GitKraken's pricing page, fixes the README, and the site
// keeps saying last year's price for a year.
//
// `site/src/data/comparison.json` is the source of truth. The site renders it
// through `comparison.ts`, so the site cannot drift. This test makes the README
// unable to drift either: it parses the README's "How it compares" table and
// asserts, cell by cell, that it says what the data says, that the checked-on
// date and the runtime note match, and that every vendor source URL in the data
// is actually cited in the README.
//
// The data is read as JSON rather than imported from `comparison.ts` on
// purpose: that module lives under `site/`, whose tsconfig extends Astro's, and
// the root package has no astro to resolve it with — importing it fails the
// suite before a single assertion runs.
//
// What this does NOT check is whether the claims are TRUE — no test can. The
// date is the claim there: when you re-verify against the vendors' own pages,
// move `checkedOn`; never move it without re-reading them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = (rel: string) => resolve(process.cwd(), rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");

type ComparisonRow = {
  name: string;
  price: string;
  account: string;
  telemetry: string;
  platforms: string;
  licence: string;
};
type ComparisonSource = { vendor: string; links: { label: string; url: string }[] };

const data = JSON.parse(read("site/src/data/comparison.json")) as {
  checkedOn: string;
  runtimeNote: string;
  rows: ComparisonRow[];
  sources: ComparisonSource[];
};
const { checkedOn, runtimeNote, rows: comparisonRows, sources: comparisonSources } = data;

const readme = read("README.md");

// The section runs from its heading to the next `## ` heading.
const section = (() => {
  const start = readme.indexOf("## How it compares");
  expect(start, 'README has no "## How it compares" section').toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
})();

/**
 * Markdown emphasis and links are presentation, not claim: `**$59.99** once`
 * and `[Fork](https://fork.dev/)` have to compare equal to the plain strings in
 * the data. Collapsing whitespace lets the README wrap its prose freely.
 */
const plain = (md: string) =>
  md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

const tableRows = section
  .split("\n")
  .filter((line) => line.trimStart().startsWith("|"))
  // A `|---|---|` separator is layout, not data.
  .filter((line) => !/^\s*\|[\s|:-]+\|\s*$/.test(line))
  .map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(plain),
  );

describe("README comparison table matches site/src/data/comparison.ts", () => {
  it("has a header row with the columns the data carries", () => {
    expect(tableRows.length).toBeGreaterThan(0);
    expect(tableRows[0]).toEqual([
      "",
      "Price",
      "Account",
      "Telemetry",
      "Platforms",
      "Licence",
    ]);
  });

  it("lists the same clients, in the same order", () => {
    expect(tableRows.slice(1).map((cells) => cells[0])).toEqual(
      comparisonRows.map((r) => r.name),
    );
  });

  it.each(comparisonRows)("says the same things about $name", (row) => {
    const cells = tableRows.slice(1).find((c) => c[0] === row.name);
    expect(cells, `no README row for ${row.name}`).toBeDefined();
    expect(cells!.slice(1)).toEqual([
      row.price,
      row.account,
      row.telemetry,
      row.platforms,
      row.licence,
    ]);
  });

  it("carries the same checked-on date", () => {
    expect(plain(section)).toContain(checkedOn);
  });

  it("carries the runtime note in the same words", () => {
    expect(plain(section)).toContain(plain(runtimeNote));
  });

  // Matched against the exact set of link targets, not with `toContain`: a
  // substring test passes a typo'd or truncated URL whenever the real one is a
  // prefix of it (`…/privacy` "matches" `…/privacy-oops`), which is precisely
  // the drift worth catching. The README's own row cites the repository with
  // relative links (`./LICENSE`), so only the vendor claims are checked here.
  const cited = new Set(
    [...section.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  );

  it.each(comparisonSources)("cites every source for $vendor", (source) => {
    for (const link of source.links) {
      expect(
        cited,
        `README does not link ${link.url} — cited: ${[...cited].join(", ")}`,
      ).toContain(link.url);
    }
  });
});
