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

- **The Debian package was `platypus-git`, not `platypusgit`.** Read from the
  v0.0.17 `.deb`'s control file — Tauri kebab-cases `productName`, and
  `DebConfig` exposes no override, so the issue's proposed `sudo apt install
  platypusgit` would have failed as written. **Resolved during implementation by
  renaming `productName` to `platypusgit`** (see §D), which was the right call
  and had to happen *before* the first apt publish — afterwards every apt user
  would have needed a `Replaces`/`Conflicts` migration.
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
            └── platypusgit/
                └── platypusgit_0.0.18_amd64.deb
```

`pool/main/p/platypusgit/` is the Debian pool convention
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
`TAURI_SIGNING_PRIVATE_KEY`; the passphrase in `secrets.APT_GPG_PASSPHRASE`. The
passphrase reaches `gpg` on **stdin**, never argv (`printf '%s' "$PASS" | gpg
--batch --pinentry-mode loopback --passphrase-fd 0 …`), per the repo's
secrets-travel-in-env rule.

**No third variable for the key id.** It is derived from the imported key
(`gpg --list-secret-keys --with-colons`), because a key id configured separately
from the key it names is a pair that can drift, and the drift shows up as an
unsigned publish rather than as a missing variable. `APT_GPG_KEY_ID` remains an
optional override. The publish script also **imports the key itself** into a
throwaway `GNUPGHOME` for the run, so CI (secret → env) and a developer (fixture
key → env) take one code path and neither leaves a keyring behind.

`apt-repo-publish.sh` **exports `key.gpg` and `key.asc` on every run**. Output is
byte-stable for an unchanged key, so this is idempotent — and it means the
published repository always carries the public half of whatever actually signed
it, rather than a seeded file that could silently go stale and break every
client's `apt update`.

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

**`productName` becomes `platypusgit`**, and that is what makes the package name
`platypusgit`. Tauri derives the Debian `Package:` field from it and nothing else
(`debian.rs`: `heck::AsKebabCase(settings.product_name())`); `DebConfig` has no
name override. `"PlatypusGit"` kebab-cased to `platypus-git` because the internal
capital is a word boundary.

This spec originally **rejected** the rename as cosmetic. That was wrong on two
counts: lowercase is already how the project brands itself
(`site/src/data/site.ts`, `name: 'platypusgit'`), so `productName` was the
outlier; and the rename is only cheap *before the first apt publish* — afterwards
every apt-managed install needs a migration. `docs/dev/distribution.md` carries
the table of what else the rename drags along (the Homebrew cask above all) and
who has to follow.

Keys in `tauri.conf.json` under `bundle.linux.deb`:

| Key | Value | Why |
| --- | --- | --- |
| `depends` | `["git"]` | A git GUI without git is not degraded, it is broken. `Depends` is what makes "one command and it works" survive a container or a minimal cloud image. |
| `section` | `"vcs"` | Missing today; `apt-ftparchive` wants it, and generating the index with a hole in it is a needless first impression. |
| `provides` | `["platypus-git"]` | An older `apt install platypus-git` keeps resolving. |
| `replaces` + `conflicts` | `["platypus-git"]` | Both packages own `/usr/bin/platypusgit`, so without these a sideloaded older `.deb` upgrades into a hard dpkg file conflict. |

`platypusgit` is **canonical everywhere the page or the app names it**, because a
virtual name installs without reporting — `apt policy platypus-git` shows no
candidate. Verified: `apt-get install` by the virtual name succeeds and installs
the real package.

**`depends` is additive — and this was checked, because getting it wrong ships an
uninstallable package.** `tauri-bundler`'s `debian.rs` writes `Depends:` from
`settings.deb().depends` alone, which reads as though a configured list
*replaces* the auto-detected libs. It does not. The merge happens one layer up,
in `tauri-cli` at the version this repo pins (2.10.1),
`crates/tauri-cli/src/interface/rust.rs:1368`:

```rust
let mut depends_deb = config.linux.deb.depends.unwrap_or_default();
...
depends_deb.push("libwebkit2gtk-4.1-0".to_string());
depends_deb.push("libgtk-3-0".to_string());
```

The config list is the **seed**; the detected libs are appended. So `["git"]`
yields `Depends: git, libwebkit2gtk-4.1-0, libgtk-3-0` — consistent with the
shipped v0.0.17 control file, which carries both libs while its config said
`[]`. That the fields reach the *built* control file is additionally asserted by
the publish gate (§H) via `dpkg -s platypusgit`, on a runner that can actually
produce a `.deb`.

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

1. **Generate `Release` to a temp file OUTSIDE the tree, and delete the previous
   `Release`/`Release.gpg`/`InRelease` first.** `apt-ftparchive release
   dists/stable` hashes every file under that directory, so a leftover
   `InRelease` or `Release.gpg` would be listed inside the checksum section of
   the `Release` they sign — which the delete handles.

   Deleting is **not sufficient for `Release` itself**, which is the part this
   spec originally got wrong. `> "$DIST_DIR/Release"` recreates the file inside
   the directory before `apt-ftparchive` walks it, and `apt-ftparchive` streams
   its output, so it hashes the header it has already flushed and `Release` lands
   in its own checksum list. Measured, not theorised — the first run of the
   implementation produced exactly that (`186 Release`). The script now writes to
   `mktemp`, moves the file in, and **refuses to publish a `Release` that lists
   itself**.
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
(`platypusgit_<version>_amd64.deb`); release assets stay stable-named
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
| Otherwise | Add the keyring, write the sources file, `apt update`, install `platypusgit`. |

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
sudo apt update && sudo apt install platypusgit
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
2. Serve the checkout from a **container** (`python:3-slim`) on a user-defined
   Docker network. Not a host process: only on a user-defined network does
   Docker's embedded DNS resolve the server by container name, which is what
   makes this identical on Docker Desktop (where a container cannot reach the
   host at `127.0.0.1`) and on a Linux runner. One code path, no host `python3`.
3. `docker run --platform linux/amd64 debian:bookworm` — **the platform pin is
   load-bearing.** The repository ships amd64 only, so an arm64 client (the
   default on an Apple Silicon dev machine) fetches the index, verifies the
   signature, and then reports "Unable to locate package", which reads as a
   broken repository rather than a wrong architecture. Inside it, run the **real**
   `install-platypusgit.sh` with `PLATYPUSGIT_APT_URL` pointed at the server.
4. Assert: the client image has no `gnupg` before *or after* (proving the
   dearmored-key claim); `/etc/apt/sources.list.d/platypusgit.sources` exists
   (the §I contract); a scoped `apt-get update` against only our sources file
   accepts the signature; `dpkg -s platypusgit` reports the expected version,
   with `Depends: git` resolved and `Provides:`/`Section:` present; and
   **`pgit --help` exits 0 and prints usage.**
5. Only then push.

Running the binary is the assertion `test -x` cannot make: it proves the ELF
loads and every shared library the `.deb` declared resolved. It is `--help` and
not `--version` because `--version` only exists since #218 — an older `.deb` in
the pool does not recognise it, falls through to a launch, and panics in GTK init
with no display, failing the gate for a reason unrelated to the repository.
(Measured on the v0.0.17 fixture.) A GUI launch is not asserted at all; there is
no display, and that is not what this gate is for.

A second job runs **after** the push against the live
`https://apt.platypusgit.com`, catching what step 3 structurally cannot see: DNS,
the Pages deploy, HTTPS, propagation. It is the **same script and the same
assertions** — `apt-repo-smoke.sh` takes `--url` to install from an
already-published repository instead of serving a directory, and `--wait` turns
its readiness loop into the retry Pages' asynchronous publish needs. One script,
so "it installs from a directory" and "it installs from the live host" cannot
drift apart.

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
| `notify-apt` | linux | Updates come from apt on this install. | `sudo apt update && sudo apt upgrade platypusgit` |
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
literally "give Linux what macOS has".

**Note the page was rebuilt by #261 while this spec was being written**, so the
mechanics are cards rather than the `method` / `method-primary` blocks this
section originally named. The macOS Homebrew card is still the shape to copy; it
is now `card card-wide card-primary` + a `Recommended` pill + `card-lead` +
`CodeBlock` + `card-note`, with secondary material folded into `<details>`
disclosures. The Linux panel becomes:

1. **One-line install** — primary card, `Recommended` pill, the `curl … | sh`.
   Its `<details>`: *Updating and removing* (`sudo apt update && sudo apt upgrade
   platypusgit`, the macOS card's "Homebrew owns updates" paragraph in apt
   form), *The same thing, spelled out* (the expanded commands from §G plus the
   key fingerprint), and *Read the installer first, or dry-run it* — retitled so
   it does not collide with the identically-named disclosure the CLI section
   already has further down the page.
2. **AppImage** — reframed (below).
3. **Debian package, by hand** — demoted, the direct download, honest that
   updates are then manual.

The `platforms` blurb and specs, and the `pgitMatrix` table, gain the apt route
so the panel's summary agrees with its cards.

**The AppImage gets a real reframing, not a demotion.** Two things are true and
neither is currently on the page: it is the only route for non-Debian distros
until `.rpm`/AUR land, and it is the **only Linux install that updates itself
in-app** (`capability` returns `SelfUpdate` when `APPIMAGE` is set; the `.deb`
never will). So it becomes "Fedora, Arch, and anything not Debian-based", and it
says it self-updates. That second fact is a genuine advantage the page hides
today, and it is the honest answer to a Fedora user who reads the apt one-liner
and wonders what they get instead. It also sets the `.rpm`/AUR follow-ups up as
additions rather than corrections.

The `.deb` download button stays. `platypusgit` is named as canonical
throughout.

### L. State that lives outside the repository

Half of this work lands where no code review can see it. This table is the
handover, and the plan drives it as a wizard because these are exactly the steps
that get half-done and then debugged as a mystery.

`scripts/apt-repo-wizard.sh` walks these in this order, does what is scriptable,
and verifies each before advancing. `--dry-run` prints the whole walk without
touching anything.

| # | Step | Where | Detail |
| --- | --- | --- | --- |
| 1 | Create repo | GitHub | `jonassaa/apt-platypusgit`, public — `gh repo create` |
| 2 | Generate key + revocation cert | offline | RSA 4096, no expiry, uid `PlatypusGit APT repository <jonas.aasberg@clave.no>`. Via Docker when the host has no `gpg`, which macOS does not |
| 3 | Seed the repo | that repo | `CNAME`, `.nojekyll`, `index.html` (fingerprint substituted), plus `key.gpg`/`key.asc` so it is verifiable from the moment it exists |
| 4 | DNS record | datacenter.no | `CNAME apt → jonassaa.github.io`. Not scriptable; the wizard polls `dig` until it resolves |
| 5 | Enable Pages | that repo | branch `main` / root, custom domain, Enforce HTTPS — `gh api`, retrying HTTPS while the certificate is issued |
| 6 | Secrets | `jonassaa/platypusgit` | `APT_GPG_PRIVATE_KEY`, `APT_GPG_PASSPHRASE` — `gh secret set`. No key-id variable: it is derived from the key (§C) |
| 7 | App install | GitHub App settings | add `apt-platypusgit` to the existing App's repositories, Contents: read and write. Not scriptable — a UI action |
| 8 | Fingerprint on the site | `site/src/data/site.ts` | paste into `apt.keyFingerprint`; the page renders that block only when it is non-empty |

Order is load-bearing in two places: step 5 cannot precede step 4 (Pages rejects
a custom domain whose DNS does not resolve to it), and step 7 cannot precede
step 1. Step 3 needs step 2's fingerprint, and the seed step **refuses to push**
an `index.html` with an unsubstituted placeholder.

Afterwards the private key and revocation certificate should be moved offline;
nothing in CI needs them again.

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
- ~~**Renaming `productName` to `platypusgit`.**~~ **Reversed — this was done.**
  It was rejected here as cosmetic, on the grounds that it changes the `.app`
  bundle name, the desktop file and the Homebrew cask. Those consequences are
  real (and the cask now has a release-time guard because of them), but the
  reasoning was wrong twice over: lowercase is already the project's brand
  everywhere else, so `productName` was the outlier rather than the fix; and the
  cost only stays low *before the first apt publish*. It also does not change the
  binary — that comes from the Cargo package name. See §D.
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

This table is written **after** implementation, so the left column is what was
actually run, not what was hoped.

| Piece | Proven on this machine | Only verifiable at release time |
| --- | --- | --- |
| `install-platypusgit.sh` | `dash -n`, `bash -n`, `shellcheck`; a real install in a clean amd64 `debian:bookworm` against a served fixture index; both refusals (no `apt-get`, wrong arch) via the seams; `--dry-run` (verified to mutate nothing); `--help` | — fully exercisable |
| Index generation + signing | the whole script against a fixture pool built from the real published v0.0.17 `.deb`, with a throwaway RSA-4096 key: `apt-ftparchive`, clearsign + detached sign, a real `apt-get install`, and a **tampered `InRelease` that fails with `BADSIG` and exit 100** — so a pass means something | the production key |
| Idempotency | a second run of the same version leaves all 8 files **byte-identical** (`shasum` diff) and prints "already up to date" | — |
| `.deb` control fields | `cargo check` (i.e. `tauri-build` accepts the keys); that `depends` *appends* rather than replaces, read from `tauri-cli` at the pinned 2.10.1 and cross-checked against the shipped v0.0.17 control file | that the fields reach the built control file — asserted by §H's `dpkg -s` on a runner that can produce a `.deb` |
| `capability` / `packageHint` / `UpdatePanel` | `cargo test` (15 update tests incl. the contract-path pin), `pnpm tsc --noEmit`, `pnpm test` (1929 passing), component tests for both notify arms | — |
| Download page | `pnpm build` in `site/`; the served installer is byte-identical to `scripts/`; the rendered `apt upgrade` string matches the panel's | — |
| `apt-publish` / `apt-verify-live` | `actionlint` clean; the gate expression **byte-identical to `bump-cask`'s** (`diff`); `--url` mode fails cleanly against the not-yet-live host | the App token mint, the cross-repo push, Pages deploy, DNS, HTTPS |
| `apt-repo-wizard.sh` | `dash -n`, `bash -n`, `shellcheck`; a full `--dry-run` walk of all eight steps, exit 0, creating nothing | every step's real effect — it creates a repo, edits DNS, installs an App |
| Pages ceilings | the arithmetic | whether GitHub ever complains |

Anything in the right column is reported as unproven, never as working.

`apt-ftparchive`, `dpkg`, `gpg` and `debian:bookworm` are all reachable on macOS
through Docker, so far more is testable here than in #144, where three of five
channels were unreachable. Two things this machine genuinely cannot do:

- **Build a Linux `.deb`.** `Dockerfile.e2e` builds with `--no-bundle`, so the
  e2e image produces a binary and no package. Hence the source-level proof for
  §D plus the §H gate.
- **Run any of it on the production key or the real host**, neither of which
  exists until §L is walked.

## Follow-ups

Separate issues, all unblocked by this work rather than blocked on it:

- Scoop bucket (the cheapest remaining win; same shape as the Homebrew tap).
- winget — gated on the bundle code-signing decision.
- `.rpm` + a dnf repo on the same host (the same static-index exercise).
- AUR `platypusgit-bin`.
- arm64 Linux builds (§J).
- A `beta` suite, if a Linux prerelease channel is ever wanted (§B leaves room).
