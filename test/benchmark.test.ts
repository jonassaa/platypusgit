/**
 * @vitest-environment node
 */
// The published performance numbers are measured numbers (#257).
//
// The issue this whole benchmark answers is that "fast" was an adjective. The
// way an adjective grows back is not malice — it is somebody with a release to
// cut, a figure that reads badly, and a two-character edit to a JSON file that
// nobody diffs. So the two committed artifacts are generated from one run and
// this file is what makes that checkable:
//
//   * `docs/dev/benchmark.json` is the published record, written by
//     `scripts/bench-report.mjs`;
//   * the table block in `docs/dev/performance.md` is RENDERED from that JSON by
//     the same module;
//   * so is the summary block in `README.md`, which is the one that matters
//     most: the README's first line calls this app fast, and it is read a
//     thousand times for every reading of `performance.md`.
//
// Re-rendering here and comparing byte for byte means the two can only agree if
// both came out of one `pnpm bench`. Edit either by hand and this fails, naming
// the command that fixes it.
//
// It cannot check that the numbers are TRUE — nothing short of re-running the
// benchmark could, and that takes minutes and a quiet machine. What it checks is
// that they are *consistent* and that they *cover* what the document claims to
// cover. That is the realistic accident.
//
// Every input it reads (`test/`, `scripts/`, `docs/dev/`) is already in the `js`
// filter in `tests.yml`, and the last assertion in this file is that `docs/dev/`
// really is — because a guard skippable by exactly the change it polices is the
// #210 failure mode, and it has shipped here once.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BEGIN,
  END,
  OP_ORDER,
  README_BEGIN,
  README_END,
  renderMarkdown,
  renderReadme,
  // @ts-expect-error — plain .mjs with JSDoc types, no .d.ts
} from "../scripts/bench-report.mjs";

const root = (rel: string) => resolve(process.cwd(), rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");

const DATA_PATH = "docs/dev/benchmark.json";
const DOC_PATH = "docs/dev/performance.md";
const README_PATH = "README.md";

type Operation = {
  op: string;
  label: string;
  scale: string;
  samples: number;
  firstMs: number | null;
  repeatMedianMs: number | null;
  repeatP95Ms: number | null;
  gitCommand: string | null;
  gitInvocations: number;
  gitMedianMs: number | null;
  gitWorkMs: number | null;
  gitFloorBound: boolean;
  ratioToGit: number | null;
};

type Fixture = {
  key: string;
  title: string;
  kind: string;
  blurb: string;
  repository: {
    fixture: string;
    commits: number;
    trackedFiles: number;
    branches: number;
    tags: number;
    dirtyEntries: number;
  };
  operations: Operation[];
};

type Published = {
  measuredOn: string;
  machine: {
    cpu: string;
    cores: number;
    memoryGb: number;
    os: string;
    gitVersion: string;
  };
  iterations: number;
  budgetSeconds: number;
  gitSpawnFloorMs: number;
  fixtures: Fixture[];
};

const data: Published = JSON.parse(read(DATA_PATH));
const doc = read(DOC_PATH);
const readme = read(README_PATH);

/** The contents of a generated block, or `null` when a marker is missing. */
function block(text: string, begin: string, end: string): string | null {
  const a = text.indexOf(begin);
  const b = text.indexOf(end);
  return a === -1 || b <= a ? null : text.slice(a + begin.length, b).trim();
}

/** The operations every fixture must carry. Not the whole of `OP_ORDER`: two
 *  entries are conditional by design — `diff_workdir_file` needs a dirty tree
 *  and `file_history` needs HEAD to have touched a file — and a fixture that
 *  legitimately lacks one must not be made to fake it. These four are the ones
 *  the published claims rest on. */
const REQUIRED_OPS = ["open", "open_screen", "status", "log_first_page"];

describe("the published benchmark numbers", () => {
  it("renders exactly the table block that is committed in the doc", () => {
    const a = doc.indexOf(BEGIN);
    const b = doc.indexOf(END);
    expect(a, `${DOC_PATH} is missing its BEGIN marker`).toBeGreaterThan(-1);
    expect(b, `${DOC_PATH} is missing its END marker`).toBeGreaterThan(a);

    const committed = doc.slice(a + BEGIN.length, b).trim();
    expect(
      committed,
      `${DOC_PATH} and ${DATA_PATH} disagree. Neither is edited by hand — ` +
        "re-run `pnpm bench` (or `pnpm bench --linux`) and commit both.",
    ).toBe(renderMarkdown(data).trim());
  });

  it("re-renders exactly the summary block committed in the README", () => {
    const committed = block(readme, README_BEGIN, README_END);
    expect(
      committed,
      `${README_PATH} is missing its BENCHMARK SUMMARY markers`,
    ).not.toBeNull();
    expect(
      committed,
      `${README_PATH} and ${DATA_PATH} disagree. The README block is generated ` +
        "from the same record as the doc — re-run `pnpm bench` (or " +
        "`pnpm bench --linux`) and commit all three files together.",
    ).toBe(renderReadme(data).trim());
  });

  it("prints a real timing in every cell of the README table", () => {
    // The README carries three operations instead of twelve, and they are ones
    // `REQUIRED_OPS` already forces every fixture to publish. So a dash in a
    // timing column there never means "not applicable" — it means a fixture
    // stopped measuring something and the project's front page went quiet
    // about it. (The ratio column is exempt: a `git` baseline at the start-up
    // floor prints no ratio on purpose.)
    const rows = renderReadme(data)
      .split("\n")
      .filter((line: string) => line.startsWith("|"))
      .filter((line: string) => !/^\|[\s|:-]+\|$/.test(line))
      .slice(1);
    expect(rows).toHaveLength(data.fixtures.length);
    for (const row of rows) {
      const [name, ...rest] = row
        .split("|")
        .slice(1, -1)
        .map((c: string) => c.trim());
      for (const cell of rest.slice(0, 3)) {
        expect(cell, `${name} publishes no timing in the README table`).toMatch(
          /\d/,
        );
      }
    }
  });

  it("keeps hand-written numbers out of the README's Performance section", () => {
    // The prose around the block is written by a person, and a measured figure
    // copied into it is the exact regression this whole apparatus exists to
    // stop: the generated block moves on the next run and the sentence above it
    // does not. Numbers belong inside the markers, where re-rendering moves
    // them.
    const start = readme.indexOf("## Performance");
    expect(start, 'README has no "## Performance" section').toBeGreaterThan(-1);
    const rest = readme.slice(start + 1);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);
    const prose = section.slice(0, section.indexOf(README_BEGIN));

    const figures = prose.match(/\d[\d.,]*\s*(ms|s|×)\b/g) ?? [];
    expect(
      figures,
      "A measured figure is written by hand above the generated block. Put it " +
        "inside the markers, or say it without a number.",
    ).toEqual([]);
  });

  it("names the machine and the day it was measured", () => {
    // A performance number with no machine beside it is not a measurement, it
    // is a boast, and it is the first thing a reader checks.
    expect(data.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.machine.cpu.length).toBeGreaterThan(3);
    expect(data.machine.gitVersion).toMatch(/^git version /);
    expect(data.machine.cores).toBeGreaterThan(0);
    expect(data.iterations).toBeGreaterThan(1);
    expect(data.budgetSeconds).toBeGreaterThan(0);
  });

  it("measured something on every fixture", () => {
    expect(data.fixtures.length).toBeGreaterThan(0);
    for (const fixture of data.fixtures) {
      const ops = new Set(fixture.operations.map((o) => o.op));
      const missing = REQUIRED_OPS.filter((op) => !ops.has(op));
      expect(
        missing,
        `${fixture.key} published no ${missing.join(", ")}. A run that measured ` +
          "nothing publishes excellent numbers for nothing at all.",
      ).toEqual([]);

      // The scale column is what lets a reader sanity-check a timing. A blank
      // one, or a timing with no positive duration, means the harness measured
      // an empty result and reported it as fast.
      for (const op of fixture.operations) {
        expect(op.scale, `${fixture.key}/${op.op} has no result size`).not.toBe("");
        expect(
          op.repeatMedianMs,
          `${fixture.key}/${op.op} has no repeat median`,
        ).not.toBeNull();
        expect(op.repeatMedianMs!).toBeGreaterThan(0);

        // The time box can cut an expensive operation down to three repeats,
        // and three is the floor on purpose: a median of two is the mean of
        // two. A row below it means the box was misconfigured, not that the
        // operation was fast.
        expect(
          op.samples,
          `${fixture.key}/${op.op} published a median over ${op.samples} samples`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("publishes only operations the report knows how to order", () => {
    // An op the renderer does not know about sorts to the end silently, which
    // is how a new measurement gets added and then quietly read as the least
    // important thing in the table.
    const unknown = [
      ...new Set(data.fixtures.flatMap((f) => f.operations.map((o) => o.op))),
    ].filter((op) => !OP_ORDER.includes(op));
    expect(
      unknown,
      `Not in OP_ORDER in scripts/bench-report.mjs: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("prints no ratio when process start-up swamped the baseline", () => {
    // The floor is real and large — over ten milliseconds on an M-series Mac,
    // which is more than most of these operations take in total. A ratio
    // against a baseline that is mostly `fork` would put a hundred-fold win in
    // the table for an operation on an empty result: an adjective wearing a
    // number.
    expect(data.gitSpawnFloorMs).toBeGreaterThan(0);
    for (const fixture of data.fixtures) {
      for (const op of fixture.operations) {
        if (!op.gitFloorBound) continue;
        expect(
          op.ratioToGit,
          `${fixture.key}/${op.op} prints a ratio against a baseline at the ` +
            "`git` start-up floor",
        ).toBeNull();
      }
    }
  });

  it("divides by git's work, never by its wall clock", () => {
    // The ratio must be against the baseline MINUS process start-up, which is
    // the harsher comparison — we pay no start-up, so dividing by git's wall
    // clock would hand us a free head start on every row.
    for (const fixture of data.fixtures) {
      for (const op of fixture.operations) {
        if (op.ratioToGit == null) continue;
        expect(op.gitWorkMs, `${fixture.key}/${op.op}`).not.toBeNull();
        expect(op.gitWorkMs!).toBeLessThanOrEqual(op.gitMedianMs!);
        expect(
          op.ratioToGit,
          `${fixture.key}/${op.op} did not divide by gitWorkMs`,
        ).toBeCloseTo(op.repeatMedianMs! / op.gitWorkMs!, 5);
      }
    }
  });

  it("records the git command behind every ratio it prints", () => {
    // A "3× git" with no command beside it is an argument nobody can check.
    for (const fixture of data.fixtures) {
      for (const op of fixture.operations) {
        if (op.ratioToGit == null) continue;
        expect(
          op.gitCommand,
          `${fixture.key}/${op.op} prints a ratio with no baseline command`,
        ).toMatch(/^git /);
      }
    }
  });

  it("is reachable from the docs the assistant reads", () => {
    // `docs.test.ts` pins the module and command lists; this pins the one
    // pointer that makes the benchmark findable at all.
    expect(read("CLAUDE.md")).toContain("docs/dev/performance.md");
  });
});

describe("CI runs this guard when its inputs change", () => {
  it("has docs/dev/ in the js path filter", () => {
    // The #210 failure mode: a guard lands, its input is not in the filter, and
    // the next PR touching only that input runs no suite at all and reports
    // green. Both of this file's inputs — the document and the record beside it
    // — are under `docs/dev/`, which is why the record lives there and not
    // somewhere that would need a filter entry of its own.
    const workflow = read(".github/workflows/tests.yml");
    expect(
      workflow,
      "`docs/dev/` left the `js` filter in tests.yml, so a benchmark-only " +
        "commit now skips the guard that holds its numbers together.",
    ).toContain("docs/dev/");
  });

  it("has README.md in the js path filter", () => {
    // Same story, and #210 was literally a README-only PR that ran no suite at
    // all. The README is now an input of this file too, so the entry it already
    // has for `comparison.test.ts` is load-bearing twice over.
    const workflow = read(".github/workflows/tests.yml");
    expect(
      workflow,
      "`README.md` left the `js` filter in tests.yml, so editing the published " +
        "performance figures by hand now skips the guard that catches it.",
    ).toMatch(/README\\?\.md\$/);
  });
});
