# Releasing and versioning

How a version number is chosen, what it promises, and the runbook for cutting a
release. The mechanics of each distribution channel — what a cask is, how apt is
signed, why MSIX needs a fourth version part — live in `docs/dev/distribution.md`;
this file is about the *number* and the *order of operations*.

## The tag is the version

`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` all read
`0.0.0` in the tree and **that is correct — do not "fix" it**. `release.yml`
injects the tag-derived version into all three at build time (`v0.4.0` → `0.4.0`),
in every one of the build jobs. The tag is the single source of truth.

This is the one part of the versioning story that has never gone wrong, and it is
worth naming why: there are no bump commits, no release-prep PR, and no way for
three manifests to disagree about what version this is. The cost is that any
locally built binary reports `0.0.0` — `pgit --version`, the Settings diagnostics
panel, and the log header all read `CARGO_PKG_VERSION` (`update.rs::DEV_VERSION`
names the same constant). A binary reporting `0.0.0` is never a real install, and
`update.rs` says so in a comment. Accept it; the alternative is drift.

## What the number means

We are pre-1.0, so **the minor is the major**. The rule:

| Bump | When |
|---|---|
| **minor** (`0.N.0`) | Any new user-visible capability. Any new distribution channel. Any change to a persisted format, settings shape, or on-disk state. |
| **patch** (`0.N.M`) | Fixes, performance, docs, and packaging repairs to a channel that already shipped. **No new capability.** |

The operational test, phrased against something we already write: **if the
changelog entry's `status` field says "feature", it is a minor.** That field is
in `site/src/data/features.ts`, it is rendered to users on the changelog page, and
it is written by hand as part of cutting the release — so it is the honest place
for the rule to bind.

**Every release published before this file landed is grandfathered** — v0.3.1 and
everything below it. The published record is deliberately not rewritten; it says
what it said. The rule binds on **the next release cut after this file**, whatever
number that turns out to be. (Phrased this way on purpose: an earlier draft said
"grandfathered up to 0.3.1" and "binds from 0.4.0", which left a patch release
between the two clauses governed by neither.)

See the next section for what that record actually shows, because it is the reason
this policy exists.

### Going to 1.0

1.0 is a claim, not a milestone feeling. The stated criterion:

1. The six unverified MSIX behaviours in `docs/dev/distribution.md` are closed.
2. Self-update is proven across a real version-to-version upgrade on each of the
   four channels, not merely "the manifest was published".
3. No known data-loss bug.

After 1.0 the semantics become real for users: **major** means "your repositories
or settings need your attention", minor means features, patch means fixes.

## What the record shows (why this file exists)

Twenty-four releases between 2026-06-30 and 2026-09-01. Three defects, all of
them the kind a rule plus a guard would have caught:

- **The number did not describe the change.** Fifteen of twenty-four releases are
  patch-numbered while their own changelog entry is labelled `status: 'feature'`.
  The sharpest case is the newest: **v0.3.1 is a patch containing a brand-new
  built-in terminal** — a real pty, per-tab shells, a Settings field. v0.1.1
  shipped an entire new distribution channel (Scoop) as a patch. v0.0.8 shipped
  line staging, authenticated remotes, signing, clone & init and graph v2 as a
  patch. A reader cannot tell 0.0.8 (35 commits, five features) from 0.0.15
  (4 commits) by looking at the version.

- **v0.0.2 and v0.0.3 are the same commit** (`b040568a`), published four minutes
  apart. Two version numbers, one tree, identical binaries. v0.0.3's changelog
  entry nonetheless lists four items under "New features" — the sign-off toggle,
  browse-at-revision, log search, recent commit messages — all of which were
  already in the v0.0.2 binary. The published record contradicts the git history.

- **v0.1.2 shipped to every channel with no changelog entry.** The tag, the
  GitHub release, the cask, apt, Scoop and `latest.json` all exist; the site's
  changelog jumps 0.1.1 → 0.2.0. The changelog-first ordering was folklore, so
  when it was skipped nothing failed.

One more pattern, which is *not* a versioning defect but is worth naming because
the numbers record it: **every minor since 0.1.0 needed a same-day patch.**
0.1.0→0.1.1→0.1.2 on Aug 27; 0.2.0→0.2.1 on Aug 31; 0.3.0→0.3.1 forty minutes
apart. Three for three. That is a release-readiness signal, not a numbering one —
the fix is the pre-flight below, not a different bump.

## The runbook

**Order matters, and the first step is the one that has actually been skipped.**

### 1. The changelog entry lands on `main` first

Add the entry to the top of the `changelog` array in `site/src/data/features.ts` —
`version`, `date`, `status`, `summary`, `sections` — and merge it to `main`
**before** the release exists. Publishing the release triggers the build against
the tag, and the tag is created at publish time from `main`'s tip: a changelog
merged afterwards is not in the release. This is how v0.1.2 ended up with no entry.

Merging it also deploys the site (`site.yml` fires on `site/**`), so the changelog
page is live by the time the release is published — which is the order you want
anyway.

Pick `status` honestly — it is the thing the bump rule keys on, and it is
rendered to users.

### 2. Pre-flight

**`release.yml` runs no tests.** It checks out the tag and builds. There is no
gate between a red `main` and a `.dmg` on every channel — so this step is the
gate, and skipping it is not a shortcut, it is the whole risk.

- `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml` green on the
  `main` tip you are about to tag.
- The full e2e suite green on that tip (CI's `e2e-linux` is the required check).
  E2E here has a documented CI-only flake class; one red is not proof of a bug,
  but it is also not permission to tag. Re-run the failed shard and get a green.
- If `productName` changed since the last release, **fix the Homebrew cask
  first** — `bump-cask` rewrites only version and sha256, and it now fails the
  release on an `app` stanza that does not match `productName`. Better to fix the
  tap than to discover it mid-release.

### 3. Publish the release

Draft a GitHub Release in the UI, enter the `vX.Y.Z` tag (GitHub creates the tag
on publish), write the body, publish. **Publish direct — not as a prerelease** —
unless you have read the promotion trap below and want it anyway.

From the CLI it is `gh release create vX.Y.Z --target <sha>`, and **`--target`
wants a full 40-character SHA** — a short one is rejected, and not with an error
that says so. `git rev-parse origin/main` gives you the right thing.

The body is not just release notes: `updater-manifest` embeds it verbatim into
`latest.json` as the text the in-app updater shows. Write it for that audience.

### 4. What CI then does

`version` (gate) → the build jobs (`macos-universal`, `windows`, `linux`, and
`msix-build` ×2 → `msix`) → six channel publishes, each gated on `prerelease == false`
(`bump-cask`, `bump-scoop`, `updater-manifest`, `apt-publish`, `winget-publish`,
`msstore-publish`) → two live installs that verify the channel really serves the
new version (`scoop-verify-live`, `apt-verify-live`).

**The Store package is two jobs, and only the second one attaches anything.**
`msix-build` is a 2-arch matrix (x64, arm64) that builds and packs one `.msix`
each and uploads it as an artifact; `msix` downloads both, runs `makeappx
bundle`, gates the shape and attaches `PlatypusGit.msixbundle`. They were a
single job until the two back-to-back builds made msix the release's long pole —
17m against 9–12m for every other build job on v0.5.0. Read a red `msix-build`
as "one architecture failed" (it is not fail-fast, so the other leg still tells
you whether the break is arch-specific) and a red `msix` as "both built, the
bundle did not".

**Two of the six self-disable, and a green job there means "submitted
nothing".** `winget-publish` when `WINGET_TOKEN` is unset — expected today, do
not read it as "winget shipped"; `scripts/winget-wizard.sh` makes the first
submission by hand and its last step stores the secret. `msstore-publish` when
any of `MSSTORE_TENANT_ID` / `_SELLER_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` or
the `MSSTORE_PRODUCT_ID` variable is unset; `scripts/msstore-wizard.sh` step 9
sets those up. `msstore-publish` also skips — green, having done nothing —
when the Store already holds this version, which is what makes a
`workflow_dispatch` re-cut safe. Read its log, not its colour.

The live verifications mean most post-publish checking is automated. Three things
are not:

```bash
gh api repos/jonassaa/platypusgit/releases/latest --jq .tag_name   # must be the new tag
```

- **The pointer**, above — nothing in CI checks it.
- **Nine assets attached**: `latest.json`, `PlatypusGit_universal.dmg`,
  `PlatypusGit_x64.msi`, `PlatypusGit_x64_portable.zip`, `PlatypusGit.msixbundle`,
  `PlatypusGit_amd64.deb`, `PlatypusGit_amd64.AppImage`, `PlatypusGit_arm64.deb`,
  `PlatypusGit_arm64.AppImage` — the two Linux architectures are separate matrix
  legs (#266), so a missing pair points at one leg, not at the whole job.
- **`latest.json`'s `notes` is your release body, not a bare link.** A link means
  a `workflow_dispatch` run wrote it (see the promotion trap) and users will see
  that link instead of your notes.

## Traps

**Promoting a prerelease is a four-step dance, and the order matters.** Three
separate mechanisms interact; the states below were measured on v0.0.15 and
v0.0.16, and `release.yml`'s own header comment describes two of them
inconsistently — this section is the reconciliation.

1. **A prerelease publish attaches the bundles and nothing else.** All five
   channel jobs are gated on `prerelease == false`, so there is no `latest.json`,
   no cask bump, no apt, no Scoop.
2. **Clearing the flag does not move `releases/latest`.** `gh release edit
   --prerelease=false` sets `prerelease=false`, but the pointer kept resolving to
   the *previous* version (measured: still stale after 10 minutes — not caching).
   A release created as a prerelease cannot hold GitHub's `make_latest`, and
   clearing the flag does not grant it. The failure here is **silent staleness**:
   the GitHub UI shows the new release as current while brew, Scoop, apt and the
   in-app updater all go on serving the old one.
3. **`make_latest=true` moves the pointer** —
   `gh api -X PATCH repos/jonassaa/platypusgit/releases/<id> -f make_latest=true`.
   Do this *before* `latest.json` exists and you convert silent staleness into an
   active failure: clients discover the version, fetch
   `releases/latest/download/latest.json`, and get a **404**.
4. **Only a `workflow_dispatch` run attaches `latest.json`** for an
   already-published tag. Promotion fires `released` only, never `published`, and
   the `version` job gates on `published` — so flipping the flag no-ops the entire
   workflow.

**The order that works** (proven on v0.0.16) — dispatch *before* flipping, so
`releases/latest` never points at a release whose `latest.json` is missing:

```bash
gh workflow run release.yml -f tag=vX.Y.Z        # attaches latest.json, bumps cask/apt/scoop
gh release edit vX.Y.Z --prerelease=false
gh api -X PATCH repos/jonassaa/platypusgit/releases/<id> -f make_latest=true
gh api repos/jonassaa/platypusgit/releases/latest --jq .tag_name   # confirm it moved
```

Cost: two full builds (~12 min each), because the channel jobs chain off the
platform jobs. **And the dispatch run writes fallback notes** — `updater-manifest`
reads notes from `github.event.release.body`, which a dispatch has no payload for,
so `latest.json` gets `"See https://github.com/…/releases/tag/vX.Y.Z"` and a
`pub_date` stamped at run time. The in-app updater then shows a link instead of
your notes. Only a direct full-release publish gets the real body into
`latest.json`. That is an inherent cost of the prerelease-first flow, not a bug to
chase — and it is the strongest argument for publishing direct.

**Prerelease identifiers do not build.** `scripts/msix-pack.sh` requires a
three-part `X.Y.Z` and exits 2 on anything else, and neither `msix-build` (which
runs it) nor `msix` has a prerelease gate — so a `v0.4.0-rc.1` tag fails both
legs of the matrix and produces a red release with three of the four bundles. `update.rs` parses such a tag fine (it
uses the `semver` crate's `cmp_precedence`), so the limitation is packaging, not
the app. **The de facto rule, and the one to keep until someone needs otherwise:
a prerelease is a stable-shaped `X.Y.Z` number flagged in the GitHub UI.** If
that ever needs to change, the fix is to map the identifier into the MSIX fourth
part — which is what that part is for, and would settle the "unconfirmed claim"
recorded in `docs/dev/distribution.md`.

**A red `apt-verify-live` is not a reason to re-cut.** GitHub Pages does not
publish atomically, and on v0.2.0 that produced two red releases with no defect
behind them (`apt-repo-smoke.sh` documents both windows in its own comments). The
script now waits for the expected version to actually be listed, and the job
allows 900s — so check what the host is really serving, then `gh run rerun <id>
--failed`. Re-cutting a release over a propagation race creates a real problem to
replace an imaginary one.

**A second `workflow_dispatch` queues, it does not replace.** The workflow's
concurrency group is `release` with `cancel-in-progress: false`.

**Never reuse a tree for a new version.** If a release must be re-cut, re-run the
workflow against the existing tag by `workflow_dispatch`. Publishing a new version
number over an identical commit is what produced the v0.0.2/v0.0.3 pair, and the
changelog then has to invent a difference that does not exist.

## Guards that should exist and do not

Both are cheap, both fit the shape this repo already uses for invariants
(`test/docs.test.ts`, `test/appErrors.test.ts`, `test/depOverrides.test.ts`), and
each one corresponds to a defect above that actually shipped:

1. **`test/changelog.test.ts`** — over `site/src/data/features.ts`, for entries
   from 0.4.0 onward: the newest version is a legal semver successor to the one
   below it; dates are non-decreasing; and an entry whose `status` contains
   "feature" is a minor bump. That last assertion is this file's policy, made
   executable.
2. **A release-time changelog gate** — a step in `release.yml`'s `version` job
   that fails when `features.ts` at that tag has no entry matching it. This is the
   one that would have caught v0.1.2, and it is worth more than the other because
   it fires at the moment the mistake is made.

Until they exist, this file is the only thing enforcing any of it, and files do
not fail builds.
