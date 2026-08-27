#!/bin/sh
# One-time setup for publishing platypusgit to the Windows Package Manager.
#
# Walks the six steps that live OUTSIDE this git repository: a Microsoft CLA
# signature, a fork of microsoft/winget-pkgs, a manifest-authoring tool, the
# first submission, a classic personal access token, and the repo secret the
# release job reads. Same reason as scripts/apt-repo-wizard.sh — none of it is
# visible to code review, and a half-finished setup surfaces months later as a
# release job that quietly stopped publishing.
#
#   sh scripts/winget-wizard.sh              # walk the steps
#   sh scripts/winget-wizard.sh --dry-run    # print them, change nothing
#   sh scripts/winget-wizard.sh --version 0.1.2   # target a specific release
#
# INTERACTIVE ON PURPOSE. Never pipe this into a shell — it prompts, reads
# stdin, and opens a browser. Run it from a terminal and read each step before
# answering it.
#
# It is idempotent: every step detects work already done and skips it, so a run
# interrupted halfway can simply be re-run.
#
# AFTER THIS SCRIPT there is a wait, not a command: the winget-pkgs pull request
# goes through a 10-step validation pipeline and then a human moderator. Nothing
# here can hurry that, and the package is not installable until it merges.
set -eu

OWNER=jonassaa
APP_REPO=platypusgit
UPSTREAM=microsoft/winget-pkgs
FORK="$OWNER/winget-pkgs"

# The winget identity. PackageIdentifier is Publisher.Package and is effectively
# permanent — renaming a published package means a deprecation and a fresh
# submission — so it is spelled out here rather than prompted for.
#
# `PUBLISHER` must equal `bundle.publisher` in src-tauri/tauri.conf.json, which
# is what the .msi writes to Add/Remove Programs. If they drift, winget cannot
# correlate an installed copy with this manifest and `winget upgrade` stops
# seeing it. src-tauri/tests/msi_identity.rs pins the config side.
IDENTIFIER="JonasAasberg.PlatypusGit"
PUBLISHER="Jonas Aasberg"
# PACKAGE_NAME must match the .msi's ARP DisplayName, which Tauri takes from
# `productName` — lowercase, deliberately (see docs/dev/distribution.md). A
# mismatch here is not fatal but forces an AppsAndFeaturesEntries.DisplayName
# into every future manifest.
PACKAGE_NAME="platypusgit"
MONIKER="platypusgit"
PACKAGE_URL="https://www.platypusgit.com"
PUBLISHER_URL="https://www.platypusgit.com"
LICENSE="GPL-3.0-only"
LICENSE_URL="https://github.com/$OWNER/$APP_REPO/blob/main/LICENSE"
SHORT_DESCRIPTION="A developer-focused git client"
MSI_ASSET="PlatypusGit_x64.msi"
SECRET_NAME=WINGET_TOKEN

VERSION=
DRY_RUN=no

usage() {
    cat <<'USAGE'
Usage: winget-wizard.sh [--dry-run] [--version X.Y.Z]

One-time setup for publishing platypusgit to the Windows Package Manager.
Interactive; run it from a terminal, not through a pipe.

Steps, in a fixed order (each one's prerequisite is the one before it):

  1. sign the Microsoft CLA (once per GitHub account, ever)
  2. fork microsoft/winget-pkgs
  3. install Komac, the manifest authoring tool
  4. submit the first manifest, which opens the winget-pkgs pull request
  5. create a CLASSIC personal access token with the public_repo scope
  6. store it as the WINGET_TOKEN secret so the release job can re-submit

Steps 5 and 6 only matter for AUTOMATING later releases. Stopping after step 4
leaves a perfectly good published package that you re-submit by hand.

Options:
  --version X.Y.Z  the release to submit (default: the latest published one)
  --dry-run        print what each step would do and change nothing
  -h, --help       this text
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() {
    warn ""
    warn "winget-wizard: $*"
    exit 1
}

step() {
    say ""
    say "──────────────────────────────────────────────────────────────"
    say " $*"
    say "──────────────────────────────────────────────────────────────"
}

# Waits for a plain Enter, or `s` to skip. Never proceeds on its own — the whole
# point of a wizard is that a human looked at the step. Under --dry-run it
# continues without asking so the full walk can be reviewed without a terminal.
confirm() {
    if [ "$DRY_RUN" = yes ]; then
        printf '%s [dry-run: continuing]\n' "$1"
        return 0
    fi
    printf '%s [Enter to continue, s to skip, q to quit] ' "$1"
    read -r reply || reply=q
    case "$reply" in
        s | S) return 1 ;;
        q | Q) die "stopped at the user's request" ;;
        *) return 0 ;;
    esac
}

# The prompt goes to STDERR, never stdout — the caller captures stdout with
# `$(ask …)`, so a prompt written there would be invisible AND would become part
# of the value. That cost a real debugging session in apt-repo-wizard.sh; the
# same shape is kept here on purpose.
ask() {
    if [ "$DRY_RUN" = yes ]; then
        printf '%s [dry-run]\n' "$1" >&2
        printf 'dry-run-value'
        return 0
    fi
    printf '%s ' "$1" >&2
    read -r reply || reply=
    printf '%s' "$reply"
}

# Same, with the terminal echo off. A token pasted into a visible prompt ends up
# in the scrollback and, on many setups, in the shell history of whatever ran
# this. `stty -echo` is restored through a trap so a Ctrl-C mid-prompt does not
# leave the terminal mute.
ask_secret() {
    if [ "$DRY_RUN" = yes ]; then
        printf '%s [dry-run]\n' "$1" >&2
        printf 'dry-run-token'
        return 0
    fi
    printf '%s ' "$1" >&2
    saved_stty="$(stty -g 2> /dev/null || printf '')"
    if [ -n "$saved_stty" ]; then
        trap 'stty "$saved_stty" 2>/dev/null || true' EXIT INT TERM
        stty -echo 2> /dev/null || true
    fi
    read -r reply || reply=
    if [ -n "$saved_stty" ]; then
        stty "$saved_stty" 2> /dev/null || true
        trap - EXIT INT TERM
    fi
    printf '\n' >&2
    printf '%s' "$reply"
}

would() {
    if [ "$DRY_RUN" = yes ]; then
        say "  would run: $*"
        return 1
    fi
    return 0
}

# Opens a URL in the human's browser, or prints it if we cannot. Never fatal:
# every step also prints the URL so a failure here costs a copy-paste, not the
# run.
open_url() {
    say "  $1"
    if [ "$DRY_RUN" = yes ]; then
        return 0
    fi
    if command -v open > /dev/null 2>&1; then
        open "$1" > /dev/null 2>&1 || true
    elif command -v xdg-open > /dev/null 2>&1; then
        xdg-open "$1" > /dev/null 2>&1 || true
    elif command -v wslview > /dev/null 2>&1; then
        wslview "$1" > /dev/null 2>&1 || true
    fi
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=yes
            shift
            ;;
        --version)
            [ $# -ge 2 ] || die "--version needs a value like 0.1.2"
            VERSION="$2"
            shift 2
            ;;
        --version=*)
            VERSION="${1#--version=}"
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# ─── preflight ───────────────────────────────────────────────────────────────

command -v gh > /dev/null 2>&1 || die "gh is required (https://cli.github.com)"
command -v curl > /dev/null 2>&1 || die "curl is required"
gh auth status > /dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

# Komac forks, commits and opens the pull request through the GitHub API, so it
# needs a token with push rights on a public repo. gh's own token already has
# `repo`, which is a superset of `public_repo` — so the first submission needs
# NO personal access token at all. Steps 5 and 6 exist only because a workflow
# has no gh session to borrow from.
gh auth status 2>&1 | grep -q "'repo'" \
    || warn "note: gh's token does not list the 'repo' scope; step 4 may need 'gh auth refresh -s repo'"

if [ -z "$VERSION" ]; then
    VERSION="$(gh release view --repo "$OWNER/$APP_REPO" --json tagName --jq '.tagName' 2> /dev/null | sed 's/^v//')"
    [ -n "$VERSION" ] || die "could not read the latest release — pass --version X.Y.Z"
fi

TAG="v$VERSION"
MSI_URL="https://github.com/$OWNER/$APP_REPO/releases/download/$TAG/$MSI_ASSET"

say "platypusgit → Windows Package Manager — one-time setup"
say ""
say "  identifier   $IDENTIFIER"
say "  publisher    $PUBLISHER"
say "  version      $VERSION"
say "  installer    $MSI_URL"
say "  fork         $FORK"
if [ "$DRY_RUN" = yes ]; then
    say ""
    say "  DRY RUN — nothing will be created, submitted or stored."
fi

# The installer URL is the one thing here that a typo makes unfixable-in-place:
# winget-pkgs validation downloads it, hashes it, and a manifest whose hash does
# not match the file is rejected. Checking now costs a second; discovering it
# from a bot comment costs a round trip through review.
if [ "$DRY_RUN" = no ]; then
    curl -fsSL -o /dev/null -r 0-0 "$MSI_URL" 2> /dev/null \
        || die "the installer URL is not downloadable: $MSI_URL
  Is $TAG published, and did its build attach $MSI_ASSET?"
fi

# ─── 1. the CLA ──────────────────────────────────────────────────────────────

step "1/6  Sign the Microsoft Contributor License Agreement"

say "Once per GitHub account, ever — not per pull request, and not per repo."
say "Without it the winget-pkgs bot labels the PR Needs-CLA and it cannot merge"
say "no matter how green the validation is."
say ""
say "Sign in with GitHub, read it, agree."
say ""
open_url "https://cla.opensource.microsoft.com/microsoft/winget-pkgs"
say ""
say "There is no way to check this from here — the CLA service has no public"
say "API — so this step is on your word. If you have contributed to a Microsoft"
say "open-source repo before, it is already done."
confirm "Signed (or already had it)?" || say "Skipped — the PR will tell you if it was needed."

# ─── 2. the fork ─────────────────────────────────────────────────────────────

step "2/6  Fork $UPSTREAM"

if gh repo view "$FORK" > /dev/null 2>&1; then
    say "$FORK already exists — skipping."
else
    say "Komac pushes a branch to your fork and opens the pull request from it."
    say "It can create the fork itself, but doing it here means a permissions"
    say "problem surfaces now rather than halfway through a submission."
    say ""
    say "Not cloned: winget-pkgs is enormous and nothing local needs it."
    if confirm "Create the fork?"; then
        if would "gh repo fork $UPSTREAM --clone=false"; then
            gh repo fork "$UPSTREAM" --clone=false > /dev/null
            say "Forked."
        fi
    fi
fi

# ─── 3. Komac ────────────────────────────────────────────────────────────────

step "3/6  Install Komac"

if command -v komac > /dev/null 2>&1; then
    say "Already installed — $(komac --version 2> /dev/null | head -n1)"
else
    say "Komac authors the three manifest files and opens the pull request. It is"
    say "what the winget-releaser action uses in CI, so the manifests this"
    say "produces by hand and the ones produced later by the release job come"
    say "from the same tool."
    say ""
    say "It reads the .msi directly for the values that cannot be guessed —"
    say "ProductCode above all, which Tauri regenerates on every single build"
    say "(main.wxs uses <Product Id=\"*\">), so it can never be hard-coded."
    say ""
    if command -v brew > /dev/null 2>&1; then
        say "  brew install komac"
        if confirm "Install it with Homebrew?"; then
            if would "brew install komac"; then
                brew install komac
            fi
        fi
    elif command -v cargo > /dev/null 2>&1; then
        say "  cargo install --locked komac"
        if confirm "Install it with cargo?"; then
            if would "cargo install --locked komac"; then
                cargo install --locked komac
            fi
        fi
    else
        say "No brew and no cargo found. Download a binary for your platform:"
        open_url "https://github.com/russellbanks/Komac/releases/latest"
        confirm "Installed it?" || true
    fi
    if [ "$DRY_RUN" = no ] && ! command -v komac > /dev/null 2>&1; then
        die "komac is still not on PATH — install it and re-run"
    fi
fi

# ─── 4. the submission ───────────────────────────────────────────────────────

step "4/6  Submit $IDENTIFIER $VERSION"

# The manifests live at manifests/<first letter, lowercased>/<Publisher>/<Package>/<Version>/
FIRST_LETTER="$(printf '%s' "$IDENTIFIER" | cut -c1 | tr '[:upper:]' '[:lower:]')"
ID_PATH="$(printf '%s' "$IDENTIFIER" | tr '.' '/')"
MANIFEST_PATH="manifests/$FIRST_LETTER/$ID_PATH"

if gh api "repos/$UPSTREAM/contents/$MANIFEST_PATH/$VERSION" > /dev/null 2>&1; then
    say "$IDENTIFIER $VERSION is already published — nothing to submit."
    say ""
    say "Later releases go through the release job (steps 5 and 6), not through"
    say "this script."
elif gh api "repos/$UPSTREAM/contents/$MANIFEST_PATH" > /dev/null 2>&1; then
    say "$IDENTIFIER already exists in winget-pkgs, but $VERSION does not."
    say ""
    say "That is the automation's job, not a new-package submission. If the"
    say "release job is already wired up, it will handle this on the next"
    say "release; to do it by hand:"
    say ""
    say "  komac update $IDENTIFIER --version $VERSION --urls $MSI_URL --submit"
    say ""
    confirm "Run that now?" && {
        if would "komac update $IDENTIFIER --version $VERSION"; then
            GITHUB_TOKEN="$(gh auth token)" \
                komac update "$IDENTIFIER" --version "$VERSION" --urls "$MSI_URL" --submit
        fi
    }
else
    say "This opens a pull request against $UPSTREAM."
    say ""
    say "Everything below is pre-filled from this repository. Komac prompts for"
    say "anything it still needs and reads the rest out of the .msi itself —"
    say "architecture, installer type, ProductCode, UpgradeCode."
    say ""
    say "  PackageIdentifier  $IDENTIFIER"
    say "  Publisher          $PUBLISHER"
    say "  PackageName        $PACKAGE_NAME"
    say "  Version            $VERSION"
    say "  Installer          $MSI_URL"
    say ""
    say "After it opens, a 10-step validation pipeline runs and then a human"
    say "moderator reviews it. Expect hours to days. Watch the labels; the"
    say "failure guide is docs/ValidationFailureGuide.md in winget-pkgs."
    say ""
    if confirm "Submit it?"; then
        if would "komac new $IDENTIFIER -v $VERSION -u $MSI_URL --submit"; then
            # gh's token, not a PAT: see the preflight note. Passed through the
            # environment rather than argv so it never reaches a process list.
            GITHUB_TOKEN="$(gh auth token)" \
                komac new "$IDENTIFIER" \
                --version "$VERSION" \
                --urls "$MSI_URL" \
                --publisher "$PUBLISHER" \
                --publisher-url "$PUBLISHER_URL" \
                --package-name "$PACKAGE_NAME" \
                --package-url "$PACKAGE_URL" \
                --moniker "$MONIKER" \
                --author "$PUBLISHER" \
                --license "$LICENSE" \
                --license-url "$LICENSE_URL" \
                --short-description "$SHORT_DESCRIPTION" \
                --submit
        fi
    fi
fi

# ─── 5. the token ────────────────────────────────────────────────────────────

step "5/6  Create a classic personal access token"

say "Only for AUTOMATING later releases. Step 4 borrowed gh's own token; a"
say "GitHub Actions run has no gh session to borrow from, so the release job"
say "needs a token of its own."
say ""
say "It must be a CLASSIC token. winget-releaser does not support fine-grained"
say "tokens — they cannot open a pull request against winget-pkgs."
say ""
say "  Scope:  public_repo   (and nothing else — it only opens PRs on a fork)"
say "  Expiry: pick a long one, or none."
say ""
say "An expiring token does not fail loudly. The release itself still succeeds,"
say "builds and all; only the winget submission stops happening, and it stops"
say "silently. If you set an expiry, put the date somewhere you will see it."
say ""
open_url "https://github.com/settings/tokens/new?scopes=public_repo&description=platypusgit%20winget-releaser"
confirm "Created it? Copy it before you leave that page — GitHub shows it once." || true

# ─── 6. the repo secret ──────────────────────────────────────────────────────

step "6/6  Store it as $SECRET_NAME on $OWNER/$APP_REPO"

STORE_SECRET=yes
if gh secret list --repo "$OWNER/$APP_REPO" 2> /dev/null | grep -q "^$SECRET_NAME"; then
    say "$SECRET_NAME is already set."
    say ""
    if ! confirm "Replace it?"; then
        say "Kept the existing one."
        STORE_SECRET=no
    fi
fi

if [ "$STORE_SECRET" = yes ]; then
    say "Paste the token. It will not be echoed."
    TOKEN="$(ask_secret "Token:")"
    if [ -z "$TOKEN" ]; then
        say "Nothing entered — skipping."
    elif would "gh secret set $SECRET_NAME --repo $OWNER/$APP_REPO"; then
        # The value arrives on stdin, never in argv — an argument is visible in
        # `ps` to every other user on the machine for as long as the call runs.
        printf '%s' "$TOKEN" | gh secret set "$SECRET_NAME" --repo "$OWNER/$APP_REPO" --body -
        say "Stored."
    fi
fi

# ─── done ────────────────────────────────────────────────────────────────────

step "Done"

say "What happens next, in order:"
say ""
say "  1. The winget-pkgs pull request runs 10 validation steps, then waits for"
say "     a moderator. Nothing here can hurry it."
say "  2. When it merges, the package appears in the winget source within about"
say "     an hour:  winget install $IDENTIFIER"
say "  3. Nothing to enable afterwards. release.yml's winget-publish job checks"
say "     for $SECRET_NAME and skips while it is unset, so storing the secret"
say "     in step 6 is what switches it on. Every later release re-submits by"
say "     itself."
say ""
say "Re-running this script is safe: every step above detects work already done."
