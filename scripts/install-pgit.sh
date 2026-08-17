#!/bin/sh
# Install the `pgit` CLI for an already-installed platypusgit (macOS + Linux).
#
# For the channels that give us no install hook: the macOS .dmg (a drag-install
# runs no code) and the Linux AppImage (self-contained, never installed).
# Homebrew, the .deb and the .msi already ship `pgit` — this script recognises
# that and refuses to write a second one.
#
#   curl -fsSL https://platypusgit.com/install-pgit.sh | sh
#
# Safe under `curl | sh` by construction: POSIX sh, `set -eu`, and it NEVER
# reads stdin — stdin is the script itself, so there are no prompts and every
# choice is a flag or an environment variable.
#
# Issue: https://github.com/jonassaa/platypusgit/issues/144
set -eu

BINARY_NAME=platypusgit
SHIM_NAME=pgit
MAX_SHIM_BYTES=4096

APP="${PLATYPUSGIT_APP:-}"
BIN_DIR="${PGIT_BIN_DIR:-}"
DRY_RUN=no

# Test seams. Three of the five install channels cannot be exercised on a
# developer's own machine, so the app search is parameterised rather than left
# unverifiable: the repo's harness points these at a fixture tree and drives the
# real detection for both platforms. Same idea as PGIT_POSTINST_PREFIX in
# src-tauri/deb/postinst. Nothing in normal use sets either.
SEARCH_ROOT="${PGIT_APP_SEARCH_ROOT:-}"
# A failing `uname` must not abort the script under `set -e`; an unknown
# system falls through to the Linux/other search list.
UNAME_S="${PGIT_UNAME:-$(uname -s 2>/dev/null || echo unknown)}"

usage() {
    cat <<'USAGE'
Usage: install-pgit.sh [options]

Links the `pgit` command to an installed platypusgit. Prefers a directory you
already own, so it never needs sudo.

Options:
  --app PATH       the platypusgit executable (or .AppImage) to link to
  --bin-dir DIR    where to put `pgit`
  --dry-run        print what would happen and change nothing
  -h, --help       this text

Environment:
  PLATYPUSGIT_APP  same as --app
  PGIT_BIN_DIR     same as --bin-dir

Homebrew, the .deb and the .msi install `pgit` themselves; this script detects
an existing one and exits without touching it.
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() {
    warn "install-pgit: $*"
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --app)
            [ $# -ge 2 ] || die "--app needs a path"
            APP="$2"
            shift 2
            ;;
        --app=*) APP="${1#--app=}"; shift ;;
        --bin-dir)
            [ $# -ge 2 ] || die "--bin-dir needs a path"
            BIN_DIR="$2"
            shift 2
            ;;
        --bin-dir=*) BIN_DIR="${1#--bin-dir=}"; shift ;;
        --dry-run) DRY_RUN=yes; shift ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# ─── locate the app ──────────────────────────────────────────────────────────

candidate_apps() {
    case "$UNAME_S" in
        Darwin)
            printf '%s\n' \
                "$SEARCH_ROOT/Applications/PlatypusGit.app/Contents/MacOS/$BINARY_NAME" \
                "${HOME:-}/Applications/PlatypusGit.app/Contents/MacOS/$BINARY_NAME"
            ;;
        *)
            printf '%s\n' \
                "$SEARCH_ROOT/usr/bin/$BINARY_NAME" \
                "$SEARCH_ROOT/usr/local/bin/$BINARY_NAME" \
                "$SEARCH_ROOT/opt/$BINARY_NAME/$BINARY_NAME"
            # Set only inside a running AppImage, but free to honour.
            if [ -n "${APPIMAGE:-}" ]; then
                printf '%s\n' "$APPIMAGE"
            fi
            ;;
    esac
}

find_app() {
    # The `while` is on the right of a pipe, so it runs in a subshell and its
    # `break` cannot reach this function — capture its output instead.
    _found="$(candidate_apps | while IFS= read -r candidate; do
        if [ -n "$candidate" ] && [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            break
        fi
    done)"
    if [ -n "$_found" ]; then
        printf '%s\n' "$_found"
        return 0
    fi
    command -v "$BINARY_NAME" 2>/dev/null || true
}

if [ -z "$APP" ]; then
    APP="$(find_app)"
fi
[ -n "$APP" ] || die "cannot find platypusgit — install the app first, or pass --app PATH"
[ -x "$APP" ] || die "$APP is not an executable"

# ─── is a `pgit` already here, and is it ours? ───────────────────────────────

# Same three probes cli.rs uses: a symlink to the app, a symlink named after the
# binary, or a small wrapper script mentioning the binary.
references_app() {
    _path="$1"
    if [ -L "$_path" ]; then
        _target="$(readlink "$_path")"
        case "$_target" in
            "$APP") return 0 ;;
        esac
        case "$(basename "$_target")" in
            "$BINARY_NAME" | "$BINARY_NAME".*) return 0 ;;
        esac
    fi
    if [ -f "$_path" ] && [ ! -L "$_path" ]; then
        _size="$(wc -c <"$_path" 2>/dev/null || echo 0)"
        if [ "$_size" -le "$MAX_SHIM_BYTES" ] && grep -q "$BINARY_NAME" "$_path" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

existing="$(command -v "$SHIM_NAME" 2>/dev/null || true)"
if [ -n "$existing" ] && references_app "$existing"; then
    say "pgit is already installed at $existing — nothing to do."
    say "It runs: $APP"
    exit 0
fi
if [ -n "$existing" ]; then
    warn "install-pgit: a different '$SHIM_NAME' is already on your PATH at $existing."
    warn "install-pgit: it will not be touched; ours goes in its own directory below."
fi

# ─── pick a directory ────────────────────────────────────────────────────────

on_path() {
    case ":${PATH}:" in
        *":$1:"*) return 0 ;;
    esac
    return 1
}

usable_dir() {
    # Creating it IS the writability test — a separate probe would only add a
    # race between probe and write.
    [ -d "$1" ] || mkdir -p "$1" 2>/dev/null || return 1
    [ -w "$1" ] || return 1
    return 0
}

candidate_dirs() {
    printf '%s\n' "${HOME:-}/.local/bin" "${HOME:-}/bin" "/usr/local/bin"
}

if [ -n "$BIN_DIR" ]; then
    usable_dir "$BIN_DIR" || die "cannot write to $BIN_DIR"
else
    # Among the writable ones, prefer a directory already on PATH. A here-doc
    # (not a pipe) feeds the loop, so the assignment lands in THIS shell.
    for pass in on-path any; do
        while IFS= read -r dir; do
            [ -n "$dir" ] || continue
            # A relative candidate means $HOME was unset; skip rather than
            # creating ./.local/bin wherever the user happened to be.
            case "$dir" in /*) ;; *) continue ;; esac
            if [ "$pass" = on-path ] && ! on_path "$dir"; then
                continue
            fi
            if usable_dir "$dir"; then
                BIN_DIR="$dir"
                break
            fi
        done <<EOF
$(candidate_dirs)
EOF
        if [ -n "$BIN_DIR" ]; then
            break
        fi
    done
fi
[ -n "$BIN_DIR" ] || die "no writable directory found for $SHIM_NAME (try --bin-dir DIR)"

TARGET="$BIN_DIR/$SHIM_NAME"

if [ "$DRY_RUN" = yes ]; then
    say "would link: $TARGET -> $APP"
    if on_path "$BIN_DIR"; then
        say "$BIN_DIR is on your PATH."
    else
        say "$BIN_DIR is NOT on your PATH."
    fi
    exit 0
fi

rm -f "$TARGET"
ln -s "$APP" "$TARGET"
say "Installed: $TARGET -> $APP"

if on_path "$BIN_DIR"; then
    say "Run it with: $SHIM_NAME --help"
else
    say ""
    say "$BIN_DIR is not on your PATH. Add it, then reopen your shell:"
    say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc   # or ~/.bashrc"
fi
