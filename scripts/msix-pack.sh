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
# Square310x310Logo is deliberately ABSENT: the manifest cannot name it without
# also naming a Wide310x150Logo we do not render (see Package.appxmanifest), so
# copying it would put an unreferenced file in the package. If the large tile is
# ever added, it comes back here together with the wide asset.
LOGOS="Square44x44Logo Square71x71Logo Square150x150Logo StoreLogo"

# The target-size app-list ladder, rendered by scripts/gen-msix-appicons.sh into
# src-tauri/icons/msix/. Keep in step with that script's SIZES —
# src-tauri/tests/msix_identity.rs fails the build if the two lists disagree or
# if a file named here is missing.
#
# THIS IS THE FIX FOR THE BLUE PLATE. Shipping only Square44x44Logo.png makes
# Windows draw the icon on a system icon plate — a rounded square in the user's
# accent colour, blue by default — on the taskbar, Start, the all-apps list,
# task view, ALT+TAB and snap assist. The plate exists to guarantee contrast for
# icons that assume one; ours is transparent and needs none.
TARGETSIZES="16 20 24 30 32 36 40 48 60 64 72 80 96 256"

# Each size is staged under all THREE candidate names below, byte-identical.
# Microsoft: "Separate files for all three theme variations (default, light
# theme, dark theme) are required, even if the icon is the same. If you do not
# provide these files, your icon will appear on a system icon plate to ensure a
# minimum contrast ratio." Identical is correct HERE specifically because the
# mark is transparent and reads on light and dark alike — an icon with a plated
# background of its own would need three genuinely different renders.
#
# Spelled out as three cp lines below rather than a nested loop over a suffix
# list: one of the three suffixes is the EMPTY string, which POSIX word
# splitting cannot carry in a list, and faking it with a sentinel costs more
# than it saves.

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

for n in $TARGETSIZES; do
    src="$root/src-tauri/icons/msix/Square44x44Logo.targetsize-$n.png"
    [ -f "$src" ] || {
        echo "missing target-size icon: $src" >&2
        echo "Re-render the ladder: sh scripts/gen-msix-appicons.sh" >&2
        exit 1
    }
    cp "$src" "$OUT/Assets/Square44x44Logo.targetsize-$n.png"
    cp "$src" "$OUT/Assets/Square44x44Logo.targetsize-${n}_altform-unplated.png"
    cp "$src" "$OUT/Assets/Square44x44Logo.targetsize-${n}_altform-lightunplated.png"
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
    echo "--stage-only: not calling makepri or makeappx"
    exit 0
fi

# Both tools, checked together: they live in the SAME Windows SDK bin directory,
# so a missing one is always the same missing PATH entry. makepri is not
# optional — see the resource-index step below.
for tool in makepri.exe makeappx.exe; do
    command -v "$tool" >/dev/null 2>&1 && continue
    echo "$tool is not on PATH." >&2
    echo >&2
    echo "It ships with the Windows 10 SDK, but the SDK's bin directory is NOT" >&2
    echo "on PATH by default — including on GitHub's windows runners, which is" >&2
    echo "how the v0.2.0 release failed here. Add it:" >&2
    echo >&2
    # printf, not echo: POSIX `echo` interprets backslash escapes, so this path
    # printed as `10in\<version>d` — `\b` became a backspace and `\x64` became
    # the character 0x64. A Windows path is nothing but backslashes.
    printf '  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\<version>\\x64"\n' >&2
    echo >&2
    echo "There is no ARM build of makepri; the x64 one runs fine under" >&2
    echo "emulation. On a non-Windows host, use --stage-only instead." >&2
    exit 1
done

# No signing here, deliberately: the Microsoft Store re-signs the package, which
# is the entire economics of this channel (spec §Problem). Signing locally is for
# the winapp debug loop, not for submission.
# MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL ARE LOAD-BEARING, not belt-and-braces.
# Under Git Bash — which is what `shell: bash` is on a Windows runner — the MSYS
# runtime rewrites arguments that look like POSIX absolute paths before a native
# Windows binary sees them. `/d` becomes `D:/`, and `/p` and `/o` become paths
# under the Git installation. The v0.2.0 re-run failed exactly here:
#
#   MakeAppx : error: Unknown command line option: "D:/"
#
# makeappx takes DOS-style switches, so every flag it has is affected. Both
# variables are set because the name differs between Git for Windows
# (MSYS_NO_PATHCONV) and MSYS2 proper (MSYS2_ARG_CONV_EXCL); on a non-MSYS host
# they are simply ignored.
# Exported rather than prefixed onto the command: the conversion is done by the
# MSYS runtime of the SPAWNING shell, so putting it in this shell's own
# environment leaves no doubt about which process reads it.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# Build the resource index. WITHOUT THIS THE TARGET-SIZE LADDER IS DEAD WEIGHT:
# the qualifiers that pick a candidate (`targetsize-48`, `_altform-unplated`)
# live in the FILENAME, and nothing reads a filename as a qualifier except the
# Modern Resource Manager reading resources.pri. `makeappx pack` does not build
# one. A package without it resolves `Square44x44Logo` to the single literal
# file the manifest names, every variant beside it is ignored, and Windows —
# finding no unplated candidate — draws the accent-coloured plate. Microsoft:
#
#   "If you create target-based assets as described in the section above ...
#    you'll have to generate a new PRI file."
#   — learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-manual-conversion
#
# The config file is written OUTSIDE the payload directory on purpose. The
# documented flow puts priconfig.xml in the package root, where makeappx then
# packages it — harmless but it ships a build artifact to every user, and it
# makes the payload tree stop matching what the shape gate expects to find.
priconfig="$OUT.priconfig.xml"
rm -f "$priconfig"
makepri.exe createconfig /cf "$priconfig" /dq en-US /o

# Drop the <packaging> block. It declares autoResourcePackage qualifiers
# (Language, Scale, DXFeatureLevel) that ask makepri to SPLIT its output into
# per-qualifier resource packages — a shape that belongs to a bundle assembled
# by makepri, not to the two single-arch packages this script produces and
# release.yml bundles itself. One package, one resources.pri, nothing to lose
# track of.
sed -i.bak '/<packaging>/,/<\/packaging>/d' "$priconfig"
rm -f "$priconfig.bak"

# /pr is the project root makepri indexes; /of names the index it writes. It
# lands INSIDE the payload because that is where Windows looks for it, and it is
# written after the scan, so it never indexes itself.
makepri.exe new /pr "$OUT" /cf "$priconfig" /of "$OUT/resources.pri" /o
rm -f "$priconfig"

# makepri exits 0 having written nothing in at least one failure mode (an
# AppxManifest it could not read), and the package that follows would look
# perfectly well-formed while being the exact bug this whole step exists to fix.
[ -s "$OUT/resources.pri" ] || {
    echo "makepri produced no resources.pri in $OUT" >&2
    exit 1
}

makeappx.exe pack /d "$OUT" /p "$OUT.msix" /o
echo "packed $OUT.msix"
