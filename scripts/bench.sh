#!/usr/bin/env bash
# The large-repo benchmark, end to end (issue 257).
#
#   pnpm bench                     # the three generated fixtures, published
#   pnpm bench --linux             # …and a real clone of torvalds/linux
#   pnpm bench --fixture deep      # one fixture only
#   pnpm bench --soak 60           # add a 60-minute soak per fixture
#   pnpm bench --no-publish        # measure and print; write nothing
#
# Three steps, each of which can be run on its own:
#
#   1. `scripts/bench-fixtures.mjs` materialises the repositories under
#      $PGBENCH_HOME (default ~/.cache/platypusgit-bench). Generated ones are
#      reused when their recorded shape still matches; `--force` regenerates.
#   2. `src-tauri/benches/repo_bench.rs` measures one repository and writes a
#      JSON document per fixture. It is behind `--features bench` so the Rust CI
#      gate never builds it.
#   3. `scripts/bench-report.mjs` renders those documents into
#      `docs/dev/benchmark.json`, the table block in `docs/dev/performance.md`
#      and the summary block in `README.md` — all three generated from one run,
#      all three re-rendered and compared by `test/benchmark.test.ts`. Commit
#      them together; a partial commit fails that guard by design.
#
# Publishing is the default because a benchmark nobody publishes is a benchmark
# nobody runs twice. `--no-publish` is for the case you are iterating on the
# harness itself and do not want a dirty tree.
#
# Run it on a QUIET machine. Every number here is wall clock, so a compile in
# another window is measured as this program being slow — and the published
# figures are the ones a stranger will check.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home="${PGBENCH_HOME:-$HOME/.cache/platypusgit-bench}"
results="$home/results"

fixtures=(deep wide refs)
want_linux=0
publish=1
soak=""
iterations=10
force=""

while [ $# -gt 0 ]; do
  case "$1" in
    --linux) want_linux=1 ;;
    --fixture) fixtures=("$2"); shift ;;
    --soak) soak="$2"; shift ;;
    --iterations) iterations="$2"; shift ;;
    --force) force="--force" ;;
    --no-publish) publish=0 ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ "$want_linux" = 1 ] && fixtures+=(linux)

# `cargo` and `node` are not on a non-interactive PATH on every machine this
# runs on; the repo's own toolchain locations are the fallback.
CARGO="${CARGO:-$(command -v cargo || echo "$HOME/.cargo/bin/cargo")}"

echo "==> fixtures ($home)"
node "$root/scripts/bench-fixtures.mjs" $force "${fixtures[@]}"

echo "==> building the harness"
"$CARGO" build --release --manifest-path "$root/src-tauri/Cargo.toml" \
  --features bench --bench repo_bench

mkdir -p "$results"
for name in "${fixtures[@]}"; do
  echo "==> $name"
  soak_args=()
  [ -n "$soak" ] && soak_args=(--soak-minutes "$soak")
  # Via `cargo bench` rather than the built path: a `harness = false` bench has
  # no stable file name (cargo appends a hash), and re-resolving it by globbing
  # picks up stale binaries from an earlier build.
  #
  # `${a[@]+"${a[@]}"}` rather than `"${a[@]}"`: under `set -u`, bash 3.2 — which
  # is what macOS ships — treats an EMPTY array's expansion as an unbound
  # variable and aborts. Without a soak, that is every run.
  "$CARGO" bench --quiet --manifest-path "$root/src-tauri/Cargo.toml" \
    --features bench --bench repo_bench -- \
    --repo "$home/$name" --name "$name" \
    --iterations "$iterations" \
    ${soak_args[@]+"${soak_args[@]}"} \
    --out "$results/$name.json"
done

# Deliberately NOT `--fixtures "${fixtures[*]}"`. The renderer publishes every
# result it finds, so `pnpm bench --fixture deep` refreshes deep and leaves the
# other three standing. Narrowing it to this run's list would have silently
# deleted `torvalds/linux` from the published record the first time somebody
# re-measured one fixture — the results are a record, not a snapshot of the last
# command anyone happened to type.
if [ "$publish" = 1 ]; then
  echo "==> publishing"
  node "$root/scripts/bench-report.mjs" --results "$results" --root "$root"
else
  echo "==> not publishing (--no-publish); raw results in $results"
  node "$root/scripts/bench-report.mjs" --results "$results" --root "$root" --print
fi
