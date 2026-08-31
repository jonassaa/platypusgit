#!/bin/sh
# One-time setup for the platypusgit Microsoft Store listing.
#
# Walks the eight steps that live OUTSIDE this git repository — in Partner Center
# and behind a government ID check — and that therefore no code review can see.
# Those are exactly the steps that get half-done and then debugged months later
# as a mystery submission rejection.
#
#   sh scripts/msstore-wizard.sh            # walk the steps
#   sh scripts/msstore-wizard.sh --dry-run  # print them, change nothing
#
# UNLIKE THE APT AND SCOOP WIZARDS, this one automates almost nothing, and that
# is not laziness: every step here is a form in a browser or an identity check on
# a phone. What it does instead is (a) carry the traps, in the order you hit
# them, and (b) turn the two values Partner Center assigns into the exact
# msix-pack.sh invocation, which is the one place a typo is silent.
#
# INTERACTIVE ON PURPOSE. Never piped into a shell — it reads stdin, prompts, and
# waits. Run it from a terminal and read the step before answering it.
#
# Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md  (§G)
set -eu

OWNER=jonassaa
REPO=platypusgit
PRODUCT=platypusgit
# Trailing slash: the site serves /privacy/ and 301s the unslashed form. This is
# the value that gets pasted into Partner Center, so it is the canonical one.
PRIVACY_URL=https://www.platypusgit.com/privacy/
STORE_SIGNUP=https://storedeveloper.microsoft.com
PARTNER_CENTER=https://partner.microsoft.com/dashboard
PARTNER_APPS=https://aka.ms/submitwindowsapp

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MANIFEST="$root/src-tauri/windows/Package.appxmanifest"
DRY_RUN=no

usage() {
    cat <<'USAGE'
Usage: msstore-wizard.sh [--dry-run]

One-time setup for the platypusgit Microsoft Store listing. Interactive; run it
from a terminal.

  --dry-run       print what each step involves and change nothing
  -h, --help      this text
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn ""; warn "msstore-wizard: $*"; exit 1; }

step() {
    say ""
    say "──────────────────────────────────────────────────────────────"
    say " $*"
    say "──────────────────────────────────────────────────────────────"
}

# Waits for a plain Enter, or `s` to skip. Never proceeds on its own — the whole
# point of a wizard is that a human looked at the step. Under --dry-run it
# continues without asking, so the full walk can be reviewed without a terminal.
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

# Reads one value. Under --dry-run it never touches stdin and reports a
# placeholder, so the walk stays reviewable in a pipe.
ask() {
    if [ "$DRY_RUN" = yes ]; then
        printf '%s [dry-run: not asked]\n' "$1" >&2
        printf '<%s>' "$2"
        return 0
    fi
    printf '%s ' "$1" >&2
    read -r value || die "no input"
    [ -n "$value" ] || die "empty value for $2"
    printf '%s' "$value"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=yes; shift ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# ─── preflight ───────────────────────────────────────────────────────────────

[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

# `gh` is OPTIONAL here, unlike the other two wizards: seven of the eight steps
# are a browser and a phone camera, and requiring an authenticated CLI to read a
# checklist would be a bad trade. It is used only to look up the release asset.
HAVE_GH=no
if command -v gh > /dev/null 2>&1 && gh auth status > /dev/null 2>&1; then
    HAVE_GH=yes
fi

say "platypusgit Microsoft Store — one-time setup"
say ""
say "  product name   $PRODUCT  (to reserve)"
say "  manifest       src-tauri/windows/Package.appxmanifest"
say "  privacy URL    $PRIVACY_URL"
say "  account type   Individual (free)"
say "  gh available   $HAVE_GH"
if [ "$DRY_RUN" = yes ]; then
    say ""
    say "  DRY RUN — nothing will be created, asked or pushed."
fi

# ─── 1. the account ──────────────────────────────────────────────────────────

step "1/8  The developer account"

say "ALREADY HAVE A MICROSOFT DEVELOPER ACCOUNT? Skip this step entirely."
say "Microsoft's own FAQ: 'this flow is only for new individual developers"
say "creating their account for the first time.' Go straight to:"
say ""
say "  $PARTNER_APPS"
say ""
say "FIRST ACCOUNT? Then the entry point matters — open:"
say ""
say "  $STORE_SIGNUP"
say ""
say "That page states it is the ONLY supported entry point for the fee-free"
say "flow: 'Other paths (e.g. direct via Partner Center, Xbox, or Visual"
say "Studio) will show the legacy flow.' The \$19 registration fee is waived in"
say "the new flow. Microsoft does not document what the legacy flow costs, so"
say "the safe move is simply to start at the URL above."
say ""
say "Choose 'Get started for free', then 'Individual developer'."
say "Store policy 10.14 reserves Company accounts for organisations and for"
say "anyone acting in relation to their trade or profession; a personal side"
say "project is an Individual account."
say ""
say "Verification is a government-issued ID plus a selfie, on a phone, in good"
say "light. Nobody can do this step for you."
confirm "Account ready (existing or newly verified)?" || say "Skipped."

# ─── 2. the name ─────────────────────────────────────────────────────────────

step "2/8  Reserve the product name '$PRODUCT'"

say "In Partner Center: Apps and games > New product > MSIX or PWA app."
say ""
say "Policy 10.1.1 requires the title to be unique and to carry no marketing or"
say "descriptive text — '$PRODUCT' qualifies as-is. Do not reserve"
say "'platypusgit - git client'; the descriptive half is what gets rejected."
confirm "Name reserved?" || say "Skipped."

# ─── 3. the identity ─────────────────────────────────────────────────────────

step "3/8  Copy the assigned package identity"

say "In the product: Product management > Product identity."
say ""
say "Partner Center ASSIGNS these. They are not yours to choose, and they must"
say "match the manifest character for character or the upload is rejected:"
say ""
say "  Package/Identity/Name        e.g. 12345Publisher.platypusgit"
say "  Package/Identity/Publisher   e.g. CN=ABCDEF12-3456-..., O=..., L=..."
say ""
say "They are NOT committed in the manifest, deliberately: it ships"
say "__MSIX_IDENTITY_NAME__ and __MSIX_PUBLISHER__ tokens, and"
say "src-tauri/tests/msix_identity.rs fails the build if either is replaced by a"
say "real value. That way a package built locally can never quietly claim the"
say "Store identity, and the substitution step cannot be forgotten."
say ""

if confirm "Enter them now, and I will print the exact pack command?"; then
    identity_name="$(ask 'Identity/Name:' IDENTITY_NAME)"
    publisher="$(ask 'Identity/Publisher (the whole CN=... string):' PUBLISHER)"

    case "$publisher" in
        CN=*) ;;
        *) warn "" ; warn "WARNING: a Store publisher always begins 'CN='. Got: $publisher" ;;
    esac

    say ""
    say "THE RELEASE READS THESE FROM REPOSITORY VARIABLES. Set them once:"
    say ""
    say "  gh variable set MSIX_IDENTITY_NAME --body '$identity_name'"
    say "  gh variable set MSIX_PUBLISHER     --body '$publisher'"
    say ""
    say "They are public values — they ship inside every installed package — so"
    say "they are variables, not secrets. release.yml FAILS the msix job if"
    say "either is unset, rather than attaching a bundle stamped with the"
    say "development identity that Partner Center would reject."
    say ""
    say "For a one-off local pack, pass them directly instead:"
    say ""
    say "  sh scripts/msix-pack.sh --version <X.Y.Z> --arch x64 \\"
    say "      --exe src-tauri/target/x86_64-pc-windows-msvc/release/platypusgit.exe \\"
    say "      --out msix-x64 \\"
    say "      --identity-name '$identity_name' \\"
    say "      --publisher '$publisher'"
    say ""
    say "Nothing was written to disk by this wizard."
else
    say "Skipped — you can re-run this step alone later."
fi

# ─── 4. age ratings ──────────────────────────────────────────────────────────

step "4/8  Age ratings (IARC questionnaire)"

say "Policy 11.11: every question must be answered, and you are responsible for"
say "the answers being accurate. A developer tool answers 'no' to essentially"
say "all of the content questions, but the questionnaire is still mandatory and"
say "the submission cannot be completed without it."
confirm "Questionnaire completed?" || say "Skipped."

# ─── 5. restricted capabilities ──────────────────────────────────────────────

step "5/8  Justify the restricted capability"

say "The manifest declares:  <rescap:Capability Name=\"runFullTrust\" />"
say ""
say "That is a RESTRICTED capability, which makes Partner Center's 'Restricted"
say "capabilities' field REQUIRED and asks you to justify it. Expect this; it is"
say "routine for a packaged desktop app, but it is not skippable."
say ""
say "Suggested wording:"
say ""
say "  platypusgit is a git client. It runs the user's own installed git as a"
say "  child process and reads the repositories the user chooses to open."
say "  Without full trust it would run in an app container and could do neither,"
say "  which is the entire function of the app."
confirm "Justification entered?" || say "Skipped."

# ─── 6. the description ──────────────────────────────────────────────────────

step "6/8  Write the description — git goes in the FIRST line"

say "Policy 10.2.4 permits depending on non-integrated software to deliver"
say "primary functionality ONLY IF the dependency is disclosed AT THE BEGINNING"
say "of the description. platypusgit shells out to real git; the .deb already"
say "declares 'Depends: git'. This is the same fact, said where the Store"
say "requires it."
say ""
say "So the description must OPEN with something like:"
say ""
say "  Requires git to be installed on your PC."
say ""
say "Not a footnote, not a system-requirements field — the first line."
confirm "Description written with the dependency first?" || say "Skipped."

# ─── 7. the privacy policy ───────────────────────────────────────────────────

step "7/8  Privacy policy URL"

say "Properties > Privacy policy URL:"
say ""
say "  $PRIVACY_URL"
say ""
say "Policy 10.5.1 requires this for a Win32 or Desktop Bridge product whether"
say "or not it collects anything, so 'we collect nothing' is not an exemption."
say "The page is served from site/src/pages/privacy.astro in this repository."
confirm "URL entered?" || say "Skipped."

# ─── 8. the upload ───────────────────────────────────────────────────────────

step "8/8  Upload the msixbundle"

say "Packages > upload PlatypusGit.msixbundle from the GitHub release."
say "release.yml's 'msix' job builds and attaches it; you do not build it by hand."
say ""
if [ "$HAVE_GH" = yes ] && [ "$DRY_RUN" = no ]; then
    say "Looking for the asset on the latest release..."
    if gh release view --repo "$OWNER/$REPO" \
        --json assets --jq '.assets[].name' 2>/dev/null \
        | grep -q 'msixbundle'; then
        say "  found: PlatypusGit.msixbundle is attached to the latest release."
    else
        say "  NOT FOUND on the latest release."
        say "  Expected once a release is cut after the msix job landed. Until"
        say "  then there is nothing to upload — finish steps 1-7 and come back."
    fi
else
    say "(skipping the release-asset lookup: gh unavailable or --dry-run)"
fi
say ""
say "Do NOT sign the bundle first. The Store re-signs it, which is the whole"
say "reason this channel costs nothing."
confirm "Uploaded?" || say "Skipped."

# ─── what you should have now ────────────────────────────────────────────────

step "Done — what you should have now"

say "  1. An Individual developer account, created via $STORE_SIGNUP"
say "     (fee-free — any other entry point charges)."
say "  2. The name '$PRODUCT' reserved."
say "  3. Identity Name + Publisher stored as the MSIX_IDENTITY_NAME and"
say "     MSIX_PUBLISHER repository variables. Never committed to the tree."
say "  4. Age ratings completed."
say "  5. runFullTrust justified."
say "  6. A description whose FIRST line names the git dependency."
say "  7. $PRIVACY_URL set as the privacy policy URL."
say "  8. PlatypusGit.msixbundle uploaded, unsigned."
say ""
say "Then: Submit for certification, and record what the first submission"
say "teaches. One claim in particular is UNVERIFIED and this is where it gets"
say "settled — whether the MSIX version's fourth part really must be 0. If the"
say "upload disagrees, fix scripts/msix-pack.sh and the spec's §E together."
say ""
say "Partner Center: $PARTNER_CENTER"
