# Microsoft Store distribution — research findings (2026-08-27)

**Status: research, not an approved spec.** No decision has been taken and no
code has changed. This is the primary-source answer to "how do we get
platypusgit on the Windows Store", plus the list of things in *this* repo that
each route breaks. A real spec + plan would follow the usual
`docs/superpowers/` shape once a route is chosen.

Every claim below cites the document that owns it. Where I could not verify
something from a primary source, it is under **Unverified** and says so.

---

## TL;DR

There are **two** accepted routes, and they are not variations of one thing —
they differ in cost, in who signs the binary, in who ships updates, and in how
much of this codebase has to change.

| | **Route A — MSIX package** | **Route B — MSI/EXE link** |
| --- | --- | --- |
| What the Store hosts | your app, on Microsoft's CDN | *a link* to an installer you host |
| Code signing | **free — Microsoft re-signs the package** | **you must buy a cert** that chains to a Microsoft Trusted Root CA |
| Cost | €0 | $150–300/yr (OV), or free via SignPath Foundation for OSS |
| Updates | Store delivers them | you keep your own updater |
| Tauri support | **none** — no MSIX bundler; must use Microsoft's `winapp` CLI or a third-party tool | native (`msi` target, already shipping) |
| SmartScreen | gone | gone for Store installs; unchanged for direct downloads |
| Repo work | substantial (new channel, ~6 behaviours change) | small config + a cert + a listing |

**Recommendation: Route A (MSIX via Microsoft's `winapp` CLI).** It is free,
it deletes the SmartScreen problem, and — the non-obvious part — MSIX's
`AppExecutionAlias` is a *better* mechanism for the `pgit` CLI than the machine
PATH write the `.msi` does today. The cost is that it is a genuinely new
channel with six things that must be tested on real Windows 11 (listed under
[Must test](#must-test-before-committing-to-route-a)), one of which —
`GIT_ASKPASS` — is the thing `docs/dev/distribution.md` already calls "the
whole risk of the feature".

Route B is the smaller diff but it costs money every year, keeps us on the hook
for updates, and does nothing for the SmartScreen warning on the download page.

**If the actual goal is "Windows users can install with one command", the
cheapest answer is neither: it is [winget](#the-cheaper-adjacent-option-winget).**

---

## Registration: now free, but only through one door

- The **$19 individual registration fee is waived** in the new onboarding flow,
  live in "nearly 200 markets". Verification is a government ID + selfie.
  ([Free developer registration for individual developers](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer))
- **Trap:** the free flow only exists at <https://storedeveloper.microsoft.com>.
  That page is explicit — *"This is the only supported entry point for the new
  flow. Other paths (e.g. direct via Partner Center, Xbox, or Visual Studio)
  will show the legacy flow."* Starting at Partner Center gets you the old paid
  flow. (same page, FAQ)
- A zero-fee **company** onboarding flow is documented separately
  ([Revamped company onboarding](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-company-developer)),
  but an individual account is the correct type here: policy **10.14** reserves
  company accounts for "organizations, businesses, and any person acting in
  relation to their trade or profession".
- Store policies in force: **version 7.19**, published 2025-09-10, effective
  2025-10-14. ([Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies))

---

## Route A — MSIX

### Tauri will not build it for you

Tauri's own Store page says plainly: *"Currently Tauri only generates EXE and
MSI installers, so you must create a Microsoft Store application that only
links to the unpacked application."*
([Tauri › Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/))
The feature request for `.msix`/`.appx` generation,
[tauri#8548](https://github.com/tauri-apps/tauri/issues/8548), is **closed as
not planned**.

So the MSIX has to be produced by something else. Two options:

1. **Microsoft's `winapp` CLI — and it has an official Tauri guide.** Dated
   2026-08-19, with a working sample at
   [microsoft/WinAppCli/samples/tauri-app](https://github.com/microsoft/WinAppCli/tree/main/samples/tauri-app).
   ([Using winapp CLI with Tauri](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri))
   This is a first-party, currently-maintained path and the one I would use.
2. **`@choochmeque/tauri-windows-bundle`** — third party, reads
   `tauri.conf.json`, emits per-arch `.msix` plus a `.msixbundle`, handles
   signing, and claims multiarch + Store-ready output.
   ([repo](https://github.com/Choochmeque/tauri-windows-bundle))
   Useful as a fallback or for the arm64 bundle, but it is one person's tool.

### The `winapp` flow, concretely

Prerequisites are **Windows 11**, Node, Rust, and
`winget install microsoft.winappcli`. Then:

```powershell
winapp init          # writes Package.appxmanifest + Assets/ ; choose "Do not setup SDKs"
                     # (Tauri uses the `windows` crate via Cargo, so there is
                     #  nothing for winapp restore/update to track — and no
                     #  winapp.yaml is created)
winapp cert generate --if-exists skip     # local dev cert only
winapp pack .\dist --cert .\devcert.pfx   # dist = just the release exe + manifest
winapp cert install .\devcert.pfx         # once, as admin, to test locally
Add-AppxPackage .\platypusgit_x.y.z.0_x64.msix
```

`winapp run .\dist` registers a loose-layout package and launches the app *with
package identity* — that is the debug loop, and it needs no certificate at all.
Remember `winapp unregister` afterwards, or the real MSIX install reports
"already installed".

Three notes straight from that guide that decide the economics:

> - "Once you are ready for distribution, you can sign your MSIX with a code
>   signing certificate from a Certificate Authority so your users don't have to
>   install a self-signed certificate."
> - **"The Microsoft Store will sign the MSIX for you, no need to sign before
>   submission."**
> - "You might need to create multiple MSIX packages, one for each architecture
>   you support (x64, Arm64)."

The free-signing claim is corroborated independently: *"If you publish your app
as an MSIX package through the Microsoft Store, code signing is free and handled
for you automatically — Microsoft re-signs the package after certification and
you don't need to purchase or manage a certificate."*
([Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options))
The MSI/EXE requirements page lists the same benefit as "Free Microsoft code
signing and CDN hosting."
([App package requirements for MSI/EXE](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements))

### What MSIX changes about this app

This is the part that matters, and it is where the effort actually is.

#### 1. The self-updater must be switched off — physically, it cannot work

MSIX packages are read-only after install: *"After deployment, package files are
marked read-only, and are heavily locked down by the operating system (OS).
Windows prevents apps from launching if those files are tampered with"*, and the
operations table says **"Write inside the package | Not allowed. The package is
read-only."**
([Understanding how packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes))
Tauri's updater replaces the installed binary. It cannot.

`src-tauri/src/update.rs::capability` currently reads:

```rust
"windows" => UpdateCapability::SelfUpdate,
```

— unconditionally. A Store build would offer an update that fails. **The
precedent for the fix already exists in this file**: `NotifyApt` was added for
exactly this situation on Linux, and the apt case is detected from a file on
disk (`APT_SOURCES_PATH`). The MSIX equivalent is package identity itself —
`Package::Current()` succeeds only inside a package, and the `winapp` guide
shows that exact call. So the shape is a new `NotifyStore` arm gated on package
identity, not on a compile-time feature.

#### 2. `pgit` gets *better*, not worse — but the detection code doesn't know it

Today the `.msi` puts `INSTALLDIR` on the machine PATH via
`src-tauri/wix/pgit-cli.wxs`. **An MSIX has no installer, so no install-time
code runs at all** — nothing to hook.

The MSIX-native answer is `AppExecutionAlias`, and it is a straight upgrade:

```xml
<uap3:Extension Category="windows.appExecutionAlias"
                Executable="platypusgit.exe"
                EntryPoint="Windows.FullTrustApplication">
  <uap3:AppExecutionAlias>
    <desktop:ExecutionAlias Alias="pgit.exe" />
  </uap3:AppExecutionAlias>
</uap3:Extension>
```

Namespaces `.../uap/windows10/3` and `.../desktop/windows10`.
`EntryPoint="Windows.FullTrustApplication"` is what makes it valid for a
full-trust desktop app.
([Integrate your desktop app with Windows using packaging extensions](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-extensions))
Constraints from that page: the alias **must end in `.exe`**, there is **one
alias per application in the package**, last registration wins if two packages
claim the same name, and **the user can disable it** in Settings → App execution
aliases.

This fits the existing architecture unusually well: the alias invokes
`platypusgit.exe` directly with the user's arguments, which is precisely what
the two symlink shim shapes already do, and `cli.rs::parse_args` already handles.
No `pgit.cmd`, no PATH write, no `setx` truncation trap, no PowerShell
`REG_EXPAND_SZ` dance — all of that becomes dead weight on this channel.

What *does* need work: `CliShimSource` is `app` / `package` / `foreign` / `none`,
and `shim_status`'s three probes are a symlink to `current_exe()`, a symlink
named after the binary, and a wrapper script mentioning it. An app-execution
alias is none of those, so a Store install would report `none` and offer to
install a shim the user does not need. That needs a fifth source (or a
package-identity branch that short-circuits the whole scan), and
`plan_install` must refuse to write one — the same way it already refuses to
touch a `package` shim.

#### 3. AppData may be redirected — which moves the log and `localStorage`

For *virtualized* apps on Windows 10 1903+, **newly created** files and folders
under `Local`, `Local\Microsoft`, `Roaming`, `Roaming\Microsoft` and
`Roaming\Microsoft\Windows\Start Menu\Programs` are "redirected to a per-user,
per-package private location", merged at runtime to look like the real
`AppData`. Writes under `HKCU` are likewise "copied on write to a per-user,
per-app private location". (behind-the-scenes doc, tables)

Two consequences:

- The documented Windows runtime-state paths (app log, WebView2 `localStorage`)
  would be somewhere else for a Store install. Any support instruction that
  names a path needs a Store branch.
- If we ever *did* try a runtime PATH write from `cli.rs`, the HKCU write could
  land in the private hive and **silently not affect the real user PATH**. This
  is the trap that makes AppExecutionAlias the answer rather than an option.

Whether virtualization applies at all depends on the manifest. Valid
combinations include `uap10:RuntimeBehavior="packagedClassicApp"` (Desktop
Bridge) and `uap10:RuntimeBehavior="win32App"` with
`uap10:TrustLevel="mediumIL"`; `win32App` + `appContainer` is explicitly
unsupported.
([Application element](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-application))
The behind-the-scenes doc marks its virtualization sections "applies only to
virtualized apps" and frames virtualization as the goal of *appContainer* apps
— but it never states outright which of `packagedClassicApp` / `win32App` at
`mediumIL` is virtualized. **That ambiguity is unresolved from primary sources
and is on the must-test list.**

#### 4. WebView2 cannot be bootstrapped by a package that runs no installer

`bundle.windows.webviewInstallMode` accepts `skip`, `downloadBootstrapper`
(default), `embedBootstrapper` (+~1.8 MB), `offlineInstaller` (+~127 MB).
([Tauri config reference](https://v2.tauri.app/reference/config/))
An MSIX runs no bootstrapper, so this is `skip` plus a dependency on the
Evergreen runtime being present, or shipping a fixed runtime inside the package.

#### 5. Architectures

The Store expects x64 **and** arm64 (`winapp` guide, tip 3). This repo ships
x64 only. arm64 Windows is a second build target, not a packaging flag.

#### 6. Icons — already done

`src-tauri/icons/` already contains the full Windows-Store set
(`Square30x30Logo` … `Square310x310Logo`, `StoreLogo`), generated from
`app-icon.svg` by `tauri icon`. No asset work needed. `winapp init` also
generates an `Assets` folder — do not let it clobber ours.

---

## Route B — the MSI/EXE link

One policy governs this entire route: **10.2.9**. Quoted in full because every
bullet is load-bearing:

> Non-gaming products may submit an HTTPS-enabled download URL (direct link) to
> the product's installer binaries. Products submitted in this manner are
> subject to the following requirements:
>
> - The installer binary may only be an .msi or .exe.
> - The binary and all of its Portable Executable (PE) files must be digitally
>   signed with a code signing certificate that chains up to a certificate
>   issued by a Certificate Authority (CA) that is part of the Microsoft Trusted
>   Root Program.
> - You must submit a versioned download URL in Partner Center. The binary
>   associated with that URL must not change after submission.
> - Whenever you have an updated binary to distribute, you must provide an
>   updated versioned download URL in Partner Center associated with the updated
>   binary. You are responsible for maintaining and updating the download URL.
> - Initiating the install must not display an installation user interface
>   (i.e., silent install is required), however a User Account Control (UAC)
>   dialog is allowed.
> - The installer is a standalone installer and is not a downloader stub/web
>   installer that downloads bits when run.
> - Your product may only be made available to PC devices.

Plus, from the same requirements page: *"Package version numbering for Win32 is
not supported through the Store"* — versioning stays entirely ours.

### What this costs

The signing bullet is the whole cost of Route B. **Microsoft does not re-sign
MSI/EXE submissions** — *"the Store does not re-sign those files, so you must
Authenticode-sign your MSI/EXE installer yourself"*, and self-signed
certificates are not accepted. Options, from the
[code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
comparison table:

| Option | Cost | Store eligible |
| --- | --- | --- |
| Store MSIX (Microsoft re-signs) | Free | ✅ |
| Store MSI/EXE (publisher signs) | cost of the cert | ✅ |
| Azure Artifact Signing (ex-Trusted Signing) | ~$9.99/mo | **❌ per that table** |
| OV cert (DigiCert, Sectigo, …) | $150–300/yr | ❌ |
| EV cert | $400+/yr | ❌ |
| Self-signed | Free | ❌ |

Two things worth knowing beyond the table:

- **EV certificates no longer bypass SmartScreen.** *"That behavior was removed
  in 2024."* Paying the EV premium for SmartScreen is "no longer justified".
- **SignPath Foundation offers free code signing for qualifying open-source
  projects**, OV-level, through a managed pipeline. platypusgit is public and
  open source, so this is the lead worth chasing first — it would fix the
  SmartScreen warning on *direct* downloads too, which no Store route does.

The table's "❌" for Azure Artifact Signing is worth a sanity check with Partner
Center before ruling it out: AAS certificates do chain to a Microsoft root, so
the exclusion may be a policy choice rather than a technical one. Reported as
the doc states it.

### Two config changes this repo needs for Route B

1. **`webviewInstallMode` today violates 10.2.9.** `tauri.conf.json` does not
   set it, so it defaults to `downloadBootstrapper` — which downloads bits at
   install time, exactly what "not a downloader stub/web installer" forbids.
   Tauri's Store page prescribes a separate config file:

   ```json
   { "bundle": { "windows": { "webviewInstallMode": { "type": "offlineInstaller" } } } }
   ```

   built as `tauri build --no-bundle` then
   `tauri bundle --config src-tauri/tauri.microsoftstore.conf.json`. Cost: ~127 MB
   on the installer, for the Store artifact only.

2. **Silent install.** MSI satisfies it via `msiexec /quiet`; NSIS via `/S`
   (uppercase). The `pgit` PATH write is a declarative WiX `Environment`
   component, not a custom action, so it survives a silent install — but verify.

The versioned-URL rule is a good fit for how `release.yml` already works: a
per-tag GitHub release asset URL is versioned and immutable. **Do not** submit
the updater's `…/releases/latest/download/…` URL — `latest` is by definition not
versioned.

Also relevant, already flagged in `docs/dev/distribution.md`: pin
`bundle.windows.wix.upgradeCode` before there are real Windows users, or a
future `productName` change breaks in-place upgrades.

---

## Live finding, independent of either route: the publisher name is "github"

Tauri: *"The application's publisher. Defaults to the second element in the
identifier string."* ([config reference](https://v2.tauri.app/reference/config/))

`tauri.conf.json` sets `"identifier": "io.github.jonassaa.platypusgit"` and does
**not** set `bundle.publisher`. Second element → **`github`**. That is the
publisher/Manufacturer on the `.msi` shipping today.

Two problems:

- Policy **10.1.1**: "Your product must not claim to be from a company,
  government body, or other entity if you do not have permission to make that
  representation."
- It is simply wrong in Add/Remove Programs.

Fix: set `bundle.publisher` explicitly — to a person or entity name, e.g.
`"Jonas Aasberg"`. Note Tauri's Store page constraint while choosing: *"Your
application publisher name cannot match the application product name"*, so
`"platypusgit"` is not available.

(Side note: `CLAUDE.md` still says the bundle identifier is
`com.platypusgit.app`. The config says `io.github.jonassaa.platypusgit`. One of
them is stale.)

---

## Listing prerequisites that are repo work, not dashboard work

Required Partner Center fields, per the
[MSIX submission checklist](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission):
Markets, Audience, Discoverability, Schedule, Base price, **Category**, **every
age-rating question**, **at least one package**, **Description**, **at least one
screenshot** (four or more recommended), **Store logos**. Name reservation comes
first.

Three that need something built or written:

1. **A privacy policy URL.** The submission page marks it "Required if your app
   collects/transmits personal information", but policy **10.5.1** is stronger:
   *"Product types that inherently have access to Personal Information must
   always have privacy policies. These include, but are not limited to, Desktop
   Bridge and Win32 products."* The marketing site has no privacy page
   (`site/src/pages/`: changelog, download, features, index, support). Writing
   one is cheap and it *reinforces* the "no telemetry, no account" promise
   rather than diluting it — the comparison table already scores a competitor on
   having "no telemetry, so no privacy policy", so there is a tone to match.

2. **Disclose the `git` dependency at the top of the description.** Policy
   **10.2.4**: a product "may depend on non-integrated software … to deliver its
   primary functionality **if you disclose the dependency at the beginning of
   the description** in metadata". platypusgit shells out to real git and the
   `.deb` already declares `Depends: git`. The first line of the Store
   description has to say so.

3. **Age rating** via the IARC questionnaire (policy **11.11**) — all questions
   required.

Product name: policy **10.1.1** requires a unique title with no marketing or
descriptive text. "platypusgit" qualifies.

---

## Must test before committing to Route A

Ordered by risk. None of these can be answered from documentation.

1. **`GIT_ASKPASS`.** The app points git at its own bare executable, which under
   MSIX lives in `C:\Program Files\WindowsApps\<pfn>\` — a location the docs
   describe as "heavily locked down by the OS". If git cannot exec it, every
   authenticated operation fails with nothing traceable, which
   `docs/dev/distribution.md` already names as "the whole risk of the feature".
   Test `git credential fill` under a real MSIX install, not just a launch.
2. **Is the package virtualized?** Determines whether the log and
   `localStorage` move, and whether any HKCU write is real. Resolve by
   inspecting where a Store-shaped install actually writes, under both
   `packagedClassicApp` and `win32App` manifests.
3. **`AppExecutionAlias` from non-Windows shells.** `pgit` from cmd and
   PowerShell should be fine. Git Bash / MSYS is the doubt — this project cares
   about that shell (the detach logic reasons about MSYS pipes explicitly).
4. **Spawning `git.exe`** from inside a full-trust package, and whether child
   processes inherit package identity in a way that changes anything for
   `proc.rs`.
5. **WebView2** presence with `webviewInstallMode: skip` on a clean Windows 11
   and a clean Windows 10.
6. **Whether the Store accepts a `win32App`-behaviour MSIX** at all, if that is
   the manifest chosen to dodge virtualization.

---

## The cheaper adjacent option: winget

If the goal behind "get it on the Windows Store" is *"a Windows user can install
platypusgit with one command"* — the Windows counterpart of the apt repo and the
Homebrew cask this project already automated — then **winget is a fraction of
the work and costs nothing**: a YAML manifest PR to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), no
certificate demanded, no Partner Center account, no age rating, no listing
assets.
([Submit packages to Windows Package Manager](https://learn.microsoft.com/en-us/windows/package-manager/package/))

It gives `winget install platypusgit`, and `winget upgrade` becomes a
package-manager update path — which maps onto the `NotifyApt`-style capability
work that Route A needs anyway. What it does *not* give: Store presence,
discoverability, or a fix for SmartScreen on direct downloads.

It is also not either/or. The honest ranking by value-per-unit-effort is
**winget → MSIX in the Store → MSI/EXE in the Store**, and issue #187 ("One-line
install + package-manager updates on Linux (and a CLI install on Windows)") is
already the natural home for the first one.

---

## Automation, later

Both routes can be driven from CI via the
[Microsoft Store submission API](https://learn.microsoft.com/en-us/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services),
so an `msstore-publish` job could sit alongside `bump-cask` and `apt-publish`
with the same prerelease gate. Do not build that until one submission has been
done by hand — the certification failure modes are the thing you are automating
around, and you cannot see them yet.

`winapp pack` requires Windows 11, so the MSIX job belongs on
`windows-latest`, not on the Linux runner.

---

## Sources

Primary, all fetched 2026-08-27:

- [Tauri › Distribute › Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/)
- [Tauri › Configuration reference](https://v2.tauri.app/reference/config/)
- [tauri#8548 — add the ability to generate .msix or .appx](https://github.com/tauri-apps/tauri/issues/8548) (closed as not planned)
- [Using winapp CLI with Tauri](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri) · [sample](https://github.com/microsoft/WinAppCli/tree/main/samples/tauri-app)
- [Microsoft Store Policies v7.19](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) — 10.1.1, 10.2.4, 10.2.9, 10.5.1, 10.14, 11.11
- [App package requirements for MSI/EXE app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [Create an app submission for your MSIX app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission)
- [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Free developer registration for individual developers](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer) · [company flow](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-company-developer)
- [Understanding how packaged desktop apps run on Windows](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [Application element — RuntimeBehavior / TrustLevel](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-application)
- [uap5:AppExecutionAlias schema](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap5-appexecutionalias) · [desktop packaging extensions](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-extensions)
- [Submit packages to Windows Package Manager](https://learn.microsoft.com/en-us/windows/package-manager/package/)
- [Microsoft Store submission API](https://learn.microsoft.com/en-us/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services)

Third party, flagged as such: [Choochmeque/tauri-windows-bundle](https://github.com/Choochmeque/tauri-windows-bundle).

### Unverified

- Where Windows places an app-execution alias on PATH. Search results quote
  `%LOCALAPPDATA%\Microsoft\WindowsApps`, consistent with observed Windows
  behaviour, but I did not find that path stated on a Microsoft page I fetched.
- Whether `packagedClassicApp` at `mediumIL` is virtualized (see above).
- Certification turnaround. A third-party blog reports ~48 h for a first
  submission; Microsoft publishes no SLA on the pages I read. The policy page's
  "2.37 days average processing time" is for *appeals*, not certification, and
  should not be quoted as review time.
- Whether Azure Artifact Signing is genuinely Store-ineligible or the
  comparison table is simplifying.
