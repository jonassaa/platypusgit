#!/usr/bin/env bash
# Drive the headless-e2e container (see docker-compose.e2e.yml). Derives a
# unique compose project name from this checkout's directory so multiple
# agents can run the suite in parallel from different worktrees without their
# node_modules/target/.bin volumes colliding. Package caches are shared (fixed
# volume names in the compose file).
#
# Usage (args forward to the container entrypoint → wdio):
#   e2e/e2e-docker.sh                              # full: build binary + whole suite
#   e2e/e2e-docker.sh full --spec e2e/specs/X.e2e.ts
#   e2e/e2e-docker.sh run  --spec e2e/specs/X.e2e.ts   # reuse this worktree's snapshot
#   e2e/e2e-docker.sh build                        # rebuild snapshot only
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Sanitize the checkout dir name into a valid compose project slug
# ([a-z0-9_-]). Worktree dirs like "chore+e2e-docker" → "chore-e2e-docker".
slug="$(basename "$root" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -c 'a-z0-9_-' '-' \
  | sed 's/-\{2,\}/-/g; s/^-//; s/-$//')"
export COMPOSE_PROJECT_NAME="pgit-e2e-${slug:-default}"

echo "[e2e-docker] project=${COMPOSE_PROJECT_NAME} root=${root}" >&2
exec docker compose -f "$root/docker-compose.e2e.yml" run --rm --build e2e "$@"
