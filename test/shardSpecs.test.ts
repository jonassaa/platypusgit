import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_WEIGHT,
  listSpecFiles,
  shardFromEnv,
  shardSpecs,
  weightOf,
} from "../e2e/shardSpecs";

/**
 * The e2e suite is sharded across CI runners (issue 189), and the shard split is
 * the one piece of CI plumbing whose failure mode is SILENT: a spec that lands
 * in no shard simply never runs, and the gate goes green.
 *
 * So this suite asserts the split is a partition of what is actually on disk,
 * for the shard count the workflow actually uses. It lives in `test/` for the
 * same reason `docs.test.ts` does — it asserts a fact about the tree (and about
 * `.github/`), not about the frontend, and it needs node rather than the jsdom
 * component harness.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SPECS_DIR = path.join(REPO_ROOT, "e2e", "specs");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "e2e.yml");

/** The shard count from the workflow matrix — the ONE place it is written down
 *  (the run step reads its total from `strategy.job-total`). Regex rather than a
 *  YAML parser to avoid a dependency for one line; the matrix therefore has to
 *  keep the array on one line, which the workflow comment says. */
function matrixShards(): number[] {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const m = yaml.match(/^\s*shard:\s*\[([^\]]*)\]\s*$/m);
  if (!m) {
    throw new Error(
      "no single-line `shard: [ ... ]` matrix found in .github/workflows/e2e.yml — " +
        "the e2e matrix moved or was reformatted, so this suite can no longer " +
        "check that every spec lands in a shard",
    );
  }
  return m[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

/** Every spec runs exactly once across shards 1..total. */
function partitionOf(specs: string[], total: number): string[] {
  const seen: string[] = [];
  for (let shard = 1; shard <= total; shard += 1) {
    seen.push(...shardSpecs(specs, shard, total));
  }
  return seen;
}

describe("e2e shard split", () => {
  const specs = listSpecFiles(SPECS_DIR);

  it("finds the spec files on disk", () => {
    // A walk that silently returns nothing would make every partition
    // assertion below vacuously true.
    expect(specs.length).toBeGreaterThan(10);
    expect(specs.every((s) => s.endsWith(".e2e.ts"))).toBe(true);
  });

  it("is a partition of the real suite at the workflow's shard count", () => {
    const shards = matrixShards();
    // 1..N, in order — the run step passes `matrix.shard` straight through as
    // the one-based shard number, so a gap or a zero would skip a slice.
    expect(shards).toEqual(shards.map((_, i) => i + 1));

    const seen = partitionOf(specs, shards.length);
    expect([...seen].sort()).toEqual([...specs].sort());
    expect(new Set(seen).size).toBe(specs.length);
  });

  it("is a partition at every shard count up to the spec count", () => {
    for (let total = 1; total <= specs.length; total += 1) {
      const seen = partitionOf(specs, total);
      expect(new Set(seen).size, `total=${total}`).toBe(specs.length);
      expect(seen.length, `total=${total}`).toBe(specs.length);
      // No shard may be empty while there are at least as many specs as
      // shards, or a runner would spin up to test nothing.
      for (let shard = 1; shard <= total; shard += 1) {
        expect(
          shardSpecs(specs, shard, total).length,
          `shard ${shard}/${total}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps a spec in the same shard run to run", () => {
    expect(shardSpecs(specs, 2, 4)).toEqual(shardSpecs(specs, 2, 4));
    // ...and independent of the order the caller happened to walk the dir in.
    expect(shardSpecs([...specs].reverse(), 2, 4)).toEqual(
      shardSpecs(specs, 2, 4),
    );
  });

  it("runs specs in the same relative order as an unsharded run", () => {
    const mine = shardSpecs(specs, 3, 4);
    expect(mine).toEqual(specs.filter((s) => mine.includes(s)));
  });

  it("still runs a spec nobody has measured", () => {
    // The invariant that lets a concurrent PR add a spec without touching
    // WEIGHTS: an unmeasured file is weighted, placed and run like any other.
    const added = path.join(SPECS_DIR, "brand-new-feature.e2e.ts");
    expect(weightOf(added)).toBe(DEFAULT_WEIGHT);
    const withNew = [...specs, added].sort();
    const seen = partitionOf(withNew, 4);
    expect(seen.filter((s) => s === added)).toEqual([added]);
    expect(new Set(seen).size).toBe(withNew.length);
  });

  it("balances by measured duration, not by file count", () => {
    // The whole reason this module exists instead of wdio's own `--shard`.
    // LPT's guarantee is max ≤ ideal + heaviest, so assert exactly that — a
    // packer that dumped everything into shard 1 would blow it, and so would
    // one that split alphabetically.
    const total = 4;
    const loads: number[] = [];
    for (let shard = 1; shard <= total; shard += 1) {
      loads.push(
        shardSpecs(specs, shard, total).reduce((n, s) => n + weightOf(s), 0),
      );
    }
    const sum = loads.reduce((a, b) => a + b, 0);
    const heaviest = Math.max(...specs.map(weightOf));
    expect(Math.max(...loads)).toBeLessThanOrEqual(sum / total + heaviest);
    // And every runner gets real work: the lightest shard is not a rounding
    // error next to the ideal.
    expect(Math.min(...loads)).toBeGreaterThan(0);
  });

  it("rejects a shard number outside the matrix", () => {
    expect(() => shardSpecs(specs, 0, 4)).toThrow();
    expect(() => shardSpecs(specs, 5, 4)).toThrow();
    expect(() => shardSpecs(specs, 1, 0)).toThrow();
    expect(() => shardSpecs(specs, 1.5, 4)).toThrow();
  });
});

describe("shardFromEnv", () => {
  it("is null when nothing is set, so a local run keeps the plain glob", () => {
    expect(shardFromEnv({})).toBeNull();
    expect(shardFromEnv({ E2E_SHARD: "", E2E_SHARDS: "" })).toBeNull();
  });

  it("parses a matrix pair", () => {
    expect(shardFromEnv({ E2E_SHARD: "2", E2E_SHARDS: "4" })).toEqual({
      shard: 2,
      total: 4,
    });
  });

  it("refuses a half-configured run rather than silently running everything", () => {
    // Half-set means an editing mistake in the workflow. Running the WHOLE
    // suite in all four jobs would still be green, so it has to be loud.
    expect(() => shardFromEnv({ E2E_SHARD: "2" })).toThrow(/together/);
    expect(() => shardFromEnv({ E2E_SHARDS: "4" })).toThrow(/together/);
    expect(() =>
      shardFromEnv({ E2E_SHARD: "one", E2E_SHARDS: "4" }),
    ).toThrow(/integers/);
  });
});
