---
name: releasing
description: Use when cutting a platypusgit release or choosing its version number — deciding minor vs patch, tagging, writing the changelog entry, publishing the GitHub Release, promoting a prerelease, or diagnosing a release that shipped with a missing changelog, a stale releases/latest pointer, a self-update 404, or a failed msix job.
---

# Releasing platypusgit

The full story — the policy, the evidence behind it, the runbook — is
`docs/dev/releasing.md`. **Read it before tagging anything.** This file is the
decision and the traps.

## The version is the tag. Never edit a version in the tree.

`package.json`, `Cargo.toml` and `tauri.conf.json` all read `0.0.0` and that is
correct. `release.yml` injects the tag-derived version at build time. There is no
bump commit and no release-prep PR. A local binary reporting `0.0.0` is a dev
build, not a bug.

## Which part do I bump?

| Bump | When |
|---|---|
| **minor** `0.N.0` | Any new user-visible capability. Any new distribution channel. Any change to a persisted format, settings shape, or on-disk state. |
| **patch** `0.N.M` | Fixes, performance, docs, packaging repairs to a channel that already shipped. **No new capability.** |

Pre-1.0, **the minor is the major**. The operational test:

> **If the changelog entry's `status` says "feature", it is a minor.**

That field is in `site/src/data/features.ts` and it is rendered to users. You
write it as part of cutting the release, so write it honestly and let it decide
the number — not the other way round.

**Everything published before the policy landed is grandfathered** (v0.3.1 and
below); the rule binds on the next release cut after it. Do not copy the old
numbering as precedent: fifteen of the twenty-four shipped releases are
patch-numbered with a `status: 'feature'` entry, v0.3.1 shipped an entire
built-in terminal as a patch, and v0.1.1 shipped a whole distribution channel as
a patch. **History here is the counter-example, not the pattern.**

**Check what is actually unreleased before picking a number** — `git log
<last-tag>..origin/main`. A feature you have in mind may already have shipped,
which changes a minor into a patch.

## The order — this is the step that actually gets skipped

**1. Changelog entry merges to `main` FIRST.** Add to `site/src/data/features.ts`
(`version`, `date`, `status`, `summary`, `sections`) and land it on `main` before
the release exists. The tag is created from `main`'s tip at publish time, so a
changelog merged afterwards is not in the release.

> This is not hypothetical. **v0.1.2 shipped to every channel with no changelog
> entry** — the public changelog jumps 0.1.1 → 0.2.0. Nothing failed, because
> nothing checks.

**2. Pre-flight — and note that `release.yml` runs NO tests.** It checks out the
tag and builds. Nothing stands between a red `main` and a `.dmg` on every
channel, so this step is the gate. `pnpm test` and `cargo test` green on the tip
you will tag; e2e green (`e2e-linux` is the required check). If `productName`
changed, fix the Homebrew cask **before** releasing — `bump-cask` fails the
release on an `app` stanza that does not match it.

**3. Publish the GitHub Release.** Draft in the UI, enter the `vX.Y.Z` tag,
write the body, publish **direct — not as a prerelease** unless you have read
the promotion trap below. The body is not just notes: `updater-manifest` embeds
it verbatim into `latest.json` as the text the in-app updater shows users.

**4. Verify what CI does not.** It live-installs from apt and Scoop on its own.
It never checks the pointer, the asset set, or the notes:

```bash
gh api repos/jonassaa/platypusgit/releases/latest --jq .tag_name   # must be the new tag
```

- Nine assets: `latest.json`, the `.dmg`, `.msi`, portable `.zip`,
  `.msixbundle`, and a `.deb` + `.AppImage` for EACH Linux architecture
  (`amd64` and `arm64` — separate matrix legs since #266, so a missing pair
  points at one leg rather than the whole job).
- `latest.json`'s `notes` is your release body — **a bare link means a
  `workflow_dispatch` run wrote it**, and that is what users will see.
- `winget-publish` green means nothing was submitted when `WINGET_TOKEN` is
  unset (it is). Expected — not "winget shipped".
- `msstore-publish` green means the same when any `MSSTORE_*` credential is
  unset, and *also* means "skipped" once they are set but the Store already
  holds this version (which is what makes a dispatch re-cut safe). Read the log.
  Certification then runs for hours in Partner Center — the job never waits for
  it, so green is "submitted", never "live".

## Traps

**Promoting a prerelease is a four-step dance and the ORDER matters.** Measured
on v0.0.15/v0.0.16; `release.yml`'s header describes it inconsistently, so trust
`docs/dev/releasing.md`.

- A prerelease publish attaches bundles only — all five channel jobs are gated on
  `prerelease == false`. No `latest.json`, no cask, no apt, no Scoop.
- **Clearing the flag does NOT move `releases/latest`** (still stale after 10
  minutes when measured). Failure mode is *silent staleness*: the UI says the new
  release is current while every channel serves the old one.
- `make_latest=true` moves the pointer. Do it before `latest.json` exists and you
  upgrade silent staleness to an active **404**.
- Only a `workflow_dispatch` run attaches `latest.json` — promotion fires
  `released` only, which the `version` gate skips, so the workflow no-ops.

**Dispatch BEFORE flipping**, so the pointer never leads to a missing manifest:

```bash
gh workflow run release.yml -f tag=vX.Y.Z        # attaches latest.json + bumps channels
gh release edit vX.Y.Z --prerelease=false
gh api -X PATCH repos/jonassaa/platypusgit/releases/<id> -f make_latest=true
gh api repos/jonassaa/platypusgit/releases/latest --jq .tag_name   # confirm
```

**Know the cost:** a dispatch run has no release payload, so `latest.json` gets a
bare link instead of your notes, and `pub_date` is stamped at run time. Only a
direct publish gets the real body in. Two full builds, ~12 min each.

**Prerelease identifiers do not build.** `scripts/msix-pack.sh` requires
three-part `X.Y.Z` and exits 2 on anything else, and neither `msix-build` (which
runs it, once per arch) nor `msix` has a prerelease gate — so `v0.4.0-rc.1`
fails both matrix legs and leaves a red release with three of four bundles. `update.rs` parses such a tag fine; the limit is
packaging. **A prerelease here is a stable-shaped `X.Y.Z` flagged in the GitHub
UI.**

**Never put a new version number on an unchanged tree.** To re-cut, re-run the
workflow against the *existing* tag via `workflow_dispatch`. Publishing a new
number over an identical commit is what produced v0.0.2 and v0.0.3 — same commit
`b040568a`, four minutes apart, and a changelog that had to invent a difference.

## Red flags — stop

- "It's a small feature, patch is fine." → New capability is a **minor**. v0.3.1
  is the mistake, not the precedent.
- "I'll add the changelog entry after I publish." → Then it is not in the
  release. Changelog first, always.
- "`--prerelease=false` promoted it." → It moved nothing. `releases/latest` still
  points at the old release and `latest.json` was never attached. Dispatch first,
  then flip, then `make_latest`, then verify.
- "The last release was a patch with features, so I'll match it." → History is
  grandfathered. The rule binds from 0.4.0.
- "I'll bump the version in `package.json` too." → No. The tag is the version.
- "`apt-verify-live` is red, re-cut the release." → Almost never. Pages does not
  publish atomically; on v0.2.0 that produced two red releases with no defect.
  Check what the host serves, then `gh run rerun <id> --failed`.
- "CI is green, so the build is tested." → `release.yml` runs no tests at all.

## Not yet enforced

Nothing fails the build for any of the above — `docs/dev/releasing.md` specifies
two guards (a `test/changelog.test.ts` over `features.ts`, and a release-time
gate that fails when the tag has no changelog entry) and **neither exists yet**.
Until they do, this file and that doc are the only enforcement, and files do not
fail builds. If you are here because something went wrong, consider writing the
guard instead of only fixing the release.
