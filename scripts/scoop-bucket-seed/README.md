# scoop-platypusgit

A [Scoop](https://scoop.sh) bucket for **[platypusgit](https://github.com/jonassaa/platypusgit)** —
a dev-first git desktop app. Free and open source, no account, no telemetry.

```powershell
scoop bucket add platypusgit https://github.com/jonassaa/scoop-platypusgit
scoop install platypusgit
```

Updates then come from Scoop:

```powershell
scoop update platypusgit
```

The app knows it was installed this way and switches its own updater off, so the
two can never disagree about which copy you are running.

## What you get

- `platypusgit` — the app, plus a Start Menu shortcut.
- `pgit` — the CLI, shimmed onto your PATH. `pgit .` opens a repository the way
  `code .` opens a folder.

It needs the **WebView2 runtime**, which Windows 11 ships and Windows 10 gets
with Edge — so it is almost certainly already there. Unlike the `.msi`, a
portable package cannot install it for you: if no window appears, install the
Evergreen WebView2 Runtime from Microsoft.

Only `x64` is published today.

## This repository is generated

`bucket/platypusgit.json` is written by the **platypusgit release workflow** —
its `bump-scoop` job renders it with
[`scripts/scoop-manifest.sh`](https://github.com/jonassaa/platypusgit/blob/main/scripts/scoop-manifest.sh)
and pushes it here on every non-prerelease release. Nothing else lives here: no
workflows, no code.

So **do not hand-edit the manifest** — the next release overwrites it. Changes
belong in the generator, in the app repository, where they are reviewed.

Issues and pull requests: please open them on
[jonassaa/platypusgit](https://github.com/jonassaa/platypusgit/issues).
