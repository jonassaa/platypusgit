#!/usr/bin/env bash
# Container entrypoint for headless e2e. node_modules / target / e2e/.bin live
# in named volumes (see docker-compose.e2e.yml) so Linux artifacts never
# clobber the host's macOS ones. First arg selects the phase; extra args pass
# through to wdio (e.g. --spec).
set -euo pipefail

# node_modules is a fresh volume on first run — install is a fast no-op once the
# lockfile is satisfied.
pnpm install --frozen-lockfile

phase="${1:-full}"
shift || true

case "$phase" in
  full)
    pnpm test:e2e:build
    xvfb-run --auto-servernum pnpm test:e2e:run "$@"
    ;;
  build)
    pnpm test:e2e:build
    ;;
  run)
    # Reuses the e2e/.bin snapshot from a prior `build`/`full`. Pass
    # --spec e2e/specs/<file>.e2e.ts to scope.
    xvfb-run --auto-servernum pnpm test:e2e:run "$@"
    ;;
  *)
    echo "unknown phase '$phase' (expected: full | build | run)" >&2
    exit 2
    ;;
esac
