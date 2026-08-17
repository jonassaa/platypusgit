# `pgit` as part of app installation, on every channel

**Issue:** [#144](https://github.com/jonassaa/platypusgit/issues/144)

## Problem

`pgit` exists (`2026-07-07-cli-launch-*`, #25) but only arrives if the user finds
Settings → Command line and clicks Install:

- **macOS** — `default_shim_dir()` is `/usr/local/bin`, which is root-owned (and
  on Apple Silicon usually absent). `install_shim` therefore fails for most
  users and hands back a `sudo ln -sf …` line to paste. That paste line is the
  product's whole answer today.
- **Windows** — `default_shim_dir()` returns `None`, `shim_status().installed` is
  hardcoded `false`, and Settings renders a dead row: *"Not yet supported on
  Windows."*
- **Linux** — `~/.local/bin` works, but nothing put it there; a `.deb` install
  leaves the user with no `pgit`.
- **Every channel** — the app ships no packaging hook at all, so the CLI is
  never present after an install.

And the piece that has to be settled before any of the three layers is written:
a package-managed `pgit` and an app-installed `pgit` must not fight. Today
`shim_status` answers exactly one question — *is `<default_shim_dir>/pgit` a
symlink to `current_exe()`* — so a `.deb` user with a perfectly working
`/usr/bin/pgit` is told "Not installed" and offered a button that writes a second
copy somewhere else.

## Design

### A. The contract: who owns `pgit` (settle this first)

Three parties can put a `pgit` on the user's PATH, and the app is only one of
them:

| Party | Where it writes | Removed by |
| --- | --- | --- |
| A package/installer | Homebrew: `$(brew --prefix)/bin/pgit`. deb: `/usr/bin/pgit`. MSI: `<INSTALLDIR>\pgit.cmd` | the package manager / MSI uninstall |
| The app itself (Settings → Command line) | the first writable **app shim dir** (§D) | Settings, or by hand |
| Somebody else | anywhere | them |

`shim_status` grows a `source` field naming which of those it found, and
`installed` widens to mean *`pgit` is present and launches this app* — the
question the user is actually asking:

```rust
pub enum CliShimSource { None, App, Package, Foreign }
```

- **`App`** — a shim in one of the app's own shim dirs that references this app.
  Settings offers Reinstall.
- **`Package`** — a shim outside those dirs that references this app.
  `installed: true`, and **Settings offers no install button at all**: the
  package owns the file, the app must not write a second one, and it must not
  offer to. `install_shim()` is *also* a no-op success in this state, so the
  contract holds even if a future caller (palette, first-run prompt) forgets.
- **`Foreign`** — a `pgit` exists but does not reference this app.
  `installed: false`; Settings says so and still allows an install, because the
  app writes to its own dir and never over the stranger's file.
- **`None`** — nothing found.

**Scan order — app dirs, then known package paths, then `PATH` in order.** Ours
comes first deliberately: "did *we* install this" is the question the Reinstall
button depends on, and a user who has both a deb-shipped and a self-installed
`pgit` is honestly in the `App` state (they did install one). What a shell would
actually run is reported separately, as `pathState`, rather than by reordering the
scan:

```rust
pub enum CliPathState { OnPath, OffPath }
```

`pathState` is the found shim's directory measured against `PATH`. With nothing
found it describes the directory an install *would* target, so Settings can warn
before the click rather than after it.

**A shim "references this app"** if any of the following holds — one pure
predicate, three probes, because the three channels ship three different kinds of
file:

1. it is a symlink whose target is `current_exe()` (self-install, Homebrew cask);
2. it is a symlink whose target's file name is the main binary name (a Homebrew
   symlink surviving an app move);
3. it is a small text file whose contents mention the main binary name (the deb
   wrapper's `exec /usr/bin/platypusgit`, the MSI's `%~dp0platypusgit.exe`).

Probe 3 is capped at 4 KiB and non-UTF-8 reads as "no" — this must never become a
reason to slurp an arbitrary file off `PATH`.

**Accepted ambiguity, recorded so nobody re-derives it as a bug.** On an Intel
Mac, Homebrew's prefix *is* `/usr/local/bin`, which is also the app's first shim
dir. A cask-installed `pgit` there is indistinguishable from a self-installed one
and is classified `App`. It is harmless: both are symlinks to the same target, and
`install_shim` **returns early without touching the filesystem when the existing
link already points at `exe`**, so Reinstall cannot clobber a Homebrew-managed
symlink. Apple Silicon (`/opt/homebrew/bin`) has no ambiguity and classifies
`Package`.

### B. Uninstall

Nothing new is written to answer it — each channel's own remover already does:

| Channel | On uninstall |
| --- | --- |
| Homebrew cask | `brew uninstall` removes the `binary` symlink |
| `.deb` | dpkg ships `/usr/bin/pgit` in `data.tar`, so `apt remove` deletes it |
| `.msi` | the component's file and its `Environment` PATH entry are both `Permanent="no"` → rolled back |
| `.dmg` / AppImage / self-installed | the app's own symlink survives; it is a dangling symlink in the user's own `~/.local/bin`, which is the same thing every other hand-installed CLI leaves. **Not** removed by the app, because the app is gone |

Deliberately **no** `postrm` and **no** uninstall command: a package that deletes
files it did not ship is a policy violation, and the app cannot run code after it
has been deleted.

### C. `.deb` — `/usr/bin/pgit` as a wrapper

```json
"deb": {
  "files": { "/usr/bin/pgit": "deb/pgit" },
  "postInstallScript": "deb/postinst"
}
```

`src-tauri/deb/pgit` is four lines: `#!/bin/sh` and
`exec /usr/bin/platypusgit "$@"`. The target is spelled **absolutely rather than
via `dirname "$0"`** on purpose — it is what the §A probe-3 classifier greps for,
and dpkg installs the wrapper at exactly one path anyway.

Why a wrapper and not a symlink: `deb.files` is copied with
`fs_utils::copy_file` → `std::fs::copy`, which **follows** symlinks. A symlink
source would duplicate the whole binary into the package.

**The exec bit — verified in the bundler, not assumed.** The chain is three links
and every one of them was read:

1. git stores the mode. `src-tauri/deb/pgit` is committed `100755`, so an
   `actions/checkout` on the Linux runner writes it executable.
2. `fs_utils::copy_file` is `fs::copy`, documented to copy the permission bits.
3. `debian.rs::create_tar_from_dir` sets
   `header.set_metadata_in_mode(&stat, HeaderMode::Deterministic)`. tar-rs's
   Deterministic branch is *not* a blanket 0644 — on Unix it is
   `if meta.is_dir() || (0o100 & meta.mode() == 0o100) { 0o755 } else { 0o644 }`,
   i.e. **it propagates the user execute bit**. The Windows branch of the same
   function does not, but the `.deb` is built on `ubuntu-22.04`.

So the exec bit survives. It cannot be *observed* to survive without building a
`.deb`, which needs Linux — hence `deb/postinst`, whose only job is a guarded
`chmod`:

```sh
if [ -e /usr/bin/pgit ] && [ ! -x /usr/bin/pgit ]; then chmod 0755 /usr/bin/pgit; fi
```

It is a belt for a brace that source-reading says is already fastened, and it is
written so it cannot fail an install: it touches one path, only when that path
exists and lacks the bit, and it exits 0 for every `postinst` argument other than
`configure`. A `postinst` that exits non-zero fails `dpkg -i` for the whole
package, so this file's blast radius is the entire Linux release — it stays this
small.

`deb.files` is copied in `package_debian`, **not** in `generate_data`, and the
AppImage bundler only calls the latter — so neither the wrapper nor the postinst
reaches the AppImage. AppImage stays script-only, as the issue's table says.

### D. macOS + Linux: no-sudo by default

`default_shim_dir() -> Option<PathBuf>` becomes `app_shim_dirs() -> Vec<PathBuf>`,
ordered most-preferred first, and `install_shim` takes the first one it can
actually write:

| OS | Order | Why |
| --- | --- | --- |
| macOS | `/usr/local/bin`, `~/.local/bin`, `~/bin` | `/usr/local/bin` is the only one on the default `PATH`, and where every existing install already is. It is tried *first* and skipped when unwritable, so existing users are unaffected and everyone else lands sudo-free |
| Linux | `~/.local/bin`, `~/bin` | unchanged first entry |
| Windows | `%LOCALAPPDATA%\PlatypusGit\bin` | per-user, no admin, and the dir we add to the per-user PATH (§F) |

There is **no writability pre-probe**: `install_shim` attempts each candidate and
takes the first success, which is the only honest test of "can I write here" and
avoids a TOCTOU between probe and write. The `sudo ln -sf` fallback stays for the
case where *every* candidate fails, but with `~/.local/bin` in the list that is
now a genuine edge case (no `$HOME`) rather than the common path.

The cost: a `~/.local/bin` install is usually **off** `PATH` on macOS. That is
reported (`pathState: "offPath"`), not hidden, and Settings renders the one-line
shell export next to it. A wrong-but-on-PATH location (`/usr/local/bin` via
sudo) is not a better answer than a right-but-off-PATH one plus the line that
fixes it.

### E. `.msi` — a WiX fragment

```json
"wix": {
  "language": ["en-US"],
  "fragmentPaths": ["wix/pgit-cli.wxs"],
  "componentRefs": ["PgitCli"]
}
```

`src-tauri/wix/pgit.cmd`:

```
@echo off
"%~dp0platypusgit.exe" %*
```

`%~dp0` is the batch file's own directory, so the shim is self-locating and no
install path is baked in. The release binary is `windows_subsystem = "windows"`,
so `cmd` does not block on it, and `tauri-plugin-single-instance` forwards the
args into a running instance — `pgit .` from a terminal opens a tab.

The fragment installs that file into `INSTALLDIR` and appends `INSTALLDIR` to the
machine `PATH`:

```xml
<DirectoryRef Id="INSTALLDIR">
  <Component Id="PgitCli" Guid="{fixed}" Win64="$(var.Win64)">
    <File Id="PgitCmd" Name="pgit.cmd" Source="$(sys.SOURCEFILEDIR)pgit.cmd" KeyPath="yes" />
    <Environment Id="PgitPath" Name="PATH" Value="[INSTALLDIR]" Part="last"
                 Action="set" System="yes" Permanent="no" />
  </Component>
</DirectoryRef>
```

Five things about that markup are load-bearing, and each is a way the **release
build for every platform's users** breaks if it is got wrong. All five were
checked against `tauri-bundler`'s `msi/mod.rs` + `msi/main.wxs` at `dev` and
against the WiX v3 `wix.xsd`, not assumed:

1. **`Source` must not be a bare relative path.** `run_candle` runs with
   `current_dir` = `target/release/wix/<arch>`, so `Source="pgit.cmd"` would
   resolve there and fail. `$(sys.SOURCEFILEDIR)` is candle's built-in for the
   compiling source file's directory (trailing separator included) — i.e.
   `src-tauri/wix/`. The other candidate, `-dSourceDir`, is passed by the bundler
   but points at the *main binary file*, not a directory.
2. **No Handlebars braces.** `msi/mod.rs` renders every fragment through
   Handlebars before compiling — and then **discards the result**, passing the
   raw file to candle (the render exists only to sniff which `-ext` DLLs the
   file needs). So `{{…}}` is neither substituted nor safe: a malformed
   expression fails the render, and a well-formed one is silently dropped. The
   fragment therefore contains no `{{`.
3. **`$(var.Win64)` is defined per source file.** `main.wxs` defines it in a
   `<?if $(sys.BUILDARCH)?>` preamble, which does *not* carry into a separate
   `.wxs`. The fragment repeats that preamble verbatim — candle is invoked with
   `-arch <arch>` for every input, so `$(sys.BUILDARCH)` is set. Copying the
   preamble rather than dropping the attribute keeps this component's bitness
   identical to the components `main.wxs` already puts in `INSTALLDIR`, so it
   inherits whatever ICE verdict the shipping MSI already gets. `light` runs
   **without `-sval`**, so ICE validation is live and an ICE *error* would fail
   the build — matching the existing components is the low-risk choice.
4. **`componentRefs` lands the component in `main.wxs`'s `Feature Id="External"`.**
   That feature carries no `Level`; `wix.xsd` declares `Level` as optional
   (`xs:integer`, no `use="required"`), so it defaults to installed.
5. **`Environment` is core WiX**, not `WixUtilExtension`, so no extra `-ext` is
   needed — and the bundler passes `WixUtilExtension.dll` anyway.
   `Action="set"` + `Part="last"` is the documented append form (`[~];value`);
   `Permanent="no"` is what makes uninstall remove it.

`INSTALLDIR` is under Program Files and the package is `perMachine`, so the
`System="yes"` write is already elevated. It puts `platypusgit.exe` on `PATH`
too, which is fine.

### F. Windows in-app install (replacing the dead row)

An MSI user never needs this — §A classifies `<INSTALLDIR>\pgit.cmd` as
`Package` and Settings shows no button. It exists for the Windows installs the
MSI does not cover: a build from source, a future portable/unpacked layout, and
an MSI install whose PATH change has not reached the running shell.

Two halves, and only the first is done natively:

1. **The file.** Write `%LOCALAPPDATA%\PlatypusGit\bin\pgit.cmd` containing
   `"<current_exe>" %*`. Windows has no symlink without elevation or Developer
   Mode, so the shim is a `.cmd` here, not a link — which is also why
   `install_shim_at` splits into a Unix (symlink) and a Windows (write file)
   implementation rather than growing a branch inside one.
2. **The per-user PATH.** Delegated to PowerShell, and the reasons are specific:

   - **`setx` is disqualified.** It truncates at 1024 characters and, worse,
     `setx PATH "%PATH%;…"` writes the *merged* machine+user PATH into the user
     PATH. It is the single most common way to destroy a Windows PATH.
   - **`[Environment]::SetEnvironmentVariable(…, 'User')` alone is not enough.**
     If `HKCU\Environment\Path` is `REG_EXPAND_SZ` containing `%USERPROFILE%`,
     .NET writes back `REG_SZ` with the variables **expanded**, permanently. So
     the write goes through `Microsoft.Win32.Registry` with
     `DoNotExpandEnvironmentNames` on the read and `GetValueKind`'s answer
     preserved on the write.
   - It is idempotent: an entry already present (case-insensitive, trailing
     separators normalised) is left alone.
   - `WM_SETTINGCHANGE` is broadcast so new shells see it without a logoff.

   The directory reaches PowerShell **through the environment, not argv** —
   `$env:PGIT_BIN_DIR` — the same rule the credential code follows, here for
   injection rather than secrecy: a path is user-controlled text and
   `-Command` is a script.

   If that half fails, the file half still succeeded: the outcome reports
   `pathState: "offPath"` and Settings names the directory to add. A failed PATH
   write is not a failed install.

`CliInstallOutcome` grows `pathState` for this; `manualCommand` keeps its exact
current meaning (the file could not be written at all).

### G. The copy-paste scripts

`scripts/install-pgit.sh` (macOS + Linux, POSIX `sh`) and
`scripts/install-pgit.ps1` (Windows). Both do what §D/§F do, for the channels
with no hook (`.dmg`, AppImage, zip) and for anyone who would rather run a
command than open Settings.

Shared shape:

- **Locate the app**, don't ask. macOS: `/Applications`, `~/Applications`,
  then `PATH`. Linux: `/usr/bin/platypusgit`, `/usr/local/bin/platypusgit`,
  `$APPIMAGE`, then `PATH`. Overridable with `PLATYPUSGIT_APP` — which is also
  what makes the script testable on a machine with no install.
- **Refuse to fight a package.** If a `pgit` already on `PATH` references the
  app, print where it is and exit 0 without writing. Same rule as §A, in the
  other language.
- **Prefer no sudo**: `PGIT_BIN_DIR` override, else the first writable of
  `~/.local/bin`, `~/bin`, `/usr/local/bin`; report `PATH` state and print the
  one line that fixes it.
- **Safe under `curl … | sh`**: `set -eu`, no bashisms, and **no reading from
  stdin** — stdin is the script. So no prompts, ever; every choice is a flag or
  an env var.
- `--help`, and `--dry-run` so a user can see what it would do before it does it.

The `.ps1` additionally owns the registry-kind-preserving PATH append described
in §F.

### H. Two items specified here and landed elsewhere

**The Homebrew cask** lives in `jonassaa/homebrew-platypusgit`. One line, after
the existing `app` stanza:

```ruby
binary "#{appdir}/PlatypusGit.app/Contents/MacOS/platypusgit", target: "pgit"
```

`brew` symlinks it into `#{HOMEBREW_PREFIX}/bin` — already on `PATH`, no sudo,
removed by `brew uninstall`. §A then classifies it `Package` (or `App` on Intel,
per the recorded ambiguity).

**`release.yml`'s `bump-cask` job keeps working.** It rewrites the cask with two
`sed -i -E` expressions anchored on `^  version "` and `^  sha256 "`. A
`  binary "…"` line matches neither anchor, changes neither line's shape, and is
inserted below both. **No change to `release.yml` is needed and none is made** —
the bundle keys added by §C and §E are additive config, and `bundle.targets`,
`createUpdaterArtifacts`, the updater `pubkey` and the signing config are
untouched.

**The site** (`platypusgit.com`) needs, in `site/` — owned by #145, not this
change:

- `scripts/install-pgit.sh` and `scripts/install-pgit.ps1` served from the static
  root. They must not be copied by hand: a prebuild step in `site/package.json`
  should copy them out of `scripts/` into `site/public/`, or they will drift from
  the repo copies the moment one is edited.
- On `/download`, per platform:
  `curl -fsSL https://platypusgit.com/install-pgit.sh | sh` (macOS/Linux) and
  `irm https://platypusgit.com/install-pgit.ps1 | iex` (Windows), each with the
  note that Homebrew, the `.deb` and the `.msi` already install `pgit` and the
  script is for the other routes.

## Rejected alternatives

- **A symlink in `deb.files`** — `fs::copy` follows symlinks, so it would embed a
  second copy of the binary in the package.
- **Shipping `pgit.cmd` through `bundle.resources`** instead of a WiX `File`.
  It would remove the `$(sys.SOURCEFILEDIR)` question, but `resources` is not
  per-platform, so a Windows `.cmd` would ship inside the macOS `.app` and the
  `.deb`. The fragment needs authoring for the PATH entry regardless, so
  resources buys nothing and costs a stray file on two other channels.
- **A `bin` subdirectory under `INSTALLDIR` on PATH** instead of `INSTALLDIR`
  itself — tidier (only `pgit.cmd` on PATH) but a second `Directory` element in
  the highest-risk file in the change, for no user-visible gain.
- **`setx`** for the Windows PATH — truncation at 1024 chars and machine/user
  PATH merging. §F.
- **A `winreg` / `windows-sys` dependency** for the PATH write instead of
  PowerShell. It is the technically cleaner call, but it adds a Windows-only
  crate for one registry write that the `.ps1` has to implement anyway, and the
  duplicate would be the thing that drifts. Worth revisiting if the app ever
  needs a second registry write.
- **A `postrm` that removes a self-installed shim** — the package must not
  delete files it did not ship, and after an uninstall there is no app to run.
- **Reordering the §A scan so `PATH` wins** — it answers "what does `pgit` run"
  at the cost of "did we install this", which is what the Reinstall button needs.
  `pathState` answers the first question without giving up the second.

## Verification reality

This is macOS. Three of the five channels cannot be exercised here, and the
matching honesty requirement is part of the spec, not an afterthought:

| Channel | Verifiable here | Not verifiable here |
| --- | --- | --- |
| Homebrew cask | the `bump-cask` sed anchors, by reading the live cask | the stanza itself (different repo, #144 keeps it) |
| `.dmg` / in-app (macOS) | end to end — `install-pgit.sh` against a fixture app, `shim_status`/`install_shim` unit + integration tests, `pnpm tauri build --no-sign` | — |
| `.deb` | the bundler's exec-bit chain by source reading; `dash -n` + a real run of the wrapper and the postinst | that `dpkg -i` produces an executable `/usr/bin/pgit` |
| `.msi` | XML well-formedness + `xmllint --schema wix.xsd`; no `{{`; the config parses | candle/light/ICE actually compiling it; the PATH entry; uninstall rollback |
| Windows in-app | `pwsh` parses the script; the pure PATH-append function under `pwsh` on macOS | the registry write, the `WM_SETTINGCHANGE` broadcast, `pgit.cmd` resolution |

Anything in the right column is reported as unproven, never as working.
