#!/bin/sh
# Build and sign the platypusgit APT repository (#187).
#
# Adds one .deb to the pool, prunes the pool to the newest N, regenerates the
# whole index from whatever the pool now holds, and signs it. Called by
# release.yml's `apt-publish` job against a checkout of
# jonassaa/apt-platypusgit, and by a developer against a scratch directory.
#
#   scripts/apt-repo-publish.sh --repo <dir> --deb <file> --version 0.0.18
#
# STATELESS BY DESIGN. There is no database: the pool directory IS the state and
# git IS the history, so the index is a pure function of the pool. That is what
# makes a re-run safe — `release.yml` can be dispatched against an existing tag,
# and this script then reproduces the same index and says so instead of
# committing a no-op. `aptly` and `reprepro` both keep a second source of truth
# that can desync from the pool; this has none to desync.
#
# Runs on Linux (needs apt-ftparchive from apt-utils, and gnupg). macOS has
# neither, so `--docker` re-execs the whole thing inside debian:bookworm with
# the repo mounted — the only way to exercise this script on a developer's Mac.
# CI never passes it.
#
# Environment:
#   APT_GPG_PRIVATE_KEY   armored private key. When set, it is imported into a
#                         throwaway GNUPGHOME for this run — the same code path
#                         CI and a developer both take. When unset, the ambient
#                         GNUPGHOME is used as-is.
#   APT_GPG_PASSPHRASE    passphrase for that key (may be empty).
#   APT_GPG_KEY_ID        optional. Normally derived from the imported key, so
#                         it cannot drift from the key actually in use.
#
# Secrets reach gpg through the environment and stdin, never argv.
#
# Docs: docs/dev/distribution.md
# Spec: docs/superpowers/specs/2026-08-26-apt-repository-spec.md
set -eu

# Repository shape. These four strings are the layout; changing any of them is a
# breaking change for every client that already has a .sources file.
SUITE=stable
COMPONENT=main
ARCH=amd64
PKG=platypus-git

ORIGIN=platypusgit
LABEL=platypusgit
DESCRIPTION="PlatypusGit APT repository"

# How many .deb files stay in the pool. Every GitHub Pages deploy re-uploads the
# whole tree, so the pool's size is paid on every publish, not once; and the
# published-site cap is 1 GB against ~11.4 MB per package. Ten is ~114 MB, and
# GitHub Releases still holds every historical .deb for anyone who needs one.
KEEP=10

REPO_DIR=
DEB=
VERSION=
IN_DOCKER=no
DOCKER_IMAGE=debian:bookworm

usage() {
    cat <<'USAGE'
Usage: apt-repo-publish.sh --repo DIR --deb FILE --version X.Y.Z [options]

Adds one .deb to an APT repository tree, prunes, regenerates the index and
signs it. Idempotent: a second run with the same pool changes nothing.

Required:
  --repo DIR       the repository tree (a checkout of apt-platypusgit)
  --deb FILE       the .deb to publish
  --version X.Y.Z  the version that .deb carries

Options:
  --keep N         .deb files to retain in the pool (default 10)
  --docker         re-exec inside debian:bookworm; for macOS, where neither
                   apt-ftparchive nor gpg exists
  --image NAME     image for --docker (default debian:bookworm)
  -h, --help       this text

Environment:
  APT_GPG_PRIVATE_KEY  armored private key, imported into a throwaway keyring
  APT_GPG_PASSPHRASE   its passphrase (may be empty)
  APT_GPG_KEY_ID       optional override; normally derived from the key
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "apt-repo-publish: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --repo) [ $# -ge 2 ] || die "--repo needs a value"; REPO_DIR="$2"; shift 2 ;;
        --deb) [ $# -ge 2 ] || die "--deb needs a value"; DEB="$2"; shift 2 ;;
        --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
        --keep) [ $# -ge 2 ] || die "--keep needs a value"; KEEP="$2"; shift 2 ;;
        --docker) IN_DOCKER=yes; shift ;;
        --image) [ $# -ge 2 ] || die "--image needs a value"; DOCKER_IMAGE="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        --) shift; break ;;
        *) die "unknown option '$1' (try --help)" ;;
    esac
done

[ -n "$REPO_DIR" ] || die "--repo is required"
[ -n "$DEB" ] || die "--deb is required"
[ -n "$VERSION" ] || die "--version is required"
[ -d "$REPO_DIR" ] || die "not a directory: $REPO_DIR"
[ -f "$DEB" ] || die "not a file: $DEB"

case "$KEEP" in
    ''|*[!0-9]*) die "--keep must be a positive integer, got '$KEEP'" ;;
esac
[ "$KEEP" -ge 1 ] || die "--keep must be at least 1"

# ---------------------------------------------------------------------------
# --docker: re-exec in a Linux container with the inputs mounted.
#
# The private key travels as an environment variable, so it never appears in
# `docker inspect`'s command line. The repo is mounted read-write (it is the
# output); the .deb and this script read-only.
# ---------------------------------------------------------------------------
if [ "$IN_DOCKER" = yes ]; then
    command -v docker > /dev/null 2>&1 || die "--docker needs docker on PATH"
    self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    repo_abs="$(cd "$REPO_DIR" && pwd)"
    deb_abs="$(cd "$(dirname "$DEB")" && pwd)/$(basename "$DEB")"
    say "apt-repo-publish: re-execing in $DOCKER_IMAGE"
    exec docker run --rm \
        -v "$repo_abs:/repo" \
        -v "$deb_abs:/pkg.deb:ro" \
        -v "$self:/apt-repo-publish.sh:ro" \
        -e APT_GPG_PRIVATE_KEY \
        -e APT_GPG_PASSPHRASE \
        -e APT_GPG_KEY_ID \
        "$DOCKER_IMAGE" \
        sh -c 'set -eu
               export DEBIAN_FRONTEND=noninteractive
               apt-get update -qq
               apt-get install -y -qq --no-install-recommends apt-utils gnupg > /dev/null
               exec sh /apt-repo-publish.sh --repo /repo --deb /pkg.deb \
                    --version "$1" --keep "$2"' \
        sh "$VERSION" "$KEEP"
fi

command -v apt-ftparchive > /dev/null 2>&1 \
    || die "apt-ftparchive not found (apt-utils). On macOS, pass --docker."
command -v gpg > /dev/null 2>&1 \
    || die "gpg not found. On macOS, pass --docker."

POOL_DIR="$REPO_DIR/pool/$COMPONENT/$(printf '%s' "$PKG" | cut -c1)/$PKG"
DIST_DIR="$REPO_DIR/dists/$SUITE"
BIN_DIR="$DIST_DIR/$COMPONENT/binary-$ARCH"

mkdir -p "$POOL_DIR" "$BIN_DIR"

# ---------------------------------------------------------------------------
# Key material.
#
# When APT_GPG_PRIVATE_KEY is set we build a throwaway keyring for this run, so
# CI (secret -> env) and a developer (fixture key -> env) take the same path and
# neither leaves a keyring behind. gpg refuses to work in a world-readable
# GNUPGHOME, hence the 0700.
# ---------------------------------------------------------------------------
TMP_GNUPG=
cleanup() {
    [ -n "$TMP_GNUPG" ] && rm -rf "$TMP_GNUPG"
    return 0
}
trap cleanup EXIT INT TERM

if [ -n "${APT_GPG_PRIVATE_KEY:-}" ]; then
    TMP_GNUPG="$(mktemp -d)"
    chmod 0700 "$TMP_GNUPG"
    GNUPGHOME="$TMP_GNUPG"
    export GNUPGHOME
    printf '%s\n' "$APT_GPG_PRIVATE_KEY" | gpg --batch --quiet --import
fi

KEY_ID="${APT_GPG_KEY_ID:-}"
if [ -z "$KEY_ID" ]; then
    # Derived rather than configured: a key id that is set separately from the
    # key itself is a pair that can drift, and the failure shows up as an
    # unsigned publish rather than as a missing variable.
    KEY_ID="$(gpg --list-secret-keys --with-colons 2>/dev/null \
              | awk -F: '/^fpr:/ { print $10; exit }')"
fi
[ -n "$KEY_ID" ] || die "no secret key available to sign with"
say "apt-repo-publish: signing key $KEY_ID"

# The repository always carries the public half of whatever signed it. Exported
# on every run and byte-stable for an unchanged key, so this cannot become the
# stale file that makes every client's `apt update` fail.
gpg --batch --yes --export "$KEY_ID" > "$REPO_DIR/key.gpg"
gpg --batch --yes --armor --export "$KEY_ID" > "$REPO_DIR/key.asc"

# ---------------------------------------------------------------------------
# Pool: add, then prune.
# ---------------------------------------------------------------------------
target="$POOL_DIR/${PKG}_${VERSION}_${ARCH}.deb"
cp "$DEB" "$target"
say "apt-repo-publish: pooled $(basename "$target")"

# `sort -V` orders by the version embedded in the filename. It is not dpkg's
# comparison algorithm and the two can disagree on exotic versions; release tags
# are plain X.Y.Z (release.yml strips a leading v), where they agree.
# `head -n -N` is GNU coreutils, which is what Debian and the runners have.
pruned=0
for old in $(ls "$POOL_DIR"/*.deb 2>/dev/null | sort -V | head -n -"$KEEP"); do
    rm -f "$old"
    say "apt-repo-publish: pruned $(basename "$old") (keeping newest $KEEP)"
    pruned=$((pruned + 1))
done
if [ "$pruned" -eq 0 ]; then
    say "apt-repo-publish: nothing to prune"
fi

# ---------------------------------------------------------------------------
# Packages, and the no-op short-circuit.
#
# Generated to a temp file and compared BEFORE anything else is touched.
# `apt-ftparchive release` stamps a Date: field, so Release differs on every run
# by construction — comparing the tree would never short-circuit. Packages is
# deterministic, so it is the honest thing to compare, and an unchanged pool
# therefore leaves the whole tree untouched and `git diff --quiet` clean.
#
# Run from the repo root so `Filename:` is repo-relative, which is how apt
# resolves it.
# ---------------------------------------------------------------------------
tmp_pkgs="$(mktemp)"
( cd "$REPO_DIR" && apt-ftparchive --arch "$ARCH" packages "pool" ) > "$tmp_pkgs"

[ -s "$tmp_pkgs" ] || { rm -f "$tmp_pkgs"; die "apt-ftparchive produced an empty Packages"; }

if [ -f "$BIN_DIR/Packages" ] && cmp -s "$tmp_pkgs" "$BIN_DIR/Packages"; then
    rm -f "$tmp_pkgs"
    say "apt-repo-publish: Packages unchanged — already up to date, index left alone"
    exit 0
fi

mv "$tmp_pkgs" "$BIN_DIR/Packages"
chmod 0644 "$BIN_DIR/Packages"
# -n omits the filename and timestamp from the gzip header. Without it every run
# produces different bytes for identical content, and the short-circuit above
# would be dead code.
gzip -n -9 -c "$BIN_DIR/Packages" > "$BIN_DIR/Packages.gz"
say "apt-repo-publish: wrote $(grep -c '^Package:' "$BIN_DIR/Packages") package(s) to the index"

# ---------------------------------------------------------------------------
# Release, InRelease, Release.gpg.
#
# Delete the previous three FIRST. `apt-ftparchive release` hashes every file
# under the directory it is given, so a leftover InRelease or Release.gpg would
# be listed inside the checksum section of the Release they sign.
#
# And generate to a temp file OUTSIDE the tree, not with `> "$DIST_DIR/Release"`.
# Deleting the old Release is not enough: the redirect recreates the file before
# apt-ftparchive walks the directory, and apt-ftparchive streams its output, so
# it hashes the header it has already flushed and Release lands in its own
# checksum list. Measured, not theorised — the first run of this script produced
# exactly that (`186 Release`).
#
# No Valid-Until, deliberately: an expired Release file is a silent, global
# `apt update` failure for every existing install, with no upgrade path. The
# cost is apt's freeze/replay protection, which over HTTPS for a one-package
# repository is the cheaper of the two risks. Documented in the spec, §C.
# ---------------------------------------------------------------------------
rm -f "$DIST_DIR/Release" "$DIST_DIR/Release.gpg" "$DIST_DIR/InRelease"

tmp_rel="$(mktemp)"
apt-ftparchive \
    -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
    -o "APT::FTPArchive::Release::Label=$LABEL" \
    -o "APT::FTPArchive::Release::Suite=$SUITE" \
    -o "APT::FTPArchive::Release::Codename=$SUITE" \
    -o "APT::FTPArchive::Release::Architectures=$ARCH" \
    -o "APT::FTPArchive::Release::Components=$COMPONENT" \
    -o "APT::FTPArchive::Release::Description=$DESCRIPTION" \
    release "$DIST_DIR" > "$tmp_rel"

[ -s "$tmp_rel" ] || { rm -f "$tmp_rel"; die "apt-ftparchive produced an empty Release"; }
if grep -qE '^ [0-9a-f]{32} +[0-9]+ Release$' "$tmp_rel"; then
    rm -f "$tmp_rel"
    die "Release lists itself in its own checksum section — it was generated inside \$DIST_DIR"
fi
mv "$tmp_rel" "$DIST_DIR/Release"
chmod 0644 "$DIST_DIR/Release"

# --pinentry-mode loopback + --passphrase-fd 0 is what makes gpg usable with no
# tty. The passphrase arrives on stdin; it is never an argument.
# $1 is the output path; everything after it is passed to gpg verbatim, so the
# detached signature can ask for --armor (Release.gpg is conventionally armored)
# while the clearsigned InRelease cannot.
sign() {
    out="$1"; shift
    printf '%s' "${APT_GPG_PASSPHRASE:-}" | gpg \
        --batch --yes --quiet \
        --pinentry-mode loopback --passphrase-fd 0 \
        --local-user "$KEY_ID" \
        "$@" -o "$out" "$DIST_DIR/Release"
}

sign "$DIST_DIR/InRelease" --clearsign
sign "$DIST_DIR/Release.gpg" --armor --detach-sign

for f in InRelease Release.gpg; do
    [ -s "$DIST_DIR/$f" ] || die "signing produced an empty $f"
done

say "apt-repo-publish: signed Release -> InRelease + Release.gpg"
say "apt-repo-publish: done"
