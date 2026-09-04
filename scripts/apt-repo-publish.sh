#!/bin/sh
# Build and sign the platypusgit APT repository (#187).
#
# Adds one .deb PER ARCHITECTURE to the pool, prunes each architecture to the
# newest N, regenerates the whole index from whatever the pool now holds, and
# signs it. Called by release.yml's `apt-publish` job against a checkout of
# jonassaa/apt-platypusgit, and by a developer against a scratch directory.
#
#   scripts/apt-repo-publish.sh --repo <dir> --version 0.0.18 \
#       --deb PlatypusGit_amd64.deb --deb PlatypusGit_arm64.deb
#
# STATELESS BY DESIGN. There is no database: the pool directory IS the state and
# git IS the history, so the index is a pure function of the pool. That is what
# makes a re-run safe — `release.yml` can be dispatched against an existing tag,
# and this script then reproduces the same index and says so instead of
# committing a no-op. `aptly` and `reprepro` both keep a second source of truth
# that can desync from the pool; this has none to desync.
#
# THE ARCHITECTURE SET IS DERIVED, NEVER CONFIGURED (#266). Every `binary-<arch>`
# directory, and the `Architectures:` line in `Release`, comes from the pool's
# own filenames — so publishing an arm64 `.deb` creates its directory, and an
# architecture that leaves the pool entirely takes its directory with it. A
# constant would be a second source of truth for exactly the thing "stateless"
# exists to avoid, and the failure mode is the ugly one: an `Architectures:`
# line promising an index that is not there makes `apt update` warn on every
# client that asked for it.
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

# Repository shape. These three strings are the layout; changing any of them is a
# breaking change for every client that already has a .sources file. The
# architecture is deliberately NOT one of them — see the header.
SUITE=stable
COMPONENT=main
PKG=platypusgit

ORIGIN=platypusgit
LABEL=platypusgit
DESCRIPTION="platypusgit APT repository"

# How many .deb files stay in the pool PER ARCHITECTURE. Every GitHub Pages
# deploy re-uploads the whole tree, so the pool's size is paid on every publish,
# not once; and the published-site cap is 1 GB against ~11.4 MB per package. Ten
# per architecture is ~114 MB each — ~228 MB for the two we build — and GitHub
# Releases still holds every historical .deb for anyone who needs one.
#
# Per-architecture rather than overall so that KEEP still means "ten releases".
# Counted across the whole pool, adding arm64 would have silently halved the
# history the repository serves.
KEEP=10

REPO_DIR=
# Newline-separated, because POSIX sh has no arrays and the parse loop below is
# already using the positional parameters. Paths may contain spaces; a path
# containing a NEWLINE is the one thing this cannot carry, and nothing produces
# one.
DEBS=
VERSION=
IN_DOCKER=no
DOCKER_IMAGE=debian:bookworm

usage() {
    cat <<'USAGE'
Usage: apt-repo-publish.sh --repo DIR --deb FILE [--deb FILE ...] --version X.Y.Z [options]

Adds one .deb per architecture to an APT repository tree, prunes, regenerates
the index and signs it. Idempotent: a second run with the same pool changes
nothing.

Required:
  --repo DIR       the repository tree (a checkout of apt-platypusgit)
  --deb FILE       a .deb to publish; repeat once per architecture. The
                   architecture is read out of the package, never guessed from
                   the filename
  --version X.Y.Z  the version those .deb files carry

Options:
  --keep N         .deb files to retain in the pool, per architecture
                   (default 10)
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

# The separator DEBS is built with, and what `IFS` is set to when iterating it.
# Every such loop restores the normal IFS for its BODY and puts the newline-only
# one back at the bottom, because a body running with IFS=newline splits command
# substitutions wrongly — which is a silent misparse, not an error.
NL='
'

while [ $# -gt 0 ]; do
    case "$1" in
        --repo) [ $# -ge 2 ] || die "--repo needs a value"; REPO_DIR="$2"; shift 2 ;;
        --deb) [ $# -ge 2 ] || die "--deb needs a value"; DEBS="${DEBS}${DEBS:+$NL}$2"; shift 2 ;;
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
[ -n "$DEBS" ] || die "--deb is required (repeat it once per architecture)"
[ -n "$VERSION" ] || die "--version is required"
[ -d "$REPO_DIR" ] || die "not a directory: $REPO_DIR"

OLDIFS=$IFS
IFS=$NL
for deb in $DEBS; do
    IFS=$OLDIFS
    [ -f "$deb" ] || die "not a file: $deb"
    IFS=$NL
done
IFS=$OLDIFS

case "$KEEP" in
    ''|*[!0-9]*) die "--keep must be a positive integer, got '$KEEP'" ;;
esac
[ "$KEEP" -ge 1 ] || die "--keep must be at least 1"

# ---------------------------------------------------------------------------
# --docker: re-exec in a Linux container with the inputs mounted.
#
# The private key travels as an environment variable, so it never appears in
# `docker inspect`'s command line. The repo is mounted read-write (it is the
# output); the .deb files and this script read-only.
#
# No --platform: an amd64 `.deb` is just a file to dpkg-deb and apt-ftparchive,
# so an arm64 container indexes it correctly. Only the SMOKE client has to match
# the package's architecture, and that is a different script.
# ---------------------------------------------------------------------------
if [ "$IN_DOCKER" = yes ]; then
    command -v docker > /dev/null 2>&1 || die "--docker needs docker on PATH"
    self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    repo_abs="$(cd "$REPO_DIR" && pwd)"

    # `$@` becomes the docker argument list, one `-v` per .deb. Each host path
    # is quoted into its own `-v`, so a directory with a space in it survives;
    # the container-internal names are /pkg-1.deb, /pkg-2.deb, … precisely so
    # that the inner shell has nothing awkward to re-quote.
    set -- --rm -v "$repo_abs:/repo"
    inner=
    n=0
    OLDIFS=$IFS
    IFS=$NL
    for deb in $DEBS; do
        IFS=$OLDIFS
        n=$((n + 1))
        deb_abs="$(cd "$(dirname "$deb")" && pwd)/$(basename "$deb")"
        set -- "$@" -v "$deb_abs:/pkg-$n.deb:ro"
        inner="$inner /pkg-$n.deb"
        IFS=$NL
    done
    IFS=$OLDIFS

    set -- "$@" \
        -v "$self:/apt-repo-publish.sh:ro" \
        -e APT_GPG_PRIVATE_KEY \
        -e APT_GPG_PASSPHRASE \
        -e APT_GPG_KEY_ID

    say "apt-repo-publish: re-execing in $DOCKER_IMAGE with $n .deb file(s)"
    # shellcheck disable=SC2086 # $inner is a list of container-internal paths
    # this script chose itself; word splitting is exactly what is wanted.
    exec docker run "$@" \
        "$DOCKER_IMAGE" \
        sh -c 'set -eu
               version="$1"; keep="$2"; shift 2
               export DEBIAN_FRONTEND=noninteractive
               apt-get update -qq
               apt-get install -y -qq --no-install-recommends apt-utils gnupg > /dev/null
               args=""
               for d in "$@"; do args="$args --deb $d"; done
               exec sh /apt-repo-publish.sh --repo /repo \
                   --version "$version" --keep "$keep" $args' \
        sh "$VERSION" "$KEEP" $inner
fi

command -v apt-ftparchive > /dev/null 2>&1 \
    || die "apt-ftparchive not found (apt-utils). On macOS, pass --docker."
command -v gpg > /dev/null 2>&1 \
    || die "gpg not found. On macOS, pass --docker."
# Part of `dpkg`, so it is present wherever the two above are — demanded by name
# so that if it ever is not, the failure says which tool rather than surfacing as
# a package with an empty architecture.
command -v dpkg-deb > /dev/null 2>&1 \
    || die "dpkg-deb not found (dpkg). On macOS, pass --docker."

POOL_DIR="$REPO_DIR/pool/$COMPONENT/$(printf '%s' "$PKG" | cut -c1)/$PKG"
DIST_DIR="$REPO_DIR/dists/$SUITE"
COMPONENT_DIR="$DIST_DIR/$COMPONENT"

mkdir -p "$POOL_DIR" "$COMPONENT_DIR"

# ---------------------------------------------------------------------------
# Key material.
#
# When APT_GPG_PRIVATE_KEY is set we build a throwaway keyring for this run, so
# CI (secret -> env) and a developer (fixture key -> env) take the same path and
# neither leaves a keyring behind. gpg refuses to work in a world-readable
# GNUPGHOME, hence the 0700.
# ---------------------------------------------------------------------------
TMP_GNUPG=
TMP_WORK=
cleanup() {
    [ -n "$TMP_GNUPG" ] && rm -rf "$TMP_GNUPG"
    [ -n "$TMP_WORK" ] && rm -rf "$TMP_WORK"
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
# Pool: add, then prune — one .deb and one prune window per architecture.
#
# The architecture is READ OUT OF THE PACKAGE, never parsed from the filename.
# The release assets are named `PlatypusGit_<arch>.deb` by a `cp` in
# release.yml, which makes the filename a convention a human can get wrong;
# `dpkg-deb -f` is the package itself saying what it is, and a mislabelled pool
# entry is invisible until an arm64 machine installs an amd64 binary.
#
# TWO PASSES: every .deb is read and checked before any of them is copied, so a
# bad argument list leaves the pool exactly as it found it. One pass would pool
# the first package and then refuse the second, which is the worst of both — a
# failed run that still changed the tree it is about to be re-run against.
# ---------------------------------------------------------------------------
# Split in two so that `die` is never reached from inside a `$(...)`, where its
# `exit 1` would end the subshell and leave the caller carrying on with an empty
# architecture. Same trap release.yml's signature-reading `emit()` is written
# around.
deb_arch() {
    dpkg-deb -f "$1" Architecture 2> /dev/null | tr -d '[:space:]'
}
check_arch() {
    case "$1" in
        '') die "no Architecture field in $2 — is it a .deb?" ;;
        *[!a-z0-9-]*) die "implausible architecture '$1' in $2" ;;
    esac
}

seen_arches=
OLDIFS=$IFS
IFS=$NL
for deb in $DEBS; do
    IFS=$OLDIFS
    arch="$(deb_arch "$deb")"
    check_arch "$arch" "$deb"
    # Two packages of the same architecture would write the same pool filename,
    # so the second would replace the first and the run would report success
    # having published one architecture fewer than it was handed.
    case " $seen_arches " in
        *" $arch "*) die "two --deb files are both $arch; pass one per architecture" ;;
    esac
    seen_arches="$seen_arches${seen_arches:+ }$arch"
    IFS=$NL
done

for deb in $DEBS; do
    IFS=$OLDIFS
    arch="$(deb_arch "$deb")"
    check_arch "$arch" "$deb"
    target="$POOL_DIR/${PKG}_${VERSION}_${arch}.deb"
    cp "$deb" "$target"
    say "apt-repo-publish: pooled $(basename "$target")"
    IFS=$NL
done
IFS=$OLDIFS

# Every filename in the pool was written by the loop above as
# <pkg>_<version>_<arch>.deb, so the last underscore-separated field IS the
# architecture — no second source of truth to drift.
# shellcheck disable=SC2012 # `ls` is safe here: none of those names contains
# whitespace, and `find` gives no ordering, which the prune loop needs.
pool_arches() {
    ls "$POOL_DIR"/*.deb 2> /dev/null \
        | sed -n 's|.*_\([^_/]*\)\.deb$|\1|p' \
        | sort -u
}

# `sort -V` orders by the version embedded in the filename. It is not dpkg's
# comparison algorithm and the two can disagree on exotic versions; release tags
# are plain X.Y.Z (release.yml strips a leading v), where they agree.
# `head -n -N` is GNU coreutils, which is what Debian and the runners have.
#
# Pruned PER ARCHITECTURE. Across the whole pool, `--keep 10` with two
# architectures would mean five releases of each, and the first arm64 publish
# would quietly delete half of amd64's history.
pruned=0
for arch in $(pool_arches); do
    # shellcheck disable=SC2012 # see pool_arches
    for old in $(ls "$POOL_DIR"/*_"$arch".deb 2> /dev/null | sort -V | head -n -"$KEEP"); do
        rm -f "$old"
        say "apt-repo-publish: pruned $(basename "$old") (keeping newest $KEEP per architecture)"
        pruned=$((pruned + 1))
    done
done
if [ "$pruned" -eq 0 ]; then
    say "apt-repo-publish: nothing to prune"
fi

# One space-separated list, used for the loop below and verbatim as the
# `Architectures:` line. `sort -u` makes it deterministic, which matters because
# Release is compared against nothing but is read by humans.
ARCHES="$(pool_arches | tr '\n' ' ')"
ARCHES="${ARCHES% }"
[ -n "$ARCHES" ] || die "the pool holds no .deb files — nothing to index"
say "apt-repo-publish: architectures in the pool: $ARCHES"

# ---------------------------------------------------------------------------
# Packages, and the no-op short-circuit.
#
# Generated to temp files and compared BEFORE anything else is touched.
# `apt-ftparchive release` stamps a Date: field, so Release differs on every run
# by construction — comparing the tree would never short-circuit. Packages is
# deterministic, so it is the honest thing to compare, and an unchanged pool
# therefore leaves the whole tree untouched and `git diff --quiet` clean.
#
# EVERY architecture has to be unchanged for the short-circuit to fire, and a
# `binary-<arch>` directory for an architecture the pool no longer holds counts
# as a change: leaving it would keep a stale Packages listed inside a freshly
# signed Release, which is the shape of index corruption that reads to a client
# as a hash mismatch it can do nothing about.
#
# Run from the repo root so `Filename:` is repo-relative, which is how apt
# resolves it.
# ---------------------------------------------------------------------------
TMP_WORK="$(mktemp -d)"

changed=no
for arch in $ARCHES; do
    ( cd "$REPO_DIR" && apt-ftparchive --arch "$arch" packages "pool" ) > "$TMP_WORK/$arch"
    [ -s "$TMP_WORK/$arch" ] || die "apt-ftparchive produced an empty Packages for $arch"
    if ! cmp -s "$TMP_WORK/$arch" "$COMPONENT_DIR/binary-$arch/Packages" 2> /dev/null; then
        changed=yes
    fi
done

# Directories for architectures that are no longer in the pool.
stale=
for dir in "$COMPONENT_DIR"/binary-*; do
    [ -d "$dir" ] || continue
    dir_arch="${dir##*/binary-}"
    case " $ARCHES " in
        *" $dir_arch "*) continue ;;
    esac
    stale="$stale$NL$dir"
    changed=yes
done

if [ "$changed" = no ]; then
    say "apt-repo-publish: Packages unchanged for every architecture — index left alone"
    exit 0
fi

OLDIFS=$IFS
IFS=$NL
for dir in $stale; do
    IFS=$OLDIFS
    rm -rf "$dir"
    say "apt-repo-publish: removed $(basename "$dir") — no such architecture in the pool"
    IFS=$NL
done
IFS=$OLDIFS

for arch in $ARCHES; do
    bin_dir="$COMPONENT_DIR/binary-$arch"
    mkdir -p "$bin_dir"
    mv "$TMP_WORK/$arch" "$bin_dir/Packages"
    chmod 0644 "$bin_dir/Packages"
    # -n omits the filename and timestamp from the gzip header. Without it every
    # run produces different bytes for identical content, and the short-circuit
    # above would be dead code.
    gzip -n -9 -c "$bin_dir/Packages" > "$bin_dir/Packages.gz"
    say "apt-repo-publish: $arch — $(grep -c '^Package:' "$bin_dir/Packages") package(s) indexed"
done

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
    -o "APT::FTPArchive::Release::Architectures=$ARCHES" \
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
