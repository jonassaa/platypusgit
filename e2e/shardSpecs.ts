import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Splitting the e2e suite across CI runners (issue 189).
 *
 * The suite is not slow because it does too much — it is slow because
 * `wdio.conf.ts` must keep `maxInstances: 1`. Every spec file gets its own
 * WebDriver session, and an e2e-feature app binary serves WebDriver on a fixed
 * port (4445), so two app instances in one container fight over it. Parallelism
 * therefore has to happen across *runners*, one wdio process each.
 *
 * WebdriverIO's own `--shard x/y` exists, but it slices the alphabetical spec
 * list into equal-COUNT chunks (`ConfigParser.shard`). Measured against this
 * suite that is nearly the worst possible split: `keymap` (140 s), `palette`
 * (66 s) and `history-ops` (35 s) are alphabetical neighbours, so shard 2 of 4
 * came out at 256 s against 43 s for shard 4 — the critical path barely moves.
 * So this module packs by measured DURATION instead.
 *
 * Two properties matter more than the balance, and both are tested in
 * `test/shardSpecs.test.ts`:
 *
 * - **The spec list is derived from disk, never written down.** `listSpecFiles`
 *   walks `e2e/specs/`, so a spec added, renamed or deleted by another change
 *   is picked up with no edit here. A hardcoded filename list is how a
 *   concurrent PR would silently drop its own new spec from CI.
 * - **The split is a partition.** For any shard count, every spec runs in
 *   exactly one shard. `WEIGHTS` below only decides *which* one.
 *
 * `WEIGHTS` is therefore a HINT, not a manifest: an entry that no longer
 * matches a file is dead weight and an unlisted spec gets `DEFAULT_WEIGHT`.
 * Either way the suite still runs whole; only the balance degrades. Re-measure
 * it when the distribution has visibly drifted — see the header of `WEIGHTS`
 * for how.
 */

/** Wall-clock seconds per spec file, RUNNING → PASSED (so app launch, the
 *  conf `before` hook and teardown are all in the number, not just mocha's
 *  own total).
 *
 *  Measured from GitHub Actions run 32242497631 (push to `main`, 2026-08-19,
 *  ubuntu-latest + xvfb, warm caches). Re-measure with:
 *
 *      gh run view <id> --log \
 *        | grep -E '\[0-[0-9]+\] (RUNNING|PASSED) in' \
 *        | ...   # pair each RUNNING with its PASSED and diff the timestamps
 *
 *  Keys are BASENAMES, so a spec moved into a subdirectory keeps its weight. */
export const WEIGHTS: Readonly<Record<string, number>> = {
  "keymap.e2e.ts": 139.6,
  "repo-tabs.e2e.ts": 96.1,
  "palette.e2e.ts": 66.1,
  "settings.e2e.ts": 37.3,
  "history-diff.e2e.ts": 36.9,
  "history-ops.e2e.ts": 34.9,
  "stash.e2e.ts": 32.8,
  "bisect.e2e.ts": 32.3,
  "remote.e2e.ts": 7.5,
  "merge-window.e2e.ts": 7.4,
  "status-stage.e2e.ts": 5.3,
  "merge-conflict.e2e.ts": 4.5,
  "rebase.e2e.ts": 3.8,
  "branches.e2e.ts": 3.5,
  "keyboard-shortcuts.e2e.ts": 3.1,
  "drag-and-drop.e2e.ts": 3.1,
  "commit.e2e.ts": 2.1,
  "worktrees.e2e.ts": 2.0,
  "reflog.e2e.ts": 1.8,
  "submodules.e2e.ts": 1.7,
  "resizable-panes.e2e.ts": 1.7,
  "smoke.e2e.ts": 1.6,
  "create.e2e.ts": 1.3,
  "pulls.e2e.ts": 1.1,
  "open-persisted-screen.e2e.ts": 0.8,
  "harness.e2e.ts": 0.3,
};

/** What an unmeasured spec is assumed to cost.
 *
 *  The suite MEAN, not the median. The median spec is ~3 s and the mean ~20 s,
 *  because the distribution is dominated by a handful of long files — so
 *  guessing the median would routinely stack a genuinely slow new spec on top
 *  of an already-heavy shard, while guessing the mean only mis-balances a fast
 *  one. Being wrong here costs seconds of imbalance, never a dropped spec. */
export const DEFAULT_WEIGHT = 20;

export function weightOf(specPath: string): number {
  const base = specPath.split(/[\\/]/).pop() ?? specPath;
  return WEIGHTS[base] ?? DEFAULT_WEIGHT;
}

/**
 * The subset of `specs` that shard `shard` of `total` should run (both
 * one-based, matching `--shard x/y` and the workflow matrix).
 *
 * Longest-processing-time-first bin packing: heaviest spec first, each one onto
 * whichever shard is currently lightest. LPT's bound is
 * `max ≤ ideal + heaviest`, which is why the heaviest single spec sets the
 * floor for the whole gate no matter how many runners are thrown at it — at
 * the time of measuring that is `keymap.e2e.ts` at 140 s, and splitting THAT
 * file is the next lever, not more shards.
 *
 * Deterministic by construction, so a spec lands in the same shard run to run
 * and a shard failure is reproducible: ordering ties break on the path, and the
 * lightest-shard tie breaks on the lowest shard index. The returned list is
 * restored to the input's sorted order, so specs still run alphabetically
 * within a shard — the same relative order as an unsharded run.
 */
export function shardSpecs(
  specs: readonly string[],
  shard: number,
  total: number,
): string[] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard total must be a positive integer, got ${total}`);
  }
  if (!Number.isInteger(shard) || shard < 1 || shard > total) {
    throw new Error(`shard must be an integer in 1..${total}, got ${shard}`);
  }

  const sorted = [...specs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (total === 1) return sorted;

  const order = [...sorted].sort((a, b) => {
    const d = weightOf(b) - weightOf(a);
    return d !== 0 ? d : a < b ? -1 : 1;
  });

  const loads = new Array<number>(total).fill(0);
  const bins: string[][] = Array.from({ length: total }, () => []);
  for (const spec of order) {
    let pick = 0;
    for (let i = 1; i < total; i += 1) {
      if (loads[i] < loads[pick]) pick = i;
    }
    bins[pick].push(spec);
    loads[pick] += weightOf(spec);
  }

  const mine = new Set(bins[shard - 1]);
  return sorted.filter((s) => mine.has(s));
}

/**
 * Every spec file under `dir`, recursively, as absolute paths.
 *
 * Mirrors `wdio.conf.ts`'s `./specs/**` + `*.e2e.ts` glob rather than assuming
 * the directory is flat, so the two cannot disagree about what the suite is.
 * Kept in this module (and not inlined in the conf) so the shard invariants can
 * be asserted against the REAL tree from `test/`.
 */
export function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".e2e.ts")) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `E2E_SHARD` / `E2E_SHARDS` parsed, or null when this run is not sharded.
 *
 *  Env rather than a CLI flag because both the CI workflow and
 *  `docker-compose.e2e.yml` already thread env into the run, and because the
 *  conf must be able to keep its plain glob when nothing is set — an unsharded
 *  run has to stay byte-for-byte what it was. */
export function shardFromEnv(
  env: Record<string, string | undefined>,
): { shard: number; total: number } | null {
  const rawShard = env.E2E_SHARD?.trim();
  const rawTotal = env.E2E_SHARDS?.trim();
  if (!rawShard && !rawTotal) return null;
  if (!rawShard || !rawTotal) {
    throw new Error(
      "E2E_SHARD and E2E_SHARDS must be set together " +
        `(got E2E_SHARD=${rawShard ?? "<unset>"} E2E_SHARDS=${rawTotal ?? "<unset>"})`,
    );
  }
  const shard = Number(rawShard);
  const total = Number(rawTotal);
  if (!Number.isInteger(shard) || !Number.isInteger(total)) {
    throw new Error(
      `E2E_SHARD / E2E_SHARDS must be integers (got "${rawShard}" / "${rawTotal}")`,
    );
  }
  return { shard, total };
}
