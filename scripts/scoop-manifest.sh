#!/bin/sh
# Render the Scoop manifest for the platypusgit bucket (#187, Windows half).
#
#   sh scripts/scoop-manifest.sh --version 0.1.0 --hash <sha256> --out bucket/platypusgit.json
#   sh scripts/scoop-manifest.sh --version 0.1.0 --hash <sha256>          # to stdout
#
# WHY A GENERATOR IN THIS REPOSITORY, and not a manifest committed in the bucket
# repo and patched in place by CI: the manifest is the artifact users install
# from, so it should be reviewable here, runnable here, and impossible to drift
# from a second copy nobody reads. Same argument as scripts/apt-repo-publish.sh,
# which is why the two look alike.
#
# Called by release.yml's `bump-scoop`. Safe to run locally — it writes one file
# and touches no network.
#
# Spec: docs/superpowers/specs/2026-08-27-scoop-bucket-spec.md  (§D)
set -eu

REPO_URL=https://github.com/jonassaa/platypusgit
ASSET=PlatypusGit_x64_portable.zip
HOMEPAGE=https://www.platypusgit.com
LICENSE_ID=GPL-3.0-only

VERSION=
HASH=
URL=
OUT=

usage() {
    cat <<'USAGE'
Usage: scoop-manifest.sh --version X.Y.Z --hash <sha256> [--url URL] [--out FILE]

Renders the Scoop manifest for platypusgit.

  --version X.Y.Z   release version, without a leading v
  --hash <sha256>   sha256 of PlatypusGit_x64_portable.zip (64 hex chars)
  --url URL         override the download URL (default: the release tag URL)
  --out FILE        write here instead of stdout
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
        --hash)    HASH="${2:?--hash needs a value}"; shift 2 ;;
        --url)     URL="${2:?--url needs a value}"; shift 2 ;;
        --out)     OUT="${2:?--out needs a value}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "scoop-manifest.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [ -z "$VERSION" ] || [ -z "$HASH" ]; then
    echo "scoop-manifest.sh: --version and --hash are both required" >&2
    exit 2
fi

# Validated rather than trusted, because both failures are invisible in review
# and only surface as a Scoop error on a stranger's machine: a wrong `version`
# makes `scoop update` a no-op forever, and a wrong `hash` makes every install
# fail with "hash check failed" against a download that is actually fine.
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
    echo "scoop-manifest.sh: --version must be a bare semver (got '$VERSION')" >&2
    exit 2
fi
if ! printf '%s' "$HASH" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    echo "scoop-manifest.sh: --hash must be 64 hex characters (got '$HASH')" >&2
    exit 2
fi

# THE TAG URL, NOT releases/latest/download. Every other channel uses the stable
# latest-download path on purpose so the Homebrew cask can track it; a Scoop
# manifest pins a `hash` to one specific build, and the stable path MOVES on the
# next release — which would hash-mismatch every install in the window between a
# release and its bump. Tag URL and hash move together, in one commit.
if [ -z "$URL" ]; then
    URL="${REPO_URL}/releases/download/v${VERSION}/${ASSET}"
fi

# `bin` carries pgit.cmd as well as the exe, and that is load-bearing rather
# than a convenience: cli.rs::shim_status looks for a file named `pgit.cmd` on
# PATH, so without this entry a Scoop install has no `pgit`, AND Settings would
# offer to write a competing shim into %LOCALAPPDATA% that Scoop neither knows
# about nor removes on uninstall. See the spec's §C.
#
# `architecture.64bit` rather than a top-level url/hash so arm64 is one more key
# later, not a rewrite — the lesson #187 recorded for the apt pool.
#
# The `$version` in the autoupdate URL is LITERAL and must stay that way: jq
# interpolates with \(...), so a bare $version inside a string is text, and it is
# Scoop that substitutes it when checkver finds a new tag. Do not "fix" it into
# an interpolation — that would freeze autoupdate at the version we happened to
# publish with.
manifest=$(jq -n \
    --arg version "$VERSION" \
    --arg url "$URL" \
    --arg hash "$HASH" \
    --arg homepage "$HOMEPAGE" \
    --arg license "$LICENSE_ID" \
    --arg repo "$REPO_URL" \
    --arg asset "$ASSET" \
    '{
      version: $version,
      description: "A dev-first git desktop app. Cross-platform, no account, no telemetry.",
      homepage: $homepage,
      license: $license,
      architecture: {
        "64bit": { url: $url, hash: $hash }
      },
      bin: ["platypusgit.exe", "pgit.cmd"],
      shortcuts: [["platypusgit.exe", "platypusgit"]],
      notes: [
        "Scoop owns updates for this install: run `scoop update platypusgit`. The in-app updater is switched off here on purpose, so the two can never disagree about which copy you are running.",
        "`platypusgit` and `pgit` are both on your PATH via Scoop shims.",
        "Needs the WebView2 runtime. Windows 11 ships it and Windows 10 gets it with Edge, so it is almost certainly already there — but unlike the .msi this package cannot install it for you. If no window appears, install the Evergreen WebView2 Runtime from Microsoft."
      ],
      checkver: { github: $repo },
      autoupdate: {
        architecture: {
          "64bit": { url: ($repo + "/releases/download/v$version/" + $asset) }
        }
      }
    }')

if [ -n "$OUT" ]; then
    printf '%s\n' "$manifest" > "$OUT"
    echo "scoop-manifest.sh: wrote $OUT (version $VERSION)"
else
    printf '%s\n' "$manifest"
fi
