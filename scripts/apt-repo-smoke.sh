#!/bin/sh
# Prove an APT repository tree actually installs, before anyone publishes it (#187).
#
# Serves a repository directory over HTTP and installs from it inside a clean
# debian:bookworm container, then asserts what landed. Used two ways:
#
#   - by release.yml's `apt-publish` job as a HARD GATE before the push, so a
#     broken index cannot reach users;
#   - by a developer against a scratch directory, which is the only way to
#     exercise any of this on macOS.
#
#   scripts/apt-repo-smoke.sh --repo <dir> --version 0.0.18 \
#       --installer scripts/install-platypusgit.sh
#
# TWO CONTAINERS, ONE PRIVATE NETWORK. The server is a container rather than a
# host process so this script behaves the same on Docker Desktop (where the host
# is not reachable at 127.0.0.1 from inside a container) and on a Linux runner —
# one code path, and no python dependency on the host.
#
# The client container is deliberately CLEAN. It installs curl and
# ca-certificates and nothing else, so the run proves what the download page
# claims: that adding the repository needs no gnupg, because the served key is
# already dearmored. `gpgv`, which apt itself depends on, is a different binary
# and is expected to be present.
#
# Without --installer the sources file is written by hand. That is the isolation
# mode: it answers "is the index broken, or is the installer broken?" without
# changing anything else, and is worth keeping long after the installer exists.
#
# Docs: docs/dev/distribution.md
# Spec: docs/superpowers/specs/2026-08-26-apt-repository-spec.md
set -eu

PKG=platypus-git
SUITE=stable
PORT=8000

# The path both this script and src-tauri/src/update.rs care about. The
# installer must create exactly this, because `update::capability` decides
# apt-managed vs sideloaded by testing for it — so it is asserted here rather
# than left to drift.
SOURCES_PATH=/etc/apt/sources.list.d/platypusgit.sources
KEYRING_PATH=/etc/apt/keyrings/platypusgit.gpg

CLIENT_IMAGE=debian:bookworm
SERVE_IMAGE=python:3-slim

# The repository ships amd64 only, so the client must BE amd64 or apt will fetch
# the index, verify it, and then report "Unable to locate package" — which is
# what happens by default on an Apple Silicon Mac, where debian:bookworm runs
# arm64. Pinned rather than inferred: on an amd64 CI runner this is a no-op, and
# on a developer's Mac it is the difference between a real test and a confusing
# one. Change it when an arm64 .deb actually exists.
PLATFORM=linux/amd64

REPO_DIR=
VERSION=
INSTALLER=
EXPECT_GIT=no

usage() {
    cat <<'USAGE'
Usage: apt-repo-smoke.sh --repo DIR --version X.Y.Z [options]

Serves an APT repository tree and installs from it in a clean Debian container.

Required:
  --repo DIR         the repository tree to serve
  --version X.Y.Z    the version the install is expected to land

Options:
  --installer PATH   install by running this script (the real one-liner) instead
                     of a hand-written sources file
  --expect-git       also assert Depends: git resolved, and that Section: vcs and
                     Provides: platypusgit are in the control data. Only true of a
                     .deb built after that config change, so it is opt-in.
  --client-image IMG default debian:bookworm
  --serve-image IMG  default python:3-slim
  --platform P       docker platform for the client (default linux/amd64; the
                     repository ships amd64 only, and an arm64 client would fetch
                     the index and then fail to locate the package)
  -h, --help         this text
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "apt-repo-smoke: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --repo) [ $# -ge 2 ] || die "--repo needs a value"; REPO_DIR="$2"; shift 2 ;;
        --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
        --installer) [ $# -ge 2 ] || die "--installer needs a value"; INSTALLER="$2"; shift 2 ;;
        --expect-git) EXPECT_GIT=yes; shift ;;
        --client-image) [ $# -ge 2 ] || die "--client-image needs a value"; CLIENT_IMAGE="$2"; shift 2 ;;
        --serve-image) [ $# -ge 2 ] || die "--serve-image needs a value"; SERVE_IMAGE="$2"; shift 2 ;;
        --platform) [ $# -ge 2 ] || die "--platform needs a value"; PLATFORM="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        --) shift; break ;;
        *) die "unknown option '$1' (try --help)" ;;
    esac
done

[ -n "$REPO_DIR" ] || die "--repo is required"
[ -n "$VERSION" ] || die "--version is required"
[ -d "$REPO_DIR" ] || die "not a directory: $REPO_DIR"
[ -f "$REPO_DIR/dists/$SUITE/InRelease" ] \
    || die "$REPO_DIR has no dists/$SUITE/InRelease — run apt-repo-publish.sh first"
[ -f "$REPO_DIR/key.gpg" ] || die "$REPO_DIR has no key.gpg"
if [ -n "$INSTALLER" ]; then
    [ -f "$INSTALLER" ] || die "not a file: $INSTALLER"
fi
command -v docker > /dev/null 2>&1 || die "docker is required"

REPO_ABS="$(cd "$REPO_DIR" && pwd)"
INSTALLER_ABS=
if [ -n "$INSTALLER" ]; then
    INSTALLER_ABS="$(cd "$(dirname "$INSTALLER")" && pwd)/$(basename "$INSTALLER")"
fi

MODE=sources
if [ -n "$INSTALLER" ]; then
    MODE=installer
fi

# A run id keeps concurrent runs (and leftovers from a killed one) from
# colliding on container or network names.
RUN_ID="$$-$(date +%s)"
NET="pg-apt-smoke-$RUN_ID"
SERVE="pg-apt-serve-$RUN_ID"
WORK="$(mktemp -d)"

cleanup() {
    docker rm -f "$SERVE" > /dev/null 2>&1 || true
    docker network rm "$NET" > /dev/null 2>&1 || true
    rm -rf "$WORK"
    return 0
}
trap cleanup EXIT INT TERM

BASE_URL="http://$SERVE:$PORT"

# ---------------------------------------------------------------------------
# The client program. Written out and mounted rather than passed as `sh -c`
# text, so the quoting stays readable and the assertions stay greppable.
# ---------------------------------------------------------------------------
cat > "$WORK/client.sh" <<'CLIENT'
#!/bin/sh
set -eu

fail() { printf 'SMOKE FAIL: %s\n' "$*" >&2; exit 1; }
ok() { printf 'SMOKE ok: %s\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive

# A clean base is part of what this proves. If the image ever starts shipping
# gnupg, the "no gnupg needed" claim becomes untestable here, and we should
# learn that immediately rather than silently.
if command -v gpg > /dev/null 2>&1; then
    fail "client image already has gnupg — this run cannot prove the dearmored key path"
fi
ok "client image has no gnupg"

apt-get update -qq
apt-get install -y -qq --no-install-recommends curl ca-certificates > /dev/null
ok "curl + ca-certificates installed (nothing else)"

# Wait for the server. It is a container on the same network, so this also
# covers the network coming up.
i=0
until curl -fsS "$PG_BASE_URL/dists/stable/InRelease" > /dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || fail "server never served InRelease at $PG_BASE_URL"
    sleep 1
done
ok "server reachable at $PG_BASE_URL"

# --- install ---------------------------------------------------------------

if [ "$PG_MODE" = installer ]; then
    PLATYPUSGIT_APT_URL="$PG_BASE_URL" sh /installer.sh
    ok "installer completed"
else
    # Isolation mode: the same commands the download page shows, written by hand
    # so a failure here is unambiguously the index, not the installer.
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL "$PG_BASE_URL/key.gpg" -o "$PG_KEYRING_PATH"
    chmod 0644 "$PG_KEYRING_PATH"
    cat > "$PG_SOURCES_PATH" <<SOURCES
Types: deb
URIs: $PG_BASE_URL
Suites: stable
Components: main
Architectures: amd64
Signed-By: $PG_KEYRING_PATH
SOURCES
    apt-get update -qq
    apt-get install -y -qq "$PG_PKG" > /dev/null
    ok "hand-written sources file installed $PG_PKG"
fi

# --- assertions ------------------------------------------------------------

# The contract with src-tauri/src/update.rs. If the installer ever writes a
# different path, `update::capability` silently reports a sideloaded .deb and
# tells apt users the wrong thing.
[ -f "$PG_SOURCES_PATH" ] || fail "$PG_SOURCES_PATH was not created"
ok "$PG_SOURCES_PATH exists (the contract update.rs reads)"

[ -f "$PG_KEYRING_PATH" ] || fail "$PG_KEYRING_PATH was not created"
ok "$PG_KEYRING_PATH exists"

# Re-run apt update against ONLY our sources file, so a Debian-mirror hiccup
# cannot read as a signing failure and vice versa. apt-get exits non-zero on a
# bad signature, and the log is grepped as well because some failures are
# reported as warnings.
mkdir -p /tmp/onlyours
cp "$PG_SOURCES_PATH" /tmp/onlyours/
apt-get update \
    -o Dir::Etc::sourcelist=/dev/null \
    -o Dir::Etc::sourceparts=/tmp/onlyours \
    -o APT::Get::List-Cleanup=0 2>&1 | tee /tmp/aptupdate.log
for bad in NO_PUBKEY BADSIG EXPKEYSIG 'not signed' 'no longer signed' \
           'not valid yet' 'is not valid' 'Release file' ; do
    if grep -qi "$bad" /tmp/aptupdate.log; then
        fail "scoped apt-get update reported '$bad'"
    fi
done
ok "scoped apt-get update accepted the signature"

dpkg -s "$PG_PKG" > /tmp/status 2>/dev/null || fail "$PG_PKG is not installed"
got="$(awk '/^Version:/ { print $2; exit }' /tmp/status)"
[ "$got" = "$PG_EXPECT_VERSION" ] \
    || fail "installed version is '$got', expected '$PG_EXPECT_VERSION'"
ok "dpkg reports version $got"

[ -x /usr/bin/pgit ] || fail "/usr/bin/pgit is missing or not executable"
ok "/usr/bin/pgit is executable"

[ -x /usr/bin/platypusgit ] || fail "/usr/bin/platypusgit is missing or not executable"
ok "/usr/bin/platypusgit is executable"

if command -v gpg > /dev/null 2>&1; then
    fail "gnupg got pulled in — the dearmored key path is supposed to avoid it"
fi
ok "still no gnupg after installing"

if [ "$PG_EXPECT_GIT" = yes ]; then
    command -v git > /dev/null 2>&1 || fail "git is absent — Depends: git did not resolve"
    ok "git was pulled in as a dependency"
    grep -q '^Section: vcs' /tmp/status || fail "Section: vcs missing from the control data"
    ok "Section: vcs present"
    grep -q '^Provides:.*platypusgit' /tmp/status \
        || fail "Provides: platypusgit missing from the control data"
    ok "Provides: platypusgit present"
else
    printf 'SMOKE skip: Depends/Section/Provides assertions (--expect-git not set)\n'
fi

printf '\nSMOKE PASS\n'
CLIENT

say "apt-repo-smoke: network $NET"
docker network create "$NET" > /dev/null

say "apt-repo-smoke: serving $REPO_ABS from $SERVE_IMAGE"
docker run -d --name "$SERVE" --network "$NET" \
    -v "$REPO_ABS:/srv:ro" \
    "$SERVE_IMAGE" \
    python3 -m http.server "$PORT" --directory /srv > /dev/null

say "apt-repo-smoke: installing in $CLIENT_IMAGE on $PLATFORM (mode: $MODE)"
set -- \
    --rm --network "$NET" --platform "$PLATFORM" \
    -v "$WORK/client.sh:/client.sh:ro" \
    -e "PG_BASE_URL=$BASE_URL" \
    -e "PG_EXPECT_VERSION=$VERSION" \
    -e "PG_EXPECT_GIT=$EXPECT_GIT" \
    -e "PG_MODE=$MODE" \
    -e "PG_PKG=$PKG" \
    -e "PG_SOURCES_PATH=$SOURCES_PATH" \
    -e "PG_KEYRING_PATH=$KEYRING_PATH"
if [ -n "$INSTALLER_ABS" ]; then
    set -- "$@" -v "$INSTALLER_ABS:/installer.sh:ro"
fi

if docker run "$@" "$CLIENT_IMAGE" sh /client.sh; then
    say "apt-repo-smoke: PASS"
else
    status=$?
    warn "apt-repo-smoke: FAIL (client exited $status)"
    warn "apt-repo-smoke: server log follows"
    docker logs "$SERVE" 2>&1 | while IFS= read -r line; do warn "  $line"; done
    exit "$status"
fi
