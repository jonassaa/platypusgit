#!/bin/sh
# Stage and pack the Microsoft Store MSIX.
#
#   sh scripts/msix-pack.sh --version 0.1.2 --arch x64 \
#       --exe src-tauri/target/x86_64-pc-windows-msvc/release/platypusgit.exe \
#       --out msix-x64
#   sh scripts/msix-pack.sh --version 0.1.2 --arch x64 --exe … --out … --stage-only
#
# WHY A GENERATOR IN THIS REPOSITORY: the package is the artifact users install,
# so the steps that build it should be reviewable here, runnable here, and
# impossible to drift from a second copy nobody reads. Same argument as
# scripts/apt-repo-publish.sh and scripts/scoop-manifest.sh, which is why all
# three look alike.
#
# WHY `makeappx` AND NOT `winapp pack`: winapp documents Windows 11 as a
# prerequisite and GitHub's windows-latest is Windows Server. makeappx ships with
# the Windows SDK, which is already on the runner. winapp is still the right tool
# for the LOCAL debug loop (see the spec's Verification reality) and is
# deliberately not in the release path.
#
# --stage-only renders the manifest and builds the payload tree WITHOUT calling
# makeappx, so the substitution — the one step that must not be wrong — is
# testable on a Mac.
#
# Called by release.yml's `msix` job. Safe to run locally: it writes one
# directory and touches no network.
#
# Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md  (§B)
set -eu

# The tile and store logos the manifest references. Generated from
# src-tauri/icons/app-icon.svg by `tauri icon` (#206) — never hand-edited.
# src-tauri/tests/msix_identity.rs asserts the manifest references nothing that
# is missing from icons/, so a regeneration that drops a size fails the build
# rather than producing a package with blank tiles.
LOGOS="Square44x44Logo Square71x71Logo Square150x150Logo Square310x310Logo StoreLogo"

VERSION=
ARCH=
EXE=
OUT=
STAGE_ONLY=0

# Development defaults, overridden by the flags for a real submission. The real
# values come from the product's identity page in Partner Center and must match
# it character for character or the upload is rejected — which is why they are
# not guessed here and not committed in the manifest.
IDENTITY_NAME="${MSIX_IDENTITY_NAME:-platypusgit.dev}"
PUBLISHER="${MSIX_PUBLISHER:-CN=platypusgit-development}"

usage() {
    cat <<'USAGE'
usage: msix-pack.sh --version X.Y.Z --arch x64|arm64 --exe PATH --out DIR
                    [--identity-name NAME] [--publisher CN] [--stage-only]

  --version        three-part app version; the MSIX fourth part is appended
  --arch           MSIX ProcessorArchitecture
  --exe            the built platypusgit.exe to package
  --out            directory to stage into (created; must not already exist)
  --identity-name  Partner Center's assigned Identity/@Name
  --publisher      Partner Center's assigned Identity/@Publisher (CN=...)
  --stage-only     stage and render only; do not run makeappx
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --arch) ARCH="$2"; shift 2 ;;
        --exe) EXE="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --identity-name) IDENTITY_NAME="$2"; shift 2 ;;
        --publisher) PUBLISHER="$2"; shift 2 ;;
        --stage-only) STAGE_ONLY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [ -z "$VERSION" ] || [ -z "$ARCH" ] || [ -z "$EXE" ] || [ -z "$OUT" ]; then
    echo "missing a required argument" >&2
    usage >&2
    exit 2
fi

case "$ARCH" in
    x64|arm64) ;;
    *) echo "--arch must be x64 or arm64, got: $ARCH" >&2; exit 2 ;;
esac

# Three-part in, four-part out. The fourth part is 0 because the Store is
# documented to reserve the revision field — TREAT THAT AS UNCONFIRMED and check
# it against the first real upload rather than trusting this comment. It is the
# one claim in this channel nobody has tested (spec §E).
case "$VERSION" in
    *.*.*.*) echo "--version must be three-part (X.Y.Z), got: $VERSION" >&2; exit 2 ;;
    *.*.*) MSIX_VERSION="$VERSION.0" ;;
    *) echo "--version must be three-part (X.Y.Z), got: $VERSION" >&2; exit 2 ;;
esac

[ -e "$EXE" ] || { echo "no such executable: $EXE" >&2; exit 1; }
# Refuse rather than overwrite: a stale payload from a previous arch silently
# produces a package for the wrong architecture, which installs and then fails.
[ -e "$OUT" ] && { echo "refusing to overwrite existing --out: $OUT" >&2; exit 1; }

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest_src="$root/src-tauri/windows/Package.appxmanifest"
[ -f "$manifest_src" ] || { echo "missing manifest: $manifest_src" >&2; exit 1; }

mkdir -p "$OUT/Assets"
cp "$EXE" "$OUT/platypusgit.exe"

# The SAME pgit.cmd the Scoop zip ships, byte for byte, and load-bearing for the
# same reason: cli.rs::shim_status probes `exe_dir/pgit.cmd` before it scans
# PATH, and finding it is what makes this install classify as
# CliShimSource::Package — which is what stops Settings offering to write a
# second, competing shim into %LOCALAPPDATA% that uninstalling the package would
# leave behind. What gives the user the actual `pgit` command is the manifest's
# appExecutionAlias, not this file. See src-tauri/windows/pgit-portable.cmd.
cp "$root/src-tauri/windows/pgit-portable.cmd" "$OUT/pgit.cmd"

for logo in $LOGOS; do
    src="$root/src-tauri/icons/$logo.png"
    [ -f "$src" ] || { echo "missing icon: $src" >&2; exit 1; }
    cp "$src" "$OUT/Assets/$logo.png"
done

# sed, not a template engine: four fixed tokens. The delimiter is | because a
# publisher CN contains commas, spaces and dots but never a pipe.
sed -e "s|__MSIX_IDENTITY_NAME__|$IDENTITY_NAME|g" \
    -e "s|__MSIX_PUBLISHER__|$PUBLISHER|g" \
    -e "s|__MSIX_VERSION__|$MSIX_VERSION|g" \
    -e "s|__MSIX_ARCH__|$ARCH|g" \
    "$manifest_src" > "$OUT/AppxManifest.xml"

# A leftover token is a manifest packaged with a literal `__MSIX_...__` in it,
# which makeappx accepts and the Store rejects — the slowest possible way to
# find out.
if grep -q '__MSIX_' "$OUT/AppxManifest.xml"; then
    echo "unsubstituted token left in $OUT/AppxManifest.xml:" >&2
    grep -n '__MSIX_' "$OUT/AppxManifest.xml" >&2
    exit 1
fi

echo "staged $ARCH payload in $OUT (version $MSIX_VERSION)"

if [ "$STAGE_ONLY" -eq 1 ]; then
    echo "--stage-only: not calling makeappx"
    exit 0
fi

if ! command -v makeappx.exe >/dev/null 2>&1; then
    echo "makeappx.exe is not on PATH — it ships with the Windows SDK." >&2
    echo "On a non-Windows host, use --stage-only." >&2
    exit 1
fi

# No signing here, deliberately: the Microsoft Store re-signs the package, which
# is the entire economics of this channel (spec §Problem). Signing locally is for
# the winapp debug loop, not for submission.
makeappx.exe pack /d "$OUT" /p "$OUT.msix" /o
echo "packed $OUT.msix"
