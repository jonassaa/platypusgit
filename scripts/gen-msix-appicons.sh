#!/bin/sh
# Render the Store package's target-size app-list icon ladder.
#
#   sh scripts/gen-msix-appicons.sh
#
# Output: src-tauri/icons/msix/Square44x44Logo.targetsize-<N>.png, committed.
#
# WHY THIS LADDER EXISTS AT ALL: without target-size assets Windows draws the
# app-list icon on a SYSTEM ICON PLATE — a rounded square filled with the user's
# accent colour, which is blue on a default install — everywhere the icon is
# shown without tile padding: taskbar, Start, the all-apps list, task view,
# ALT+TAB, snap assist and search results. Microsoft states it flatly:
#
#   "If you do not include the targetsize-*-altform-unplated assets above your
#    icon will scale to a smaller size and will get an undesirable backplate
#    behind the icon on Taskbar and Start."
#   — learn.microsoft.com/windows/apps/design/iconography/app-icon-construction
#
# The plate is drawn to guarantee contrast for icons that assume one. Ours does
# not: app-icon.svg is transparent and reads on light and dark alike, so the
# plate is pure damage. `Square44x44Logo` alone does NOT suppress it — the
# suppression is the `_altform-unplated` candidate, and Windows only sees any of
# these through the package's resources.pri (built by scripts/msix-pack.sh).
#
# WHY A SEPARATE SCRIPT FROM `tauri icon`: `tauri icon` renders the square tile
# set (Square44x44Logo, Square150x150Logo, StoreLogo, …) and nothing else — it
# has no notion of MRM qualifiers. Its output lands directly in
# `src-tauri/icons/`, which docs/dev/distribution.md pins as "exactly two
# hand-authored files, everything else is output". This ladder is output too,
# but from a DIFFERENT generator, so it gets its own subdirectory rather than
# being sprinkled among files a `tauri icon` re-run would clobber.
#
# WHY THE OUTPUT IS COMMITTED: the release runs on a Windows runner with no SVG
# rasteriser. Same model as the rest of `src-tauri/icons/` — render on a
# developer machine, review the PNGs in the diff, commit them.
#
# Re-run this whenever app-icon.svg changes. `src-tauri/tests/msix_identity.rs`
# fails the build if the ladder and the packer's size list drift apart.
set -eu

# The sizes Windows asks for, from the "App List Target Size (Required)" list in
# the doc above. They are exact pixel sizes, not scale factors: Windows picks the
# exact match for the user's DPI, so a missing size is a rescale of a neighbour.
# 256 is the ceiling that keeps Windows scaling DOWN and never up.
SIZES="16 20 24 30 32 36 40 48 60 64 72 80 96 256"

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
src="$root/src-tauri/icons/app-icon.svg"
out="$root/src-tauri/icons/msix"

[ -f "$src" ] || { echo "missing master icon: $src" >&2; exit 1; }

# rsvg-convert first: it is headless and silent. Inkscape works but warns about
# CVDisplayLink on a Mac and is slower per invocation. Either renders the vector
# AT the target size, which is the point — downscaling one big raster to 16px
# turns a 0.9-unit eye into mud, and this mark is mostly small round shapes.
if command -v rsvg-convert >/dev/null 2>&1; then
    RENDERER=rsvg
elif command -v inkscape >/dev/null 2>&1; then
    RENDERER=inkscape
else
    echo "no SVG rasteriser found. Install one:" >&2
    echo "  brew install librsvg      # provides rsvg-convert (preferred)" >&2
    echo "  brew install --cask inkscape" >&2
    exit 1
fi

mkdir -p "$out"

for n in $SIZES; do
    dest="$out/Square44x44Logo.targetsize-$n.png"
    case "$RENDERER" in
        rsvg)
            rsvg-convert --width "$n" --height "$n" --output "$dest" "$src"
            ;;
        inkscape)
            # --export-area-page keeps the viewBox framing; the master's 5.6%
            # safe margin is part of the design, not slack to crop away.
            inkscape --export-type=png --export-area-page \
                --export-width="$n" --export-height="$n" \
                --export-filename="$dest" "$src" >/dev/null 2>&1
            ;;
    esac
    [ -s "$dest" ] || { echo "renderer produced nothing for ${n}px" >&2; exit 1; }
    echo "rendered ${n}x${n} -> ${dest#"$root/"}"
done

echo
echo "Done. scripts/msix-pack.sh stages each of these THREE times — as the"
echo "default, _altform-unplated and _altform-lightunplated candidate — so the"
echo "count in src-tauri/icons/msix/ is one per size, not three."
