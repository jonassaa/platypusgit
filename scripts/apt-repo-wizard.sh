#!/bin/sh
# One-time setup for the platypusgit APT repository (#187).
#
# Walks the eight steps that live OUTSIDE this git repository and that therefore
# no code review can see: a second GitHub repo, a DNS record, a Pages
# configuration, an offline GPG key, two repo secrets, and a GitHub App
# installation. Those are exactly the steps that get half-done and then debugged
# months later as a mystery release failure, so this script does what it can and
# verifies each step before moving on.
#
#   sh scripts/apt-repo-wizard.sh            # walk the steps
#   sh scripts/apt-repo-wizard.sh --dry-run  # print them, change nothing
#
# INTERACTIVE ON PURPOSE. Unlike scripts/install-platypusgit.sh this is never
# piped into a shell — it reads stdin, prompts, and waits. Run it from a
# terminal, and read the step before answering it.
#
# It is idempotent: every step detects work already done and skips it, so a run
# interrupted halfway can simply be re-run.
#
# Spec: docs/superpowers/specs/2026-08-26-apt-repository-spec.md  (§L)
set -eu

OWNER=jonassaa
REPO=apt-platypusgit
APP_REPO=platypusgit
DOMAIN=apt.platypusgit.com
PAGES_TARGET=jonassaa.github.io
KEY_UID_NAME="PlatypusGit APT repository"
KEY_UID_EMAIL="jonas.aasberg@clave.no"

SEED_DIR="$(cd "$(dirname "$0")" && pwd)/apt-repo-seed"
KEY_DIR="${APT_KEY_DIR:-$HOME/platypusgit-apt-key}"
DRY_RUN=no

usage() {
    cat <<'USAGE'
Usage: apt-repo-wizard.sh [--dry-run] [--key-dir DIR]

One-time setup for the platypusgit APT repository. Interactive; run it from a
terminal, not through a pipe.

Steps, in a fixed order (each one's prerequisite is the one before it):

  1. create the public repo jonassaa/apt-platypusgit
  2. generate the RSA-4096 signing key + a revocation certificate
  3. seed the repo with CNAME, .nojekyll and index.html
  4. add the DNS record  apt CNAME jonassaa.github.io
  5. enable GitHub Pages on that repo with the custom domain + HTTPS
  6. store APT_GPG_PRIVATE_KEY and APT_GPG_PASSPHRASE on jonassaa/platypusgit
  7. install the existing GitHub App on the new repo (manual)
  8. paste the key fingerprint into site/src/data/site.ts

Options:
  --key-dir DIR   where the private key + revocation cert are written
                  (default ~/platypusgit-apt-key, or $APT_KEY_DIR)
  --dry-run       print what each step would do and change nothing
  -h, --help      this text
USAGE
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn ""; warn "apt-repo-wizard: $*"; exit 1; }

step() {
    say ""
    say "──────────────────────────────────────────────────────────────"
    say " $*"
    say "──────────────────────────────────────────────────────────────"
}

# Waits for a plain Enter, or `s` to skip. Never proceeds on its own — the whole
# point of a wizard is that a human looked at the step. Under --dry-run it
# continues without asking, so the full walk can be reviewed (and tested)
# without a terminal; nothing it would reach mutates anything anyway.
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

ask() {
    if [ "$DRY_RUN" = yes ]; then
        printf '%s [dry-run]\n' "$1" >&2
        printf 'dry-run-value'
        return 0
    fi
    printf '%s ' "$1"
    read -r reply || reply=
    printf '%s' "$reply"
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
        --key-dir) [ $# -ge 2 ] || die "--key-dir needs a path"; KEY_DIR="$2"; shift 2 ;;
        --key-dir=*) KEY_DIR="${1#--key-dir=}"; shift ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option: $1 (try --help)" ;;
    esac
done

# ─── preflight ───────────────────────────────────────────────────────────────

command -v gh > /dev/null 2>&1 || die "gh is required (https://cli.github.com)"
command -v dig > /dev/null 2>&1 || die "dig is required"
command -v curl > /dev/null 2>&1 || die "curl is required"
[ -d "$SEED_DIR" ] || die "seed directory not found: $SEED_DIR"

gh auth status > /dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

# gpg on the host if it exists, otherwise a container. macOS ships no gpg, and
# asking someone to install one before they can create a signing key is a
# needless detour when the key generation is already fully scripted.
GPG_MODE=local
if ! command -v gpg > /dev/null 2>&1; then
    if command -v docker > /dev/null 2>&1; then
        GPG_MODE=docker
    else
        die "neither gpg nor docker found — one is needed to generate the signing key"
    fi
fi

say "platypusgit APT repository — one-time setup"
say ""
say "  repository   $OWNER/$REPO (public)"
say "  domain       $DOMAIN"
say "  key store    $KEY_DIR"
say "  gpg          $GPG_MODE"
if [ "$DRY_RUN" = yes ]; then
    say ""
    say "  DRY RUN — nothing will be created or changed."
fi

# ─── 1. the repository ───────────────────────────────────────────────────────

step "1/8  Create $OWNER/$REPO"

if gh repo view "$OWNER/$REPO" > /dev/null 2>&1; then
    say "Already exists — skipping."
else
    say "A public repo that holds ONLY the published index and .deb pool. No"
    say "workflows, no code: GitHub Pages serves it straight off the branch, so"
    say "there is nothing in it that can fail."
    if confirm "Create it?"; then
        if would "gh repo create $OWNER/$REPO --public"; then
            gh repo create "$OWNER/$REPO" --public \
                --description "Signed APT repository for platypusgit" \
                > /dev/null
            say "Created."
        fi
    fi
fi

# ─── 2. the signing key ──────────────────────────────────────────────────────

step "2/8  Generate the repository signing key"

PRIV="$KEY_DIR/apt-private.asc"
PUB_ASC="$KEY_DIR/apt-public.asc"
PUB_GPG="$KEY_DIR/apt-public.gpg"
REVOKE="$KEY_DIR/apt-revocation.asc"
FPR_FILE="$KEY_DIR/apt-fingerprint.txt"

if [ -f "$PRIV" ] && [ -f "$FPR_FILE" ]; then
    say "Already generated at $PRIV — skipping."
    FINGERPRINT="$(cat "$FPR_FILE")"
else
    say "RSA 4096, NO EXPIRY, plus a revocation certificate."
    say ""
    say "No expiry is deliberate. An expired repository signing key is a silent,"
    say "global 'apt update' failure for everyone who already installed the key,"
    say "and extending an expiry changes the key so every client needs the new"
    say "copy. Revocation is the right tool for a compromise; expiry is just a"
    say "scheduled outage. That is why the revocation certificate matters: keep"
    say "it, offline, or you have no way to retire this key."
    say ""
    if confirm "Generate it into $KEY_DIR?"; then
        passphrase="$(ask 'Passphrase for the new key (visible, and stored as a repo secret):')"
        [ -n "$passphrase" ] || die "a passphrase is required"

        if would "generate an RSA-4096 key in $KEY_DIR"; then
            mkdir -p "$KEY_DIR"
            chmod 0700 "$KEY_DIR"

            gen_home="$(mktemp -d)"
            chmod 0700 "$gen_home"
            cat > "$gen_home/params" <<PARAMS
%echo generating the platypusgit APT signing key
Key-Type: RSA
Key-Length: 4096
Name-Real: $KEY_UID_NAME
Name-Email: $KEY_UID_EMAIL
Expire-Date: 0
Passphrase: $passphrase
%commit
%echo done
PARAMS

            if [ "$GPG_MODE" = docker ]; then
                say "Running gpg in a container (no gpg on this machine)."
                docker run --rm \
                    -v "$gen_home:/work" \
                    -v "$KEY_DIR:/out" \
                    -e "PASSPHRASE=$passphrase" \
                    debian:bookworm sh -c '
                        set -eu
                        export DEBIAN_FRONTEND=noninteractive
                        apt-get update -qq
                        apt-get install -y -qq --no-install-recommends gnupg > /dev/null
                        export GNUPGHOME=/tmp/gnupg
                        mkdir -p "$GNUPGHOME" && chmod 0700 "$GNUPGHOME"
                        gpg --batch --quiet --gen-key /work/params
                        fpr="$(gpg --list-secret-keys --with-colons | awk -F: "/^fpr:/ { print \$10; exit }")"
                        printf "%s" "$PASSPHRASE" > /tmp/pass
                        gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file /tmp/pass \
                            --armor --export-secret-keys "$fpr" > /out/apt-private.asc
                        gpg --batch --yes --quiet --armor --export "$fpr" > /out/apt-public.asc
                        gpg --batch --yes --quiet --export "$fpr" > /out/apt-public.gpg
                        gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file /tmp/pass \
                            --output /out/apt-revocation.asc --gen-revoke "$fpr" <<REVOKE || true
y
0

y
REVOKE
                        printf "%s\n" "$fpr" > /out/apt-fingerprint.txt
                    '
            else
                GNUPGHOME="$gen_home" export GNUPGHOME
                gpg --batch --quiet --gen-key "$gen_home/params"
                fpr="$(gpg --list-secret-keys --with-colons \
                       | awk -F: '/^fpr:/ { print $10; exit }')"
                printf '%s' "$passphrase" > "$gen_home/pass"
                gpg --batch --yes --quiet --pinentry-mode loopback \
                    --passphrase-file "$gen_home/pass" \
                    --armor --export-secret-keys "$fpr" > "$PRIV"
                gpg --batch --yes --quiet --armor --export "$fpr" > "$PUB_ASC"
                gpg --batch --yes --quiet --export "$fpr" > "$PUB_GPG"
                printf 'y\n0\n\ny\n' | gpg --batch --yes --quiet --pinentry-mode loopback \
                    --passphrase-file "$gen_home/pass" --command-fd 0 \
                    --output "$REVOKE" --gen-revoke "$fpr" || true
                printf '%s\n' "$fpr" > "$FPR_FILE"
                unset GNUPGHOME
            fi

            rm -rf "$gen_home"
            chmod 0600 "$KEY_DIR"/* 2> /dev/null || true

            # The private key is the one thing that must exist; without it
            # nothing downstream works and a silent failure here would surface
            # much later as an unsigned publish.
            for required in "$PRIV" "$PUB_GPG" "$PUB_ASC" "$FPR_FILE"; do
                [ -s "$required" ] || die "key generation produced no $required"
            done

            FINGERPRINT="$(cat "$FPR_FILE")"
            say ""
            say "Key generated. Fingerprint:"
            say "  $FINGERPRINT"
            say ""

            # --gen-revoke is driven by a canned answer sequence, which is the
            # most brittle part of this script. It is allowed to fail rather than
            # abort a successful key generation — but NOT allowed to fail
            # quietly, because the certificate is the only way to retire a key
            # that has no expiry (§C). Say so, with the command to run by hand.
            if [ -s "$REVOKE" ]; then
                say "Revocation certificate: $REVOKE"
            else
                warn ""
                warn "!! NO REVOCATION CERTIFICATE WAS PRODUCED."
                warn "!! This key has no expiry, so revocation is the ONLY way to"
                warn "!! retire it. Generate one by hand before going further:"
                warn "!!"
                warn "!!   gpg --output apt-revocation.asc --gen-revoke $FINGERPRINT"
                warn "!!"
                warn "!! and keep it with the private key, offline."
            fi
            say ""
            warn "MOVE $KEY_DIR SOMEWHERE OFFLINE once step 6 has stored the secret."
        fi
    fi
fi
FINGERPRINT="${FINGERPRINT:-}"

# ─── 3. seed the repository ──────────────────────────────────────────────────

step "3/8  Seed $REPO with CNAME, .nojekyll and index.html"

if [ -z "$FINGERPRINT" ] && [ "$DRY_RUN" = no ]; then
    say "No fingerprint yet (step 2 skipped) — skipping, the landing page needs it."
elif confirm "Push the seed files?"; then
    if would "clone $OWNER/$REPO, copy $SEED_DIR, substitute the fingerprint, push"; then
        work="$(mktemp -d)"
        gh repo clone "$OWNER/$REPO" "$work/repo" -- --quiet
        cp "$SEED_DIR/CNAME" "$SEED_DIR/.nojekyll" "$work/repo/"
        sed "s|{{FINGERPRINT}}|$FINGERPRINT|g" "$SEED_DIR/index.html" \
            > "$work/repo/index.html"
        # A seed page that still says {{FINGERPRINT}} would publish a repository
        # whose key cannot be verified against anything.
        if grep -q '{{' "$work/repo/index.html"; then
            rm -rf "$work"
            die "index.html still has an unsubstituted placeholder"
        fi
        # The public key too, so the repo is verifiable from the moment it
        # exists rather than only after the first release. apt-repo-publish.sh
        # rewrites these on every publish; identical bytes, so no churn.
        if [ -f "$PUB_GPG" ]; then
            cp "$PUB_GPG" "$work/repo/key.gpg"
            cp "$PUB_ASC" "$work/repo/key.asc"
        fi
        (
            cd "$work/repo"
            git add -A
            if git diff --cached --quiet; then
                echo "Seed already up to date."
            else
                git commit -q -m "chore: seed the APT repository"
                git push -q
                echo "Pushed."
            fi
        )
        rm -rf "$work"
    fi
fi

# ─── 4. DNS ──────────────────────────────────────────────────────────────────

step "4/8  Add the DNS record"

resolved="$(dig +short "$DOMAIN" | head -n1)"
if [ -n "$resolved" ]; then
    say "$DOMAIN already resolves to $resolved — skipping."
else
    say "This one is not scriptable: DNS for platypusgit.com is at datacenter.no."
    say ""
    say "Add this record in their control panel:"
    say ""
    say "    type   CNAME"
    say "    name   apt"
    say "    value  $PAGES_TARGET"
    say ""
    say "It must resolve BEFORE step 5 — GitHub Pages rejects a custom domain"
    say "whose DNS does not point at it yet."
    say ""
    if confirm "Added it? I will wait for it to resolve."; then
        if would "poll dig $DOMAIN until it resolves"; then
            i=0
            until [ -n "$(dig +short "$DOMAIN" | head -n1)" ]; do
                i=$((i + 1))
                [ "$i" -lt 60 ] || die "$DOMAIN still does not resolve after 5 minutes"
                printf '  waiting for DNS (%ss)\r' "$((i * 5))"
                sleep 5
            done
            say ""
            say "Resolves to $(dig +short "$DOMAIN" | head -n1)."
        fi
    fi
fi

# ─── 5. Pages ────────────────────────────────────────────────────────────────

step "5/8  Enable GitHub Pages with the custom domain"

if gh api "repos/$OWNER/$REPO/pages" > /dev/null 2>&1; then
    current="$(gh api "repos/$OWNER/$REPO/pages" --jq '.cname // "none"' 2>/dev/null || echo unknown)"
    say "Pages is already enabled (custom domain: $current) — skipping."
elif confirm "Enable Pages from branch main, path /, domain $DOMAIN?"; then
    if would "gh api -X POST repos/$OWNER/$REPO/pages  (+ PUT for cname/https)"; then
        gh api -X POST "repos/$OWNER/$REPO/pages" \
            -f "source[branch]=main" -f "source[path]=/" > /dev/null
        say "Pages enabled."
        gh api -X PUT "repos/$OWNER/$REPO/pages" -f "cname=$DOMAIN" > /dev/null
        say "Custom domain set to $DOMAIN."
        # HTTPS can only be enforced once the certificate is issued, which takes
        # a few minutes. Failing here would be misleading, so it is a retry with
        # a plain instruction if it does not land.
        i=0
        until gh api -X PUT "repos/$OWNER/$REPO/pages" -F "https_enforced=true" > /dev/null 2>&1; do
            i=$((i + 1))
            if [ "$i" -ge 20 ]; then
                warn "Could not enforce HTTPS yet — the certificate is still being issued."
                warn "Turn on 'Enforce HTTPS' by hand at:"
                warn "  https://github.com/$OWNER/$REPO/settings/pages"
                break
            fi
            printf '  waiting for the TLS certificate (%ss)\r' "$((i * 15))"
            sleep 15
        done
        say ""
    fi
fi

# ─── 6. secrets ──────────────────────────────────────────────────────────────

step "6/8  Store the signing secrets on $OWNER/$APP_REPO"

if gh secret list --repo "$OWNER/$APP_REPO" 2>/dev/null | grep -q '^APT_GPG_PRIVATE_KEY'; then
    say "APT_GPG_PRIVATE_KEY is already set — skipping."
    say "(Re-run with the secret deleted if you rotated the key.)"
elif [ ! -f "$PRIV" ]; then
    say "No private key at $PRIV (step 2 skipped) — skipping."
elif confirm "Set APT_GPG_PRIVATE_KEY and APT_GPG_PASSPHRASE?"; then
    if would "gh secret set APT_GPG_PRIVATE_KEY / APT_GPG_PASSPHRASE --repo $OWNER/$APP_REPO"; then
        gh secret set APT_GPG_PRIVATE_KEY --repo "$OWNER/$APP_REPO" < "$PRIV"
        pass="$(ask 'Passphrase again (it goes straight into the secret):')"
        [ -n "$pass" ] || die "a passphrase is required"
        printf '%s' "$pass" | gh secret set APT_GPG_PASSPHRASE --repo "$OWNER/$APP_REPO"
        say "Both secrets stored."
        say ""
        say "release.yml derives the key id from the key itself, so there is no"
        say "third variable to keep in sync."
    fi
fi

# ─── 7. the GitHub App ───────────────────────────────────────────────────────

step "7/8  Install the existing GitHub App on $REPO"

say "release.yml's apt-publish job pushes to $OWNER/$REPO with a token minted"
say "from the SAME App the Homebrew tap already uses (vars.TAP_APP_ID /"
say "secrets.TAP_APP_PRIVATE_KEY). The App has to be installed on the new repo"
say "or that step fails with a 404 that reads like a missing repository."
say ""
say "This is not scriptable — App installations are a UI action. Open:"
say ""
say "  https://github.com/settings/installations"
say ""
say "then: the App used for homebrew-platypusgit -> Configure ->"
say "Repository access -> add '$REPO'. It needs Contents: read and write."
say ""
confirm "Done?" || say "Skipped — remember that apt-publish cannot push until this is done."

# ─── 8. the fingerprint on the site ──────────────────────────────────────────

step "8/8  Put the fingerprint on the download page"

if [ -n "$FINGERPRINT" ]; then
    say "Paste this into site/src/data/site.ts, as apt.keyFingerprint:"
    say ""
    say "    keyFingerprint: '$FINGERPRINT',"
    say ""
    say "The download page renders the fingerprint block only when that value is"
    say "non-empty, so until you do this it tells readers how to check the key"
    say "themselves instead of showing a placeholder that reads like a real"
    say "fingerprint."
else
    say "No fingerprint available (step 2 skipped)."
    say "It is in $FPR_FILE once the key exists."
fi

# ─── done ────────────────────────────────────────────────────────────────────

say ""
say "──────────────────────────────────────────────────────────────"
say " Setup walked."
say "──────────────────────────────────────────────────────────────"
say ""
say "Verify the host serves the key (Pages can take a minute after the push):"
say ""
say "    curl -fsSL https://$DOMAIN/key.gpg | wc -c"
say ""
say "The repository has no packages until the next non-prerelease release runs"
say "release.yml's apt-publish job. To publish an existing tag instead, dispatch"
say "the workflow against it — but only a tag built AFTER the Depends: git"
say "change, or the pre-push gate will correctly refuse it."
say ""
if [ -f "$PRIV" ]; then
    warn "Reminder: move $KEY_DIR offline. It holds the private key and the"
    warn "revocation certificate, and nothing here needs them again."
fi
