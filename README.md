<div align="center">

<img src="src-tauri/icons/icon.png" alt="platypusgit logo" width="96" height="96">

# platypusgit

**A fast, keyboard-driven git desktop app for developers.**<br>
Free and open source. No account, no telemetry. macOS, Windows, Linux.

[![Release](https://img.shields.io/github/v/release/jonassaa/platypusgit?label=release&color=3E9B91)](https://github.com/jonassaa/platypusgit/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-3E9B91)](#install)
[![tests](https://github.com/jonassaa/platypusgit/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/jonassaa/platypusgit/actions/workflows/tests.yml)

[**Download**](https://www.platypusgit.com/download/) ·
[Website](https://www.platypusgit.com) ·
[Features](https://www.platypusgit.com/features/) ·
[Changelog](https://www.platypusgit.com/changelog/)

</div>

![The platypusgit history view: a commit graph beside a table of commits with their refs, and below it the selected commit's message, the file it changed, and that file's diff with syntax highlighting and a minimap.](site/screenshots/history-dark.png)

## Install

**macOS** — Homebrew is the smoothest route; it installs the [`pgit`](#the-pgit-command) command with the app and owns updates.

```bash
brew install --cask jonassaa/platypusgit/platypusgit   # install
brew update && brew upgrade --cask platypusgit         # update
```

The app is ad-hoc signed but not notarized. The cask clears the macOS Gatekeeper
quarantine flag on install, so it launches with no "unidentified developer"
prompt. No Homebrew? Take the `.dmg` below — a drag-install needs the quarantine
flag cleared by hand, and is told about new versions rather than fetching them.

**Windows** — [`PlatypusGit_x64.msi`](https://github.com/jonassaa/platypusgit/releases/latest/download/PlatypusGit_x64.msi). Installs `pgit` and puts it on your PATH. Not code-signed, so SmartScreen will warn on first run; after that the app updates itself in place.

Or with [Scoop](https://scoop.sh) — per-user, no admin prompt, and `scoop` owns
updates from then on.

```powershell
scoop bucket add platypusgit https://github.com/jonassaa/scoop-platypusgit
scoop install platypusgit    # install
scoop update platypusgit     # update
```

Scoop installs a portable build and shims `pgit` itself, so the in-app updater
stands down — the two can never disagree about which copy you are running.
There is still no `winget` package
([#187](https://github.com/jonassaa/platypusgit/issues/187)): it needs a
code-signing certificate more than it needs code.

**Linux (Debian · Ubuntu)** — one line to install, and `apt` owns updates from
then on.

```bash
curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh   # install
sudo apt update && sudo apt upgrade platypusgit                      # update
```

The script adds a signed APT repository at `apt.platypusgit.com` and installs
`platypusgit` from it — amd64 only so far
([#266](https://github.com/jonassaa/platypusgit/issues/266)), and it says why
and stops rather than quietly substituting a package format you did not ask
for. It is POSIX `sh`, never reads stdin, takes
`--dry-run`, and is a build-time copy of
[`scripts/install-platypusgit.sh`](./scripts/install-platypusgit.sh) — read it
before you run it. The signing key's fingerprint
(`294C261A1641704535EAC137DDA53BD2C15FB1FB`) and the repository steps spelled
out by hand are on the [download page](https://www.platypusgit.com/download/).

The `.deb` needs `git` and `webkit2gtk 4.1`, and ships `/usr/bin/pgit`. One
installed by hand (`sudo apt install ./PlatypusGit_amd64.deb`) still works, but
`apt upgrade` will not see it — the update panel spots that and offers the
one-liner above, which upgrades and moves the install onto the repository in the
same step. On any other distribution take the AppImage: it installs no `pgit`,
but it does update itself in place.

[`.deb`](https://github.com/jonassaa/platypusgit/releases/latest/download/PlatypusGit_amd64.deb) ·
[`.AppImage`](https://github.com/jonassaa/platypusgit/releases/latest/download/PlatypusGit_amd64.AppImage) ·
[`.dmg`](https://github.com/jonassaa/platypusgit/releases/latest/download/PlatypusGit_universal.dmg) ·
[`.msi`](https://github.com/jonassaa/platypusgit/releases/latest/download/PlatypusGit_x64.msi) ·
[all releases](https://github.com/jonassaa/platypusgit/releases)

Every route, per platform, with the Gatekeeper and update notes spelled out:
[platypusgit.com/download](https://www.platypusgit.com/download/).

## Why another git GUI

- **Free, all of it.** GPL-3.0, no license fee, no per-seat pricing, no "pro" tier gating rebase or conflict resolution.
- **No account, no telemetry.** Nothing to sign in to and no analytics SDK anywhere in the tree. Your repositories and history never leave your machine. Forge tokens for the optional pull-request integration are yours, supplied by you and stored by your own git credential helper.
- **Native, not a bundled browser.** A small Tauri binary with real OS windows on all three platforms.
- **Keyboard-first and dense.** A Rider-style default keymap, a command palette, type-to-jump lists, hunk navigation and staging without touching the mouse — a dev-first TortoiseGit alternative that assumes you know git.

## How it compares

| | Price | Account | Telemetry | Platforms | Licence |
|---|---|---|---|---|---|
| **platypusgit** | Free | None | None | macOS · Windows · Linux | GPL-3.0 |
| [GitKraken Desktop](https://www.gitkraken.com/pricing) | Free for local and public repos — **a paid seat for private ones** | Account for **private repos** | Usage analytics **plus the folder and file names where you keep your code** | macOS · Windows · Linux | Proprietary |
| [Fork](https://fork.dev/) | **$59.99** once, up to 3 machines | None | None — crash reports only | macOS · Windows | Proprietary |
| [Sourcetree](https://www.sourcetreeapp.com/) | Free | **Atlassian account required** | Anonymous usage data, opt-out | macOS · Windows | Proprietary |
| [TortoiseGit](https://tortoisegit.org/) | Free | None | Crash dumps, unless disabled at install | **Windows only** | GPL-2.0 |

**Under the hood:** GitKraken ships as an Electron app. Fork, Sourcetree and
TortoiseGit are native. platypusgit is a Tauri binary that uses the OS webview
rather than bundling a browser of its own.

**Checked against each vendor's own pages on 25 August 2026.** Prices and
privacy policies change, so every claim above links to the source it came from —
re-check any cell in a minute. A cell that has gone stale is a bug worth
[reporting](https://github.com/jonassaa/platypusgit/issues/new).

<details>
<summary><b>Sources, claim by claim</b></summary>

- **GitKraken Desktop** — [pricing](https://www.gitkraken.com/pricing); ["always free to use with local and public cloud-hosted repos"](https://www.gitkraken.com/git-client), while on the free plan ["private repos will be inaccessible"](https://help.gitkraken.com/gitkraken-desktop/gitkraken-account-site-faq/). On accounts we deliberately claim less than we could: one free [GitKraken account](https://help.gitkraken.com/gk-dev/gk-dev-account/) spans Desktop, GitLens and the CLI, and a paid subscription on it is what unlocks private repos — but their install guide says that once you run the installer ["you can open the app and start working with your repositories"](https://help.gitkraken.com/gitkraken-desktop/how-to-install/), and no GitKraken page we found states that signing in is required to open one, so the table does not say it is. Telemetry, from [their privacy policy](https://www.gitkraken.com/privacy) verbatim: "when you use any of our applications, we store some usage analytics, the directory, folder and file names on your device where you store your code, and any crash reports sent from your client." Electron: ["delivered across platforms as an Electron application"](https://www.gitkraken.com/blog/nodegit-libgit2).
- **Fork** — [$59.99 with a free evaluation](https://fork.dev/); the [licence](https://fork.dev/license): "License key may be used by one user on up to 3 machines at a time on both Mac and Windows operating systems." On telemetry, Fork's developer on their public tracker in June 2023: ["Fork doesn't send any telemetry or analytics"](https://github.com/fork-dev/Tracker/issues/1910) — the crash handler is wired for crashes only, with the analytics module explicitly disabled — and again in January 2024: ["Fork doesn't call home and has no telemetry. So we don't have a privacy policy as we have nothing to declare."](https://github.com/fork-dev/Tracker/issues/2046) No Linux build; [that request is still open](https://github.com/fork-dev/Tracker/issues/153).
- **Sourcetree** — [free, "for Windows and Mac"](https://www.sourcetreeapp.com/). The account, from Atlassian's install guide: ["You need an Atlassian account to use Sourcetree."](https://confluence.atlassian.com/get-started-with-sourcetree/install-sourcetree-847359094.html) Usage data is collected under [Atlassian's privacy policy](https://www.atlassian.com/legal/privacy-policy) and switched off in the app's options; setup once *required* it, per [Atlassian's own bug report](https://jira.atlassian.com/browse/SRCTREEWIN-10821).
- **TortoiseGit** — ["developed under the GPL"](https://tortoisegit.org/about/), specifically [GPLv2 in the source tree](https://github.com/TortoiseGit/TortoiseGit/blob/master/LICENSE). Windows only, needs a command-line git, and ["Windows 10 version 1607 or newer is required"](https://tortoisegit.org/support/faq/). It ["includes a crash reporter (if not disabled on installation), which automatically uploads crash dumps to drdump.com"](https://tortoisegit.org/support/).
- **platypusgit** — [GPL-3.0](./LICENSE). No analytics dependency in `package.json` or `src-tauri/Cargo.toml`, and no analytics SDK in `src/` or `src-tauri/`. Nothing to sign in to: the only credential prompts are git's own, and the optional pull-request integration uses a token you paste yourself, kept by your git credential helper (`src-tauri/src/forge/`). The only outbound traffic is your git remotes, the update check, and forge APIs you configured. None of this is on trust: `test/privacy.test.ts` and `src-tauri/tests/no_telemetry.rs` fail the build if an analytics package reaches either dependency tree, if the frontend gains a network call, or if a hostname or an update endpoint appears that is not on a short allow-list with a written reason ([#226](https://github.com/jonassaa/platypusgit/issues/226)).

</details>

**Where we are behind.** We are 0.5.x and the youngest tool on this list:
installers that warn on first launch, no in-app update on macOS, and changed
images shown as "binary" rather than a preview — the full list is under
[Status](#status). Two of the gaps are deliberate rather than unfinished: no
Mercurial, and no Finder/Explorer shell integration, which is the thing
TortoiseGit exists for.

## Features

- **Start anywhere** — open a repository, clone one (submodules included, with progress), or init a new one, and keep the ones you use in the recent list; reveal any file in Finder or Explorer, or open the repository in your terminal, straight from the context menu.
- **Staging that goes down to the line** — stage, unstage or discard whole files, individual hunks, or single lines; drag files between Changes and Staged; commit with amend and author override, running the commit-side hooks (`pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`) with their output inline and a skip-once escape hatch.
- **Diffs built for reading** — whole-file diffs with no `@@` banners and a scrubable minimap, unified or side-by-side, syntax highlighting and word-level intra-line marks, configurable context, commit-to-commit and range diffs, branch compare, blame, and a file browser at any revision.
- **Branches, tags and history** — full ref management, merge or rebase from the branch picker, lightweight/annotated/signed tags, a commit graph with ref-scoped log, search by message, author, SHA, date or path, per-file history and a reflog viewer.
- **Rewriting, safely** — interactive rebase (pick/reword/edit/squash/fixup/drop, drag to reorder, resumable after quitting the app), reset, cherry-pick, revert, and bisect with git's own progress estimate.
- **Conflicts in one place** — 3-way sides, a dedicated ours · result · theirs resolver window, accept ours/theirs, external mergetool, and an operation bar that says what is in progress.
- **Stash, including partial** — save/apply/pop/drop, stash only the paths you selected, rename, compare, stash to a new branch.
- **Remotes with working auth** — add/remove/rename/prune, fetch/fetch-all/pull, push with-lease or force; every network op prompts for credentials and retries, tag pushes and branch deletes included, and a clone, fetch, pull or push that hangs has a Cancel button — a cancelled clone cleans up the partial directory it left behind.
- **Pull requests without the browser** — GitHub and GitLab, self-hosted included: list open requests, read the CI summary, check one out (forks too), or open one from the current branch.
- **The repositories inside your repository** — submodule and linked-worktree screens, and a git-LFS panel with pointer-aware diffs.
- **Several repos, one window** — multi-repo tabs, each with its own screen and badges, the active repository and branch named in the window title, plus resizable panes and a `?` cheat sheet.

The exhaustive list — every keybinding and option — lives at
[platypusgit.com/features](https://www.platypusgit.com/features/).

## The `pgit` command

`pgit` opens the app on a repository from the terminal and hands the prompt
straight back.

```bash
pgit                    # plain launch — last persisted repo/screen
pgit .                  # open the repo containing cwd
pgit ~/dev/foo          # open the repo containing that path
pgit commit             # open the cwd repo, land on the Commit panel
pgit log src/           # open the repo containing src/, land on History
pgit --help             # print usage, no window
pgit --version          # print version, no window
pgit --debug .          # open it, but stay attached and stream the log here
```

| subcommand | screen |
|---|---|
| `commit`, `status` | Commit panel |
| `log`, `history` | History |
| `branches`, `branch` | Branches |
| `files`, `browse`, `tree` | Files |
| `rebase` | Rebase |
| `remote`, `remotes` | Remotes |
| `pr`, `prs`, `pulls` | Pull requests |
| `reflog` | Reflog |
| `submodules` | Submodules |
| `worktrees` | Worktrees |
| `settings`, `config` | Settings |

A bare path with no recognized subcommand opens that repository and keeps the
current screen. If the app is already running, a second `pgit …` doesn't spawn
another instance — it forwards the request to the running window, focuses it,
and navigates there.

**`--debug` when something goes wrong at startup.** It is the one flag that
keeps the app in the foreground instead of handing the prompt back, and it
raises the log level, so the app's log — including every call the window makes
to the backend — streams into the terminal you launched it from. Ctrl+C quits
the app. Because a second `pgit` forwards to the running window rather than
starting anything, quit the app first if you want to trace a fresh launch.
Unix only: the Windows binary has no console to print to, though `--debug` still
raises the level of the log file it writes.

**Most installs already have it.** The Homebrew cask, the `.deb` (via apt or by
hand), the `.msi` and Scoop all install `pgit` alongside the app and remove it
on uninstall. Only the macOS `.dmg` and the Linux AppImage run no install code,
so those two need
**Settings → Command line → Install** in the app, or:

```bash
curl -fsSL https://www.platypusgit.com/install-pgit.sh | sh    # macOS .dmg / Linux AppImage
irm https://www.platypusgit.com/install-pgit.ps1 | iex         # Windows, outside .msi/Scoop
```

Both scripts are meant to be read before they are run — they are a build-time
copy of [`scripts/install-pgit.sh`](./scripts/install-pgit.sh) and
[`.ps1`](./scripts/install-pgit.ps1), and both take `--dry-run`.

## Status

**Active development, versioned 0.5.x** — expect frequent releases and rough
edges. Most core git operations work end to end (the feature list above is what
is implemented, not a roadmap). Known gaps, stated plainly:

- macOS builds are ad-hoc signed and not notarized; the Windows `.msi` is not code-signed.
- No `winget` package yet — that one really does wait on the code signing above, which is what separates it from Scoop ([#187](https://github.com/jonassaa/platypusgit/issues/187)). Windows installs from the `.msi` or in one line from Scoop; the `.msi` self-updates from then on, Scoop owns updates on its own installs, and so does the Linux AppImage.
- No in-app update on macOS: Homebrew owns upgrades there, and a `.dmg` drag-install is told a new version exists rather than fetching it.
- The APT repository is amd64 only ([#266](https://github.com/jonassaa/platypusgit/issues/266)), and there is no `.rpm` or AUR package, so every other Linux takes the AppImage. Scoop is x64 only for the same reason.
- Changed images are reported as binary rather than previewed side by side ([#224](https://github.com/jonassaa/platypusgit/issues/224)).
- Standalone GUI only: no icon overlays or context menus inside Finder and Explorer themselves, which is a different thing from the app's own reveal-in-file-manager action. Mercurial is out of scope too.

Found a bug or want a feature? [Open an issue](https://github.com/jonassaa/platypusgit/issues).

## Development

```bash
pnpm install
pnpm tauri dev     # first run compiles the whole Rust tree: 2-5 min. Reruns ~10s.
```

Needs Node 22+, pnpm and Rust stable, plus the platform build tools listed in
[`CONTRIBUTING.md`](./CONTRIBUTING.md#1-prerequisites).

```bash
pnpm tauri build --no-sign     # .dmg / .msi / .deb / .AppImage in src-tauri/target/release/bundle/
```

`--no-sign` is not optional locally: the Tauri config carries an updater public
key, and a build that produces updater artifacts without the matching private
key (`TAURI_SIGNING_PRIVATE_KEY`) fails hard.

[`CONTRIBUTING.md`](./CONTRIBUTING.md) owns the full setup, the test commands and
the PR workflow. The architecture tour for humans is in
[`docs/dev/`](./docs/dev/) — [`architecture.md`](./docs/dev/architecture.md)
(annotated source trees), plus `frontend.md`, `backend.md`, `testing.md` and
`distribution.md`. Design specs and implementation plans live under
[`docs/superpowers/`](./docs/superpowers/).

## Contributing

Contributions welcome — including documentation and triage. Start with
[`CONTRIBUTING.md`](./CONTRIBUTING.md), pick up a
[good first issue](https://github.com/jonassaa/platypusgit/labels/good%20first%20issue),
and please read the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[GNU General Public License v3.0](./LICENSE).
