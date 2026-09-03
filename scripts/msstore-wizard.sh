#!/bin/sh
# One-time setup for the platypusgit Microsoft Store listing.
#
# Walks the nine steps that live OUTSIDE this git repository — in Partner Center,
# in Microsoft Entra ID, and behind a government ID check — and that therefore no
# code review can see. Those are exactly the steps that get half-done and then
# debugged months later as a mystery submission rejection.
#
# Step 9 is the one that outlives the others: it turns release.yml's
# `msstore-publish` job on, so EVERY LATER RELEASE submits itself. Steps 1-8 are
# done once and then never again.
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

# `gh` is OPTIONAL here, unlike the other two wizards: seven of the nine steps
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

step "1/9  The developer account"

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

step "2/9  Reserve the product name '$PRODUCT'"

say "In Partner Center: Apps and games > New product > MSIX or PWA app."
say ""
say "Policy 10.1.1 requires the title to be unique and to carry no marketing or"
say "descriptive text — '$PRODUCT' qualifies as-is. Do not reserve"
say "'platypusgit - git client'; the descriptive half is what gets rejected."
confirm "Name reserved?" || say "Skipped."

# ─── 3. the identity ─────────────────────────────────────────────────────────

step "3/9  Copy the assigned package identity"

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

step "4/9  Age ratings (IARC questionnaire)"

say "Policy 11.11: every question must be answered, and you are responsible for"
say "the answers being accurate. A developer tool answers 'no' to essentially"
say "all of the content questions, but the questionnaire is still mandatory and"
say "the submission cannot be completed without it."
confirm "Questionnaire completed?" || say "Skipped."

# ─── 5. restricted capabilities ──────────────────────────────────────────────

step "5/9  Justify the restricted capability"

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

step "6/9  Write the description — git goes in the FIRST line"

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

step "7/9  Privacy policy URL"

say "Properties > Privacy policy URL:"
say ""
say "  $PRIVACY_URL"
say ""
say "Policy 10.5.1 requires this for a Win32 or Desktop Bridge product whether"
say "or not it collects anything, so 'we collect nothing' is not an exemption."
say "The page is served from site/src/pages/privacy.astro in this repository."
confirm "URL entered?" || say "Skipped."

# ─── 8. the upload ───────────────────────────────────────────────────────────

step "8/9  Upload the msixbundle"

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

# ─── 9. automate every later submission ──────────────────────────────────────

step "9/9  Turn on automatic submissions for every later release"

say "This is the step that outlives the wizard. Once these five values exist,"
say "release.yml's 'msstore-publish' job submits the msixbundle by itself and"
say "step 8 never has to be done by hand again."
say ""
say "AN INDIVIDUAL ACCOUNT CAN DO THIS. Partner Center's own FAQ says"
say "'Individual accounts do not support multiple users', which reads like a"
say "blocker and is not one — that sentence is about human co-developers. The"
say "submission API's prerequisites only require that you have an Entra"
say "directory, and say that if you do not, 'you can create a new Azure AD in"
say "Partner Center for no additional charge'."
say ""
say "DO IT ALL FROM PARTNER CENTER, signed in as the account that owns the"
say "product — personal Microsoft account and all. You do not need the Entra"
say "portal for any of it:"
say ""
say "  1. Account settings > Tenants > 'Create Microsoft Entra ID' (free)."
say "     Creates the directory AND its global-admin user AND associates it."
say "     Skip if you already have a directory associated."
say "  2. Account settings > Users > add the Entra application, role MANAGER."
say "     Partner Center can CREATE the application here too, if you have not"
say "     already registered one in the directory."
say "  3. Still on the Users page: click the application to read its Tenant ID"
say "     and Client ID, then 'Add new key' for the client secret."
say ""
say "THE ROLE IS THE TRAP. A lesser role than Manager authenticates fine and"
say "then fails the submission call, so the failure reads as a broken pipeline"
say "rather than a permissions mistake made weeks earlier."
say ""
say "THE SECOND TRAP IS THE ASSOCIATION SIGN-IN. 'Associate Microsoft Entra ID"
say "with your Partner Center account' pops up a sign-in that accepts ONLY a"
say "work/school account inside that directory — never a personal Microsoft"
say "account, not even one with the same email address, because the two are"
say "separate identity systems. If your Store account IS a personal account you"
say "have nothing valid to type: either let step 1 above build the directory for"
say "you, or create a member user in the directory first and sign in as that."
say "Use a private browser window, or the browser silently reuses your personal"
say "session and the dialog looks broken."
say ""
say "WHERE EACH VALUE ACTUALLY LIVES:"
say "  Tenant ID       Users page > the application  (or Entra > Overview)"
say "  Client ID       the application's 'Application (client) ID'. NOT its"
say "                  Object ID, and not the service principal's object ID."
say "  Client secret   Users page > the application > 'Add new key' > Key"
say "                  (Entra calls it Certificates & secrets > Value)."
say "                  SHOWN ONCE — copy it before leaving the page."
say "  Seller ID       a PLAIN NUMBER, e.g. 95888980. The CLI parses it as an"
say "                  integer, so anything with 'CN=' or hyphens is the wrong"
say "                  field — the publisher IDs on the Identifiers page are"
say "                  NOT it. Account settings > Legal info > Developer:"
say "                  https://partner.microsoft.com/dashboard/account/v3/organization/legalinfo#mpn"
say "                  Easier: 'msstore reconfigure' looks it up for itself"
say "                  from the enrollment-accounts API and prints 'Found an"
say "                  enrollment account, using it.'"
say ""
say "Store them as repository secrets. Note there is NO --body: gh reads each"
say "value from a hidden prompt, so it never reaches argv, the screen, or shell"
say "history."
say ""
say "  gh secret set MSSTORE_TENANT_ID"
say "  gh secret set MSSTORE_SELLER_ID"
say "  gh secret set MSSTORE_CLIENT_ID"
say "  gh secret set MSSTORE_CLIENT_SECRET"
say ""

if confirm "Enter the Store product ID now, and I will print its command?"; then
    product_id="$(ask 'Store product ID (the 9... from the listing URL):' PRODUCT_ID)"

    case "$product_id" in
        9*) ;;
        *) warn "" ; warn "WARNING: a Store product ID normally begins '9'. Got: $product_id" ;;
    esac

    say ""
    say "  gh variable set MSSTORE_PRODUCT_ID --body '$product_id'"
    say ""
    say "A VARIABLE, not a secret — it is in the listing's public URL, and the"
    say "same reasoning as MSIX_IDENTITY_NAME applies."
else
    say "  gh variable set MSSTORE_PRODUCT_ID --body '<the 9... id>'"
fi

say ""
say "The product ID is on Product management > Product identity, but you never"
say "have to go looking: 'msstore apps list' prints it, and so does the PUBLIC"
say "catalog, which is the one source that needs no credentials at all —"
say ""
say "  curl -s 'https://storeedgefd.dsx.mp.microsoft.com/v9.0/search?query=$PRODUCT&market=US&locale=en-US&deviceFamily=Windows.Desktop'"
say ""
say "Check the PackageFamilyNames in that response against MSIX_IDENTITY_NAME"
say "before trusting the ProductId — that is what proves it is YOUR listing and"
say "not a same-named app. Note the id starts '9' but not necessarily '9N'."
say ""
say "VERIFY LOCALLY, NOT BY DISPATCHING A RELEASE:"
say ""
say "  brew install microsoft/msstore-cli/msstore-cli"
say "  msstore reconfigure     # prompts; no secret on argv"
say "  msstore apps list       # fails immediately if the role is wrong"
say ""
say "A workflow_dispatch run against an existing tag would rebuild every bundle"
say "AND overwrite latest.json's notes with a bare link for users who already"
say "installed — see docs/dev/releasing.md. Never spend that to test this."
say ""
say "ONCE CI SUBMITS, STOP HAND-EDITING THAT SUBMISSION IN PARTNER CENTER."
say "Microsoft's warning is blunt: edit a submission in the dashboard that the"
say "API created and 'you will no longer be able to change or commit that"
say "submission by using the API', sometimes leaving it stuck in an error state"
say "that has to be deleted. Listing edits belong in a window when no CI"
say "submission is pending."
say ""
say "THE CLIENT SECRET EXPIRES. Entra caps the lifetime at 24 months and"
say "defaults to less. When it lapses, msstore-publish fails on its first API"
say "call — write the expiry date into docs/dev/distribution.md next to the"
say "identity variables so the failure is recognisable rather than mysterious."
say ""
say "Nothing was written by this wizard. Until all five values are set the job"
say "no-ops loudly instead of failing, so a release cut before you finish this"
say "step still succeeds — it just does not reach the Store."
confirm "Credentials stored?" || say "Skipped — msstore-publish stays off until they are."

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
say "  9. MSSTORE_TENANT_ID / _SELLER_ID / _CLIENT_ID / _CLIENT_SECRET stored as"
say "     repository secrets and MSSTORE_PRODUCT_ID as a variable, so that no"
say "     later release needs step 8 at all."
say ""
say "Then: Submit for certification, and record what the first submission"
say "teaches. One claim in particular is UNVERIFIED and this is where it gets"
say "settled — whether the MSIX version's fourth part really must be 0. If the"
say "upload disagrees, fix scripts/msix-pack.sh and the spec's §E together."
say ""
say "Partner Center: $PARTNER_CENTER"
