#!/bin/sh
# Install platypusgit from the APT repository (#187).
#
# Adds the signed repository and installs the app, so every release after this
# one arrives through `apt upgrade` instead of a browser download.
#
#   curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh
#
# NOT scripts/install-pgit.sh. That one links the `pgit` command to an app you
# have ALREADY installed, for the two channels that run no install code (the
# macOS .dmg and the Linux AppImage) — see #144. This one installs the app
# itself, on Debian and Ubuntu, and the `pgit` command comes with it because the
# .deb ships /usr/bin/pgit.
#
# Safe under `curl | sh` by construction: POSIX sh, `set -eu`, and it NEVER
# reads stdin — stdin is the script itself, so there are no prompts and every
# choice is a flag or an environment variable.
#
# Debian and Ubuntu only, amd64 only. Anything else is told so and pointed at
# the AppImage rather than quietly handed a different package format than the
# one this script advertises.
#
# Spec: docs/superpowers/specs/2026-08-26-apt-repository-spec.md
set -eu

PKG=platypus-git
APPIMAGE_URL=https://www.platypusgit.com/download/#linux
DEFAULT_APT_URL=https://apt.platypusgit.com

SUITE=stable
COMPONENT=main
WANT_ARCH=amd64

# `Signed-By:` points at the keyring, so these two paths travel together.
#
# SOURCES_PATH IS A CONTRACT with src-tauri/src/update.rs: `update::capability`
# decides "apt-managed" vs "sideloaded .deb" by testing for exactly this file,
# and tells the user to run `apt upgrade` or to run this script accordingly.
# Change it in both places or the update panel starts lying.
KEYRING_DIR=/etc/apt/keyrings
KEYRING_PATH=/etc/apt/keyrings/platypusgit.gpg
SOURCES_PATH=/etc/apt/sources.list.d/platypusgit.sources

APT_URL="${PLATYPUSGIT_APT_URL:-$DEFAULT_APT_URL}"
DRY_RUN=no

# Test seams. Neither refusal path below can be reached on a machine that is
# already a Debian amd64 box, so the two probes are parameterised rather than
# left unverifiable — same idea as PGIT_UNAME in scripts/install-pgit.sh and
# PGIT_POSTINST_PREFIX in src-tauri/deb/postinst. Nothing in normal use sets
# either.
FAKE_ARCH="${PLATYPUSGIT_ARCH:-}"
FAKE_APT_GET="${PLATYPUSGIT_APT_GET:-}"

usage() {
    cat <<'USAGE'
Usage: install-platypusgit.sh [options]

Adds the platypusgit APT repository and installs the app. Updates then come
from your package manager:

  sudo apt update && sudo apt upgrade platypus-git

Options:
  --apt-url URL    repository base URL (default https://apt.platypusgit.com)
  --dry-run        print what would happen and change nothing
  -h, --help       this text

Environment:
  PLATYPUSGIT_APT_URL   same as --apt-url

Debian/Ubuntu on amd64. On any other system this script tells you so and stops;
use the AppImage instead — it also updates itself in-app.
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() {
    warn "install-platypusgit: $*"
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --apt-url)
            [ $# -ge 2 ] || die "--apt-url needs a URL"
            APT_URL="$2"
            shift 2
            ;;
        --apt-url=*) APT_URL="${1#--apt-url=}"; shift ;;
        --dry-run) DRY_RUN=yes; shift ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# A trailing slash would produce `URIs: https://host/` and doubled slashes in
# every fetch. Harmless to apt, ugly in the sources file people read.
APT_URL="${APT_URL%/}"
[ -n "$APT_URL" ] || die "--apt-url cannot be empty"

# ─── is this even a Debian-family amd64 box? ─────────────────────────────────

# Detect-then-refuse, never substitute. A script that advertises an apt install
# and silently drops an AppImage somewhere is the kind of surprise that costs
# more trust than it saves typing.

apt_get_path() {
    if [ -n "$FAKE_APT_GET" ]; then
        # The seam carries either a path (pretend present) or the literal
        # "none" (pretend absent), because an empty value is indistinguishable
        # from "seam not set".
        case "$FAKE_APT_GET" in
            none) return 1 ;;
            *) printf '%s\n' "$FAKE_APT_GET"; return 0 ;;
        esac
    fi
    command -v apt-get 2> /dev/null
}

if ! apt_get_path > /dev/null 2>&1; then
    warn "install-platypusgit: no apt-get here, so there is no APT repository to add."
    warn "install-platypusgit: this script covers Debian and Ubuntu only."
    warn ""
    warn "On Fedora, Arch, or anything else, use the AppImage — download it, make"
    warn "it executable, and run it. It is self-contained and it updates itself"
    warn "from inside the app, which the .deb cannot do:"
    warn ""
    warn "    $APPIMAGE_URL"
    exit 1
fi

detect_arch() {
    if [ -n "$FAKE_ARCH" ]; then
        printf '%s\n' "$FAKE_ARCH"
        return 0
    fi
    dpkg --print-architecture 2> /dev/null || printf 'unknown\n'
}

ARCH="$(detect_arch)"
# Widening this is #266 (build + publish an arm64 .deb). Until then, a sentence
# beats apt reporting "Unable to locate package" after a successful update.
if [ "$ARCH" != "$WANT_ARCH" ]; then
    warn "install-platypusgit: platypusgit is not built for '$ARCH' yet — only $WANT_ARCH."
    warn "install-platypusgit: adding the repository would leave apt with nothing to install."
    warn ""
    warn "Use the AppImage if one exists for your machine, or build from source:"
    warn ""
    warn "    $APPIMAGE_URL"
    exit 1
fi

# ─── how we fetch, and how we get root ───────────────────────────────────────

# curl is how this script most likely arrived, but not how it must have: someone
# who downloaded it with wget and read it first deserves to be able to run it.
FETCH=
if command -v curl > /dev/null 2>&1; then
    FETCH=curl
elif command -v wget > /dev/null 2>&1; then
    FETCH=wget
else
    die "neither curl nor wget found — cannot fetch the signing key"
fi

SUDO=
if [ "$(id -u 2> /dev/null || echo 0)" != 0 ]; then
    if command -v sudo > /dev/null 2>&1; then
        SUDO=sudo
    else
        die "not running as root and no sudo found — re-run as root"
    fi
fi

# ─── the plan ────────────────────────────────────────────────────────────────

SOURCES_BODY="Types: deb
URIs: $APT_URL
Suites: $SUITE
Components: $COMPONENT
Architectures: $ARCH
Signed-By: $KEYRING_PATH"

if [ "$DRY_RUN" = yes ]; then
    say "install-platypusgit: --dry-run, nothing will be changed."
    say ""
    say "Would add the repository:"
    say ""
    say "  ${SUDO:+$SUDO }install -d -m 0755 $KEYRING_DIR"
    say "  $FETCH $APT_URL/key.gpg -> $KEYRING_PATH (mode 0644)"
    say "  write $SOURCES_PATH:"
    printf '%s\n' "$SOURCES_BODY" | sed 's/^/      /'
    say ""
    say "Would then install:"
    say ""
    say "  ${SUDO:+$SUDO }apt-get update"
    say "  ${SUDO:+$SUDO }apt-get install -y $PKG"
    exit 0
fi

# ─── add the repository ──────────────────────────────────────────────────────

say "install-platypusgit: adding $APT_URL ($SUITE/$COMPONENT, $ARCH)"

# `install -d` rather than `mkdir -p`: /etc/apt/keyrings does not exist on older
# releases, and it wants an explicit mode rather than whatever umask gives.
$SUDO install -d -m 0755 "$KEYRING_DIR"

# The DEARMORED key, deliberately. Serving the armored .asc would mean every
# client needs gnupg installed to convert it; the binary form needs nothing, so
# this works on a minimal container or cloud image. apt itself verifies with
# gpgv, which it already depends on.
#
# Downloaded to a temp file and moved into place, so an interrupted fetch cannot
# leave a truncated keyring that breaks every later `apt update`.
tmp_key="$(mktemp)"
cleanup() {
    rm -f "$tmp_key"
    return 0
}
trap cleanup EXIT INT TERM

case "$FETCH" in
    curl) curl -fsSL "$APT_URL/key.gpg" -o "$tmp_key" ;;
    wget) wget -q -O "$tmp_key" "$APT_URL/key.gpg" ;;
esac
[ -s "$tmp_key" ] || die "downloaded signing key is empty — is $APT_URL correct?"

$SUDO install -m 0644 "$tmp_key" "$KEYRING_PATH"
say "install-platypusgit: signing key -> $KEYRING_PATH"

# deb822 rather than a one-line entry: supported since apt 1.1 (Debian 9,
# Ubuntu 16.04), and readable by whoever inherits the machine. `Architectures:`
# is explicit so that when an arm64 build exists, an amd64 box keeps asking for
# amd64 instead of warning on every update about an index it cannot use.
printf '%s\n' "$SOURCES_BODY" | $SUDO tee "$SOURCES_PATH" > /dev/null
say "install-platypusgit: sources -> $SOURCES_PATH"

# ─── install ─────────────────────────────────────────────────────────────────

# `apt-get`, not `apt`: apt prints "does not have a stable CLI interface" when
# used from a script, and means it.
DEBIAN_FRONTEND=noninteractive
export DEBIAN_FRONTEND

say "install-platypusgit: apt-get update"
$SUDO apt-get update

say "install-platypusgit: installing $PKG"
$SUDO apt-get install -y "$PKG"

say ""
say "install-platypusgit: done."
say ""
say "  platypusgit          launch the app"
say "  pgit .               open the repository you are standing in"
say ""
say "Updates now come from apt:"
say ""
say "  sudo apt update && sudo apt upgrade $PKG"
