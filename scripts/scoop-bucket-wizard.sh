#!/bin/sh
# One-time setup for the platypusgit Scoop bucket (#187, Windows half).
#
# Walks the four steps that live OUTSIDE this git repository and that therefore
# no code review can see: a second GitHub repo, its seed content, a GitHub App
# installation, and the first publish. Those are exactly the steps that get
# half-done and then debugged months later as a mystery release failure, so this
# script does what it can and verifies each step before moving on.
#
#   sh scripts/scoop-bucket-wizard.sh            # walk the steps
#   sh scripts/scoop-bucket-wizard.sh --dry-run  # print them, change nothing
#
# MUCH SHORTER THAN scripts/apt-repo-wizard.sh, and that asymmetry is the whole
# "cheapest remaining win" argument in #187: no DNS record, no GitHub Pages
# configuration, no signing key, and no new secret. One repository, and the App
# the Homebrew tap already uses.
#
# INTERACTIVE ON PURPOSE. Unlike scripts/install-platypusgit.sh this is never
# piped into a shell — it reads stdin, prompts, and waits. Run it from a
# terminal, and read the step before answering it.
#
# It is idempotent: every step detects work already done and skips it, so a run
# interrupted halfway can simply be re-run.
#
# Spec: docs/superpowers/specs/2026-08-27-scoop-bucket-spec.md  (§F)
set -eu

OWNER=jonassaa
REPO=scoop-platypusgit
APP_REPO=platypusgit
TAP_REPO=homebrew-platypusgit
MANIFEST=bucket/platypusgit.json

SEED_DIR="$(cd "$(dirname "$0")" && pwd)/scoop-bucket-seed"
DRY_RUN=no

usage() {
    cat <<'USAGE'
Usage: scoop-bucket-wizard.sh [--dry-run]

One-time setup for the platypusgit Scoop bucket. Interactive; run it from a
terminal.

  --dry-run       print what each step would do and change nothing
  -h, --help      this text
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn ""; warn "scoop-bucket-wizard: $*"; exit 1; }

step() {
    say ""
    say "──────────────────────────────────────────────────────────────"
    say " $*"
    say "──────────────────────────────────────────────────────────────"
}

# Waits for a plain Enter, or `s` to skip. Never proceeds on its own — the whole
# point of a wizard is that a human looked at the step. Under --dry-run it
# continues without asking, so the full walk can be reviewed without a terminal;
# nothing it would reach mutates anything anyway.
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

would() {
    if [ "$DRY_RUN" = yes ]; then
        say "  would run: $*"
        return 1
    fi
    return 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=yes; shift ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# ─── preflight ───────────────────────────────────────────────────────────────

command -v gh > /dev/null 2>&1 || die "gh is required (https://cli.github.com)"
command -v git > /dev/null 2>&1 || die "git is required"
[ -d "$SEED_DIR" ] || die "seed directory not found: $SEED_DIR"

gh auth status > /dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

say "platypusgit Scoop bucket — one-time setup"
say ""
say "  repository   $OWNER/$REPO (public)"
say "  manifest     $MANIFEST  (written by CI, never by hand)"
say "  seed         $SEED_DIR"
say "  secrets      none — reuses the App behind vars.TAP_APP_ID"
if [ "$DRY_RUN" = yes ]; then
    say ""
    say "  DRY RUN — nothing will be created or pushed."
fi

# ─── 1. the repository ───────────────────────────────────────────────────────

step "1/4  Create $OWNER/$REPO"

if gh repo view "$OWNER/$REPO" > /dev/null 2>&1; then
    say "Already exists — skipping."
else
    say "A Scoop bucket is just a git repository with manifests in bucket/."
    # Single-quoted: a backtick inside double quotes is command substitution in
    # sh, so "`scoop bucket add`" would try to RUN scoop.
    say 'Public, because "scoop bucket add" clones it anonymously.'
    if confirm "Create it?"; then
        if would "gh repo create $OWNER/$REPO --public"; then
            gh repo create "$OWNER/$REPO" --public \
                --description "Scoop bucket for platypusgit" \
                --homepage "https://www.platypusgit.com"
            say "Created."
        fi
    fi
fi

# ─── 2. the seed ─────────────────────────────────────────────────────────────

step "2/4  Push the seed (README + an empty bucket/)"

seeded=no
if gh api "repos/$OWNER/$REPO/contents/README.md" > /dev/null 2>&1; then
    say "README.md already present — skipping."
    seeded=yes
fi

if [ "$seeded" = no ]; then
    say "Pushes $SEED_DIR as the initial commit:"
    say ""
    (cd "$SEED_DIR" && find . -type f | sed 's|^\./|  |')
    say ""
    say "bucket/ ships EMPTY of manifests on purpose. The first bump-scoop run"
    say "writes $MANIFEST; a hand-made manifest here would carry a hash for an"
    say "asset that does not exist yet, and a bucket whose only manifest fails"
    say "to install is worse than a bucket with none."
    if confirm "Push it?"; then
        if would "git init + commit + push $SEED_DIR to $OWNER/$REPO"; then
            tmp="$(mktemp -d)"
            # A plain copy into a scratch clone, so this never touches the
            # working tree the wizard is being run from.
            cp -R "$SEED_DIR/." "$tmp/"
            (
                cd "$tmp"
                git init -q -b main
                git add -A
                git -c user.name="$(git config user.name || echo platypusgit)" \
                    -c user.email="$(git config user.email || echo noreply@platypusgit.com)" \
                    commit -q -m "chore: seed the bucket"
                git remote add origin "https://github.com/$OWNER/$REPO.git"
                git push -q -u origin main
            )
            rm -rf "$tmp"
            say "Pushed."
        fi
    fi
fi

# ─── 3. the GitHub App ───────────────────────────────────────────────────────

step "3/4  Install the existing GitHub App on $REPO"

say "release.yml's bump-scoop job pushes to $OWNER/$REPO with a token minted"
say "from the SAME App the Homebrew tap and the apt repo already use"
say "(vars.TAP_APP_ID / secrets.TAP_APP_PRIVATE_KEY). The App has to be"
say "installed on this repo too, or that step fails with a 404 that reads like"
say "a missing repository."
say ""
say "This is not scriptable — App installations are a UI action. Open:"
say ""
say "  https://github.com/settings/installations"
say ""
say "then: the App used for $TAP_REPO -> Configure -> Repository access ->"
say "add '$REPO'. It needs Contents: read and write."
say ""
confirm "Done?" || say "Skipped — remember that bump-scoop cannot push until this is done."

# ─── 4. the first publish ────────────────────────────────────────────────────

step "4/4  Verify the first publish"

if gh api "repos/$OWNER/$REPO/contents/$MANIFEST" > /dev/null 2>&1; then
    version="$(gh api "repos/$OWNER/$REPO/contents/$MANIFEST" \
        --jq '.content' 2> /dev/null | base64 -d 2> /dev/null \
        | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n1)"
    say "$MANIFEST is published${version:+ (version $version)}."
    say ""
    say "Nothing left to do. Confirm end to end from a Windows box:"
    say ""
    say "    scoop bucket add platypusgit https://github.com/$OWNER/$REPO"
    say "    scoop install platypusgit"
else
    say "$MANIFEST is not published yet — expected until the next release."
    say ""
    say "It appears when release.yml's bump-scoop job runs, which happens on the"
    say "next NON-PRERELEASE release. To publish an existing tag instead,"
    say "dispatch the workflow against it:"
    say ""
    say "    gh workflow run release.yml -f tag=vX.Y.Z --repo $OWNER/$APP_REPO"
    say ""
    say "...but only a tag built AFTER this change, since older builds attached"
    say "no PlatypusGit_x64_portable.zip and bump-scoop would have no hash."
    say ""
    say "The release run also gates itself: scoop-verify-live does a real"
    say '"scoop install" on a clean Windows runner and fails the run rather than'
    say "leaving a broken manifest published."
fi

say ""
say "──────────────────────────────────────────────────────────────"
say " Setup walked."
say "──────────────────────────────────────────────────────────────"
say ""
