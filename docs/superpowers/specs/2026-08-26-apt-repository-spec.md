# One-line install and package-manager updates on Linux

**Issue:** [#187](https://github.com/jonassaa/platypusgit/issues/187)

## Problem

macOS has the smooth path: one line to install, one to update, both
copy-pasteable off the download page, and Homebrew owns updates so the app never
has to. Linux has neither half.

- **Install is a button.** `site/src/pages/download.astro` hands you a `.deb`
  download and `sudo apt install ./PlatypusGit_amd64.deb`. There is no one-liner.
- **There is nothing to upgrade from.** No apt repository exists, so `apt
  upgrade` never sees a new version. A `.deb` user's only route to 0.0.18 is to
  open a browser and repeat the download.
- **The app knows this and says the wrong thing.** `update::capability`
  (`src-tauri/src/update.rs:129`) returns `Notify` for a `.deb`, and
  `src/features/update/packageHint.ts` already exists to explain why — its Linux
  arm tells the user to "Download the .deb from the release page, then: `sudo apt
  install ./PlatypusGit_amd64.deb`", with a code comment reasoning "we only
  publish .deb + AppImage for Linux, so apt is the right advice". That advice is
  the best available today and becomes wrong the moment a repository exists.

Two facts from the shipped artifacts, both of which contradict the issue text and
change the design:

- **The Debian package is `platypus-git`, not `platypusgit`.** Read from the
  v0.0.17 `.deb`'s control file — Tauri kebab-cases `productName`, and
  `DebConfig` exposes no override. The issue's proposed `sudo apt install
  platypusgit` would fail as written.
- **`apt.platypusgit.com` does not exist.** DNS is at `datacenter.no`, `www`
  CNAMEs to `jonassaa.github.io`, and there is no wildcard record.

The rest of the v0.0.17 control file, for reference:

```
Package: platypus-git
Version: 0.0.17
Architecture: amd64
Installed-Size: 37378
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Priority: optional
```

No `Section:`, and **no `git`** — the backend shells out to real git wherever
libgit2 falls short, so a fresh-box install currently succeeds and then fails at
runtime in exactly the operations that matter most.

## Scope

In: the APT repository, the one-line installer, the download-page rewrite, the
`.deb` metadata fixes, and the in-app update notice. Out, as their own issues:
Scoop, winget (blocked on bundle code signing), `.rpm`, AUR, and an arm64 build.

## Design

### A. Where the repository lives

**A new public repo, `jonassaa/apt-platypusgit`, served by GitHub Pages from its
`main` branch at `apt.platypusgit.com`.**

The constraint that rules out the obvious option: **apt addresses `.deb` files by
a path relative to the repository root**, via the `Filename:` field in
`Packages`. The bytes must be served from the same host as the index — you cannot
point apt at `github.com/.../releases/download`. And the pool cannot live in the
marketing site, because `site.yml` uploads `site/dist` as the entire Pages
artifact, so every site deploy replaces the published tree and would wipe
anything a release job pushed in out of band.

The apt repo holds **no workflows and no reviewable code**. It is an artifact
store: Pages deploys from the branch, so there is nothing in it that can fail.
That is why it carries a committed `CNAME` (branch-served Pages persists the
custom domain through that file) and a `.nojekyll` (branch-served Pages runs
Jekyll by default, which would skip files it does not understand).

**Known ceilings, accepted deliberately.** GitHub's documented soft limits are a
1 GB published site size and 100 GB/month bandwidth. At 11.4 MB per `.deb` that
is ~87 releases before pruning becomes mandatory (§F caps it at 10 anyway) and
~8,700 installs/month. Both are soft limits GitHub emails about rather than
enforce, and the escape hatch is a URL-prefix swap, not a rebuild: put Cloudflare
in front, redirect `/pool/*` to the GitHub release assets, and the index stays on
Pages while Releases (no bandwidth limit) serves the payloads. apt follows HTTP
redirects. Do that only if bandwidth actually bites.

### B. Repository layout

Multi-arch from day one, amd64-only in practice (§J).

```
/
├── CNAME                    apt.platypusgit.com
├── .nojekyll
├── index.html               human landing page: what this host is, the
│                            commands, the key fingerprint
├── key.gpg                  public key, dearmored
├── key.asc                  public key, armored
├── dists/
│   └── stable/
│       ├── Release
│       ├── Release.gpg      detached, armored
│       ├── InRelease        clearsigned
│       └── main/
│           └── binary-amd64/
│               ├── Packages
│               └── Packages.gz
└── pool/
    └── main/
        └── p/
            └── platypus-git/
                └── platypus-git_0.0.17_amd64.deb
```

`pool/main/p/platypus-git/` is the Debian pool convention
(`pool/<component>/<first letter>/<source package>/`). The suite name lives in
the path, so adding a `beta` suite later is a new directory rather than a
migration — but §E ships **one suite**, gated exactly like `bump-cask`, so a
prerelease attaches its `.deb` to the GitHub release and stays invisible to apt.
That is correct behaviour and belongs in the release runbook so it is not
reported as a bug.

`index.html` is not decoration. Someone will paste `apt.platypusgit.com` into a
browser, and a 404 at the root of a signing-key host reads as abandoned or
compromised.

### C. Signing

A **dedicated GPG key: RSA 4096, no expiry**, with a revocation certificate
generated at the same time and stored offline, outside CI. The existing minisign
key is a different algorithm for a different job (Tauri updater artifacts) and
cannot sign a `Release` file.

RSA over ed25519 purely for compatibility: it is the choice every `gpgv` on every
LTS verifies without thought.

**No expiry is deliberate, and so is the absence of `Valid-Until`.** Both are the
same trap in different clothes: an expired signing key or an expired `Release`
file is a *silent global `apt update` failure* for every existing install, and
extending a key's expiry changes its self-signature, so every client that already
wrote the old key file needs the new one. Revocation is the correct tool for
compromise; expiry is a scheduled outage with no upgrade path. The cost, stated
plainly: omitting `Valid-Until` gives up apt's freeze/replay protection — an
attacker who can MITM the transport could serve a stale-but-validly-signed index
indefinitely. Over HTTPS, for a repository with one package, that is the cheaper
of the two risks.

The private key is armored and lives in `secrets.APT_GPG_PRIVATE_KEY` alongside
`TAURI_SIGNING_PRIVATE_KEY`; the passphrase in `secrets.APT_GPG_PASSPHRASE`; the
key id in `vars.APT_GPG_KEY_ID`. The passphrase reaches `gpg` on **stdin**, never
argv (`printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback
--passphrase-fd 0 …`), per the repo's secrets-travel-in-env rule.

Both `Release.gpg` (detached) and `InRelease` (clearsigned) are published. Modern
apt prefers `InRelease`; the detached form costs one command and keeps older
clients working.

Two publishable forms of the public key, because they answer different questions:
`key.asc` is readable and inspectable in a browser, `key.gpg` is pre-dearmored so
**the client needs no `gnupg` installed at all** — which is what makes the
one-liner work on a minimal container or cloud image. The one-liner uses
`key.gpg`. The fingerprint goes on the download page, so it is verifiable against
something other than the script that installed it.

### D. `.deb` metadata

Three additive keys in `tauri.conf.json` under `bundle.linux.deb`:

| Key | Value | Why |
| --- | --- | --- |
| `depends` | `["git"]` | A git GUI without git is not degraded, it is broken. `Depends` is what makes "one command and it works" survive a container or a minimal cloud image. |
| `provides` | `["platypusgit"]` | apt resolves a single-provider virtual package, so `apt install platypusgit` — the obvious guess — works. |
| `section` | `"vcs"` | Missing today; `apt-ftparchive` wants it, and generating the index with a hole in it is a needless first impression. |

`platypus-git` stays **canonical everywhere the page or the app names it**, so
`apt search`, `apt remove` and `dpkg -l` all agree with what the user was told.
`provides` exists to catch the wrong guess, not to replace the right name.
Renaming `productName` to close the gap is rejected: it would change the `.app`
bundle name, the binary, the desktop file, and the Homebrew cask for a cosmetic
win.

`depends` is *additive* — the bundler auto-generates `libwebkit2gtk-4.1-0,
libgtk-3-0` (proved by the shipped control file, which carries them while the
config says `"depends": []`). That the config entry appends rather than replaces
is **unverified locally** and is proved by the publish gate (§H), which reads
`dpkg -s platypus-git` in a container.

### E. The publish job

A new `apt-publish` job in `release.yml`, shaped exactly like `bump-cask`:

- `needs: [version, linux]`, so it has the built `.deb`.
- Gated `if: (release && prerelease == false) || workflow_dispatch` — the same
  gate as `bump-cask` and `updater-manifest`, so a prerelease never reaches the
  stable suite.
- Mints a token from the **existing** GitHub App (`vars.TAP_APP_ID` /
  `secrets.TAP_APP_PRIVATE_KEY`) with `repositories: apt-platypusgit`, checks the
  repo out, writes, commits, pushes. The `TAP_*` names now serve a non-tap repo;
  they keep their names with a comment saying so, because renaming a live secret
  is a manual settings step whose only failure mode is a broken release.

All release logic stays in `release.yml`, next to the prerelease gate it has to
share.

**Index generation is stateless.** `apt-ftparchive` (in `apt-utils`, preinstalled
on the runner) regenerates the whole index from whatever is in `pool/`:

```
apt-ftparchive --arch amd64 packages pool > dists/stable/main/binary-amd64/Packages
gzip -n -9 -c dists/stable/main/binary-amd64/Packages > .../Packages.gz
apt-ftparchive -o APT::FTPArchive::Release::Origin=platypusgit \
               -o APT::FTPArchive::Release::Suite=stable \
               -o APT::FTPArchive::Release::Codename=stable \
               -o APT::FTPArchive::Release::Components=main \
               -o APT::FTPArchive::Release::Architectures=amd64 \
               release dists/stable > dists/stable/Release
```

The pool directory *is* the state and git *is* the history. `aptly` keeps its
state in a database outside the published tree that a stateless CI run would have
to rebuild or commit; `reprepro` keeps a Berkeley DB inside the tree that you
would commit as a binary blob. Both are a second source of truth that can desync
from the pool.

**Three traps in that sequence, all load-bearing:**

1. **Delete `Release`, `Release.gpg` and `InRelease` before regenerating.**
   `apt-ftparchive release dists/stable` hashes every file under that directory —
   including a leftover `Release` from the previous run, which would then appear
   in its own checksum list.
2. **`gzip -n`.** Without it the gzip header carries a timestamp, so
   `Packages.gz` differs on every run even when the content is identical, and the
   no-op short-circuit below never fires.
3. **Idempotency is decided on `Packages`, not on the tree.**
   `apt-ftparchive release` stamps a `Date:` field, so `Release` changes on every
   run by construction. The job therefore compares the freshly generated
   `Packages` against the committed one and, if byte-identical, **exits without
   touching `Release`/`InRelease` at all** — "already up to date", the same path
   `bump-cask` takes. Re-running `workflow_dispatch` against an existing tag is
   then a genuine no-op rather than a re-sign commit. (Nothing needs periodic
   re-signing precisely because §C sets no `Valid-Until`.)

The `.deb` is copied into the pool under a **versioned** name
(`platypus-git_<version>_amd64.deb`); release assets stay stable-named
(`PlatypusGit_amd64.deb`) so the Homebrew cask and `latest.json` keep tracking
`releases/latest/download`. A copy, never a link.

### F. Retention

**Keep the last 10 releases.** Prune older pool files in the same job, before
index generation, and `log` what was dropped.

Every Pages deploy re-uploads the whole tree, so the pool's size is paid on every
publish, not once. Ten releases is ~114 MB — fast deploys, ~9× headroom under the
1 GB cap. Downgrading more than ten releases back on a pre-1.0 app is not a real
workflow, and GitHub Releases still holds every historical `.deb` for anyone who
needs one.

The log line is not optional: silent pruning reads as "we keep everything" right
up until someone discovers otherwise.

Ordering uses `sort -V` over the pool filenames. That is GNU version sort, not
`dpkg --compare-versions` ordering, and the two can disagree on exotic versions —
for plain `X.Y.Z` tags they are equivalent, and the release tag scheme is
enforced upstream by `release.yml`'s `v` prefix strip.

### G. The one-liner

`scripts/install-platypusgit.sh`, served off the marketing site at
`https://www.platypusgit.com/install-platypusgit.sh`.

**The name matters more than it looks.** `scripts/install-pgit.sh` already exists
and does a completely different job — it links the `pgit` CLI shim to an app you
already installed (#144). `install.sh` next to `install-pgit.sh` is one character
of difference for two unrelated operations. The app installer spells the app out;
the CLI installer keeps its name.

Served off the site rather than off `apt.platypusgit.com` because
`site/scripts/copy-installers.mjs` gives a real trust property: the served bytes
*are* the repo's bytes by construction, with no committed second copy to drift,
and it fails the build outright on a missing source rather than deploying a 404
at a URL the page tells people to pipe into a shell. The download page's "read it
before you run it" section then extends to the new script with one added link.
It also keeps the apt repo free of reviewable code. Costs two mechanical edits:
the name joins `INSTALLERS`, and `scripts/install-platypusgit.sh` joins
`site.yml`'s `paths:` filter — that filter exists precisely so editing an
installer cannot leave a stale copy served.

It inherits every `curl … | sh` rule the existing script established: POSIX `sh`,
`set -eu`, **never reads stdin** (stdin *is* the script), every choice a flag or
an environment variable, and a `--dry-run` that prints what would happen and
changes nothing.

**Behaviour:**

| Condition | Action |
| --- | --- |
| No `apt-get` on `PATH` | Print the AppImage instructions, exit non-zero. |
| `dpkg --print-architecture` is not `amd64` | Print "not built for this architecture yet" plus the AppImage route, exit non-zero. |
| Otherwise | Add the keyring, write the sources file, `apt update`, install `platypus-git`. |

Detect-then-refuse, never substitute. Piping a script that installs a *different
format than the one it advertises* is the kind of surprise that costs trust, and
`.rpm`/AUR are already filed as separate follow-ups. The architecture check is
what turns a future arm64 user's experience from a mysterious apt 404 into a
sentence.

`PLATYPUSGIT_APT_URL` overrides the repository base URL. That is a test seam, in
the same spirit as `PGIT_APP_SEARCH_ROOT` and `PGIT_POSTINST_PREFIX`: it is what
lets the publish gate (§H) drive the **real script** against a locally served
index instead of a hand-written approximation. Nothing in normal use sets it.

The expanded form, shown on the page underneath the one-liner:

```
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://apt.platypusgit.com/key.gpg \
  | sudo tee /etc/apt/keyrings/platypusgit.gpg > /dev/null
sudo chmod 0644 /etc/apt/keyrings/platypusgit.gpg
sudo tee /etc/apt/sources.list.d/platypusgit.sources > /dev/null <<'EOF'
Types: deb
URIs: https://apt.platypusgit.com
Suites: stable
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/platypusgit.gpg
EOF
sudo apt update && sudo apt install platypus-git
```

**deb822 `.sources`, not a one-line `.list`.** deb822 has been supported since
apt 1.1 (Debian 9, Ubuntu 16.04) — "everywhere" in practice — and it is readable
by whoever inherits the machine. `Architectures:` is written explicitly from
`dpkg --print-architecture`, which is what keeps the multi-arch story quiet: an
architecture apt has no `Packages` file for is skipped silently instead of
warning on every `apt update`. The keyring goes in `/etc/apt/keyrings/` via
`Signed-By:`; `apt-key` is deprecated and gone on current Debian/Ubuntu and is
never used. `install -d` rather than `mkdir -p` because that directory does not
pre-exist on older releases and wants an explicit mode.

**`/etc/apt/sources.list.d/platypusgit.sources` is a contract between the shell
script and the Rust in §I.** Two files in two languages that must agree on one
string. Both carry a comment naming the other, and a test pins the Rust
constant.

### H. Verification before publication

The publish job is **hard-gated on a real install**, before the push:

1. Generate and sign the index in the job.
2. Serve the checkout with `python3 -m http.server`.
3. `docker run --network host debian:bookworm` and run the **real**
   `install-platypusgit.sh` with `PLATYPUSGIT_APT_URL=http://127.0.0.1:8000`.
4. Assert `dpkg -s platypus-git` (which proves §D's `Depends: git` resolved,
   `Provides:` and `Section:` landed) and `pgit --help`.
5. Only then push.

A GUI launch is not asserted — there is no display, and that is not what this
gate is for.

A second, lighter smoke job runs **after** the push against the live
`https://apt.platypusgit.com`, with a retry loop, because Pages publishes
asynchronously after a push. It catches what step 3 structurally cannot see: DNS,
the Pages deploy, HTTPS, and propagation.

The issue's own argument is that this install path is the first impression for the
audience most likely to adopt the app. An untested publish path is the wrong place
to save an hour.

### I. In-app: a third capability

`update::capability` currently takes `(os, is_appimage)` and returns
`SelfUpdate | Notify`. After this work there are **two kinds of `.deb` install**
and they need different advice: `apt upgrade` on a sideloaded `.deb` reports
"already the newest version" while the panel simultaneously says a new version
exists — which is precisely the silent dead end `packageHint`'s doc comment says
the function exists to eliminate.

```rust
pub fn capability(os: &str, is_appimage: bool, apt_managed: bool) -> UpdateCapability {
    match os {
        "windows" => UpdateCapability::SelfUpdate,
        "linux" if is_appimage => UpdateCapability::SelfUpdate,
        "linux" if apt_managed => UpdateCapability::NotifyApt,
        _ => UpdateCapability::Notify,
    }
}
```

`apt_managed` is `Path::new("/etc/apt/sources.list.d/platypusgit.sources")
.exists()`, computed in `commands/update.rs` only on Linux. **One `Path::exists`
— no process spawn**, so there is nothing to route through `proc.rs` and nothing
to mock. It reuses the seam that already exists rather than bolting a second one
beside it, and it costs one enum variant instead of a new IPC command with its
five registration steps and a second round-trip for one boolean.

`UpdateCapability` in `src/lib/types.ts` widens to
`"self-update" | "notify" | "notify-apt"`, in the same commit, per the 1:1 rule.

The audit surface is small and worth naming precisely: `UpdatePanel.tsx` branches
only on `capability === "self-update"`, so it needs no change; `packageHint`'s
early return widens from `capability !== "notify"` to also admit `"notify-apt"`.
That guard is the one place a missed branch would silently render nothing.

| Capability | Platform | Note | Command |
| --- | --- | --- | --- |
| `notify-apt` | linux | Updates come from apt on this install. | `sudo apt update && sudo apt upgrade platypus-git` |
| `notify` | linux | This `.deb` was not installed from the platypusgit apt repository. Switch to apt and updates come from your package manager: | `curl -fsSL https://www.platypusgit.com/install-platypusgit.sh \| sh` |
| `notify` | macos | unchanged | `brew upgrade platypusgit` |

The sideloaded arm points at the one-liner rather than at another manual download
because it is the single actionable line that both upgrades *and* fixes the
situation permanently. The panel already carries a "View release" button for
anyone who would rather read the notes first.

The `notify-apt` command is **character-for-character the same** as the one on
the download page. Two places telling a user two different upgrade commands for
one install is worse than either command alone.

### J. Architecture

Layout for multi-arch now (§B), build **amd64 only**. `ubuntu-24.04-arm` runners
are free for public repos, so an arm64 `.deb` is a matrix entry rather than a
cross-compile ordeal — but it is a second full Tauri build per release, a second
stable-named asset, new `latest.json` keys, and its own untested-on-this-hardware
failure surface. Filed separately.

The installer's architecture check (§G) is what makes the gap honest in the
meantime.

### K. The download page

Mirror the macOS structure exactly, because it is the proven shape and the ask is
literally "give Linux what macOS has":

1. `method-primary` **One-line install**, with the **Recommended** badge —
   `curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh`
2. `method-primary` **Updating with apt** — `sudo apt update && sudo apt upgrade
   platypus-git`, the macOS section's "Homebrew owns updates" paragraph in apt
   form.
3. `method` **The three commands** — the expanded form from §G, for people who
   will not pipe a URL into a shell, plus the key fingerprint.
4. `method` **Debian package (.deb)**, demoted — the direct download, for
   air-gapped or one-off installs, noting that updates are then manual.
5. `method` **AppImage**, reframed.

**The AppImage gets a real reframing, not a demotion.** Two things are true and
neither is currently on the page: it is the only route for non-Debian distros
until `.rpm`/AUR land, and it is the **only Linux install that updates itself
in-app** (`capability` returns `SelfUpdate` when `APPIMAGE` is set; the `.deb`
never will). So it becomes "Fedora, Arch, and anything not Debian-based", and it
says it self-updates. That second fact is a genuine advantage the page hides
today, and it is the honest answer to a Fedora user who reads the apt one-liner
and wonders what they get instead. It also sets the `.rpm`/AUR follow-ups up as
additions rather than corrections.

The `.deb` download button stays. `platypus-git` is named as canonical
throughout.

### L. State that lives outside the repository

Half of this work lands where no code review can see it. This table is the
handover, and the plan drives it as a wizard because these are exactly the steps
that get half-done and then debugged as a mystery.

| # | Step | Where | Detail |
| --- | --- | --- | --- |
| 1 | Create repo | GitHub | `jonassaa/apt-platypusgit`, public |
| 2 | Seed it | that repo | `CNAME`, `.nojekyll`, `index.html`, `key.gpg`, `key.asc` on `main` |
| 3 | DNS record | datacenter.no | `CNAME apt → jonassaa.github.io` |
| 4 | Enable Pages | that repo's settings | deploy from branch `main` / root; custom domain `apt.platypusgit.com`; Enforce HTTPS |
| 5 | Generate key | offline | RSA 4096, no expiry, uid `PlatypusGit APT repository <jonas.aasberg@clave.no>` |
| 6 | Revocation cert | offline | generated with the key, stored outside CI |
| 7 | Secrets | `jonassaa/platypusgit` | `APT_GPG_PRIVATE_KEY`, `APT_GPG_PASSPHRASE`, `vars.APT_GPG_KEY_ID` |
| 8 | App install | GitHub App settings | add `apt-platypusgit` to the existing App's repositories, `contents: write` |

Step 4 cannot precede step 3 (Pages rejects a custom domain whose DNS does not
resolve to it), and step 8 cannot precede step 1.

## Rejected alternatives

- **Pool in the marketing site.** `site.yml` uploads `site/dist` as the whole
  Pages artifact; every site deploy would wipe it.
- **`Filename:` pointing at GitHub release assets.** apt resolves it relative to
  the repository root. Not possible.
- **Cloudflare R2.** No size or bandwidth cliff and free egress, but it costs a
  new account, moving or delegating DNS, and an S3 credential in CI instead of a
  git push that mirrors `bump-cask`. Revisit only if §A's ceilings bite.
- **A managed OSS repo host** (Cloudsmith, packagecloud). Would delete §C, §E and
  §F outright, at the price of a third-party dependency in the install path and a
  free tier that can change under us.
- **`aptly` / `reprepro`.** §E — a second source of truth that can desync from
  the pool.
- **Key expiry, and `Valid-Until`.** §C — both are scheduled global `apt update`
  outages with no upgrade path.
- **Renaming `productName` to `platypusgit`.** §D — changes the `.app` bundle
  name, the binary, the desktop file and the Homebrew cask, for cosmetics.
- **A one-line `.list` sources file, or `apt-key`.** §G — deb822 is universally
  supported and readable; `apt-key` is deprecated and removed.
- **A new `is_apt_managed` IPC command.** §I — same information, five
  registration steps, and a second round-trip for one boolean.
- **Showing both upgrade commands in the panel with no detection.** §I — honest,
  but a two-command hint in a small panel is exactly the wall of text the panel
  exists to avoid.
- **Flatpak / Flathub.** Per the issue: a git GUI needs the host's `git`, ssh
  keys, credential helpers, `$EDITOR` and arbitrary filesystem paths, so it would
  need `--filesystem=host` plus host-spawn and would still fight the sandbox.
- **Bundling Scoop and winget into this work.** Zero shared code with any of the
  above, and winget is blocked on the bundle code-signing decision, which is a
  different conversation.

## Verification reality

This is macOS, and the publish path runs on a runner against a repository that
does not exist yet. The honest split:

| Piece | Verifiable on this machine | Only verifiable at release time |
| --- | --- | --- |
| `install-platypusgit.sh` | `dash -n` + `bash -n`; real runs against a locally served fixture index via `PLATYPUSGIT_APT_URL`; the no-`apt-get` and wrong-arch refusals; `--dry-run`; `--help` | nothing — this one is fully exercisable |
| Index generation + signing | the whole script, against a fixture pool, with a throwaway key: `apt-ftparchive`, `gpg --clearsign`, and a real `apt-get install` in a `debian:bookworm` container | the production key |
| `.deb` control fields (`Depends: git`, `Provides:`, `Section:`) | that the config parses and `DebConfig` accepts the keys | that the bundler *appends* rather than replaces the auto-detected deps — proved by §H's `dpkg -s` in the container |
| `capability` / `packageHint` / `UpdatePanel` | end to end — `cargo test`, `pnpm test`, component tests for both notify arms | — |
| Download page | `pnpm build` in `site/`, and the copied installer served locally | — |
| `apt-publish` job | shell steps run locally against a fixture checkout | the App token mint, the cross-repo push, Pages deploy, DNS, HTTPS |
| Pages ceilings | the arithmetic | whether GitHub ever complains |

Anything in the right column is reported as unproven, never as working.

Note that `apt-ftparchive`, `dpkg`, `gpg` and `debian:bookworm` are all
reachable on macOS through Docker, so the middle rows are genuinely testable
here — unlike #144, where three of five channels were unreachable. The one thing
this machine cannot do is build a Linux `.deb`: `Dockerfile.e2e` builds with
`--no-bundle`, so the e2e image produces a binary and no package. Proving the
control fields therefore needs either a one-off `tauri build --bundles deb` in
that image or the §H gate at release time.

## Follow-ups

Separate issues, all unblocked by this work rather than blocked on it:

- Scoop bucket (the cheapest remaining win; same shape as the Homebrew tap).
- winget — gated on the bundle code-signing decision.
- `.rpm` + a dnf repo on the same host (the same static-index exercise).
- AUR `platypusgit-bin`.
- arm64 Linux builds (§J).
- A `beta` suite, if a Linux prerelease channel is ever wanted (§B leaves room).
