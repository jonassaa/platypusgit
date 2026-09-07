# Reporting a bug from inside the app

Status: approved, ready for an implementation plan.
Date: 2026-09-07.

## The problem

The app writes a good log and, since #274, can even tell you where it is. What it
cannot do is help you *report* anything. Filing a bug today means:

1. Notice something broke.
2. Know that Settings → Backup & diagnostics exists, and go there.
3. Press *Copy last 500 lines*.
4. Know the project lives on GitHub, find the repository, find *New issue*.
5. Fill in the Environment section by hand — OS, version, git version — from
   facts the app already printed into the log you just copied.

Steps 2 and 4 are the ones that lose reports. A user who hits a render throw
sees the error boundary's *"This is a bug in platypusgit"* — a screen that names
the problem correctly and then offers nothing but *Reload*. The evidence is one
click away and the issue tracker is unmentioned.

The log itself is the other half of the problem. It is the only artifact that
makes a report diagnosable — #146 was diagnosed *and mis-diagnosed* from one —
and it is exactly the thing a reporter is least likely to attach unprompted.

## What we are building

A **Report an issue** dialog that assembles the report for you, shows you every
byte of it, puts it on your clipboard and opens a prefilled GitHub issue.

Reachable from four places. Two of them are where you already are when
something breaks:

- the titlebar (a `bug` icon, always there),
- the error banner (`PGErrorBanner`) — "report this", seeded with the error,
- the error boundary, after a render throw,
- Settings → Backup & diagnostics, beside the log rows it belongs with.

Three decisions were made up front and are not open in the plan:

1. **The log travels by clipboard, not in the URL.** See *Why the clipboard*.
2. **Bug reports only.** Feature requests get no diagnostics and no log, so they
   share nothing with this flow but a hostname. `feature_request.md` stays a
   thing you open in a browser.
3. **No command-palette entry.** Four entry points is already the ceiling; the
   titlebar button covers "reachable from anywhere".

## Why the clipboard

A GitHub `issues/new?body=…` URL is the obvious place to put the report, and it
does not fit. GitHub answers a long enough query string with **HTTP 414**, and
the practical ceiling is around 8 KB of URL. `read_log_tail` returns up to 500
lines capped at `TAIL_CAP_BYTES` — orders of magnitude past that. A design that
puts the log in the URL works in testing, where the log is short, and fails on
exactly the machine that has been running long enough to have a bug worth
reporting.

So the split is by size:

- **In the URL** (small, bounded): the title, the `bug` label, the body skeleton,
  and the Environment section prefilled with version / OS / arch / git version.
- **On the clipboard** (unbounded): the full report, including the log tail.

The body carries a paste marker under *Additional context* so the last step is
obvious:

```
<!-- Paste the diagnostics report from your clipboard here (Cmd/Ctrl+V) -->
```

The dialog copies *before* it opens the browser, so by the time GitHub has
loaded, the clipboard already holds what the marker asks for.

## Privacy

This feature makes **no network request**. It writes text to the clipboard and
hands a URL to `openUrl`, which is the user's own browser. Nothing is uploaded,
nothing is phoned home, and the "no telemetry, no account" promise is untouched
— `test/privacy.test.ts` and `src-tauri/tests/no_telemetry.rs` both still hold.

The report is nonetheless the most revealing text this app has ever assembled in
one place: a log tail carries repository paths, branch names, remote URLs and
hook output. Two rules follow, and they are the reason the dialog exists at all
rather than a one-click "report" button:

- **Nothing leaves without being shown first.** The dialog renders the exact
  string that will be copied, scrollable, in full. Not a summary of it.
- **Each part is opt-out.** Environment and log tail are independent checkboxes.
  Unchecking the log gives a report with no paths in it.

`github.com` is already on `test/privacy.test.ts`'s `ALLOWED_HOSTS` for the
clone dialog's placeholder. Its stated reason gains the issue URL: that prose is
the review checkpoint the list exists to force, so it gets updated even though
the assertion would pass regardless.

## Architecture

A new feature directory, `src/features/report/`, with the logic separated from
the surface so that the one entry point that *cannot* use the surface still gets
the logic.

```
src/features/report/
├── report.ts               PURE — assembles the text and the URL
├── fileReport.ts           the side effects: gather → copy → open
├── ReportIssueDialog.tsx   the PGModal
└── useReportStore.ts       open/close, plus the seed
```

`report.ts` is pure and `fileReport.ts` owns every side effect, because the
error boundary needs the second without being able to mount the third.

### `report.ts` — pure

No React, no IPC, no clipboard. Every branch of it is reachable from a unit test
with no jsdom and no mocks.

```ts
export interface ReportParts {
  version: string;
  environment: string;
  logPath: string;
  logTail: string | null;
  includeEnvironment: boolean;
  includeLog: boolean;
}

/** The pasteable block. */
export function buildReport(parts: ReportParts): string;

/** The prefilled `issues/new` URL. */
export function issueUrl(opts: {
  summary: string;
  version: string;
  environment: string;
}): string;
```

`buildReport` produces, in order: the `platypusgit <version>` line, the
`host os=… arch=… git=…` line, the log path, then the log tail under a
`── log (last 500 lines) ──` rule. Sections the caller excluded are absent
entirely rather than present-and-empty.

**This becomes the single report format.** `features/settings/pages/backup.tsx`
already assembles a header by hand for its *Copy last 500 lines* button; that
call site moves onto `buildReport`, so the two surfaces cannot drift. This is
the same "one composition surface" rule the commit message box follows.

`issueUrl` derives the title from the summary's first line, prefixed `[bug] ` to
match `bug_report.md`'s front matter. It passes `title`, `labels=bug` and `body`
and **deliberately not `template=`**: given both, `template` and `body` contend
for the same field, and which one wins is GitHub's business rather than
something this app should depend on. The body is written here instead, mirroring
the template's headings.

It also enforces a **URL budget**. `MAX_URL_LEN` (6000, comfortably under the
8 KB ceiling) bounds the finished URL; if the user's summary pushes past it, the
summary is truncated with an ellipsis and the skeleton survives. A user pasting
a wall of text into the summary box must not produce a 414.

### `useReportStore.ts`

A three-field Zustand store — `open: boolean`, `seed: string`, plus `openReport(seed?)`
and `closeReport()`. App-level rather than per-repo, so it stays out of
`RepoSlice`/`emptySlice`: those exist for state that must be dropped on a tab
switch, and "is the report dialog open" is not about a repository at all. The
summary text the user types is the dialog's own component state, which survives
a tab switch for the same reason — the dialog is mounted by `AppShell`, above
the per-repo screens.

### `ReportIssueDialog.tsx`

A `PGModal`. Mounted **once**, in `AppShell`, beside `PGDialogHost` — Settings
is a screen inside `AppShell`, so one mount serves three of the four entry
points. Escape is wired through `app.closeOverlay` in the keymap, never a local
capture-phase listener (issue #47's rule).

On open it calls `diagnosticsReport()`, and `readLogTail()` only while the log
checkbox is checked. Layout:

```
┌ Report an issue ──────────────────────────┐
│ What went wrong?                          │
│ ┌───────────────────────────────────────┐ │
│ │ Clicking Fetch hangs forever…         │ │
│ └───────────────────────────────────────┘ │
│ ☑ Include environment   ☑ Include log tail│
│ This will be copied to your clipboard:    │
│ ┌───────────────────────────────────────┐ │
│ │ platypusgit 0.8.0                     │ │
│ │ host os=macos arch=aarch64 git=2.49.0 │ │
│ │ ── log (last 500 lines) ──            │ │
│ │ 2026-09-07 11:02 INFO  open_repo …    │ │
│ └───────────────────────────────────────┘ │
│      [Copy report only]  [Copy & open GH] │
└───────────────────────────────────────────┘
```

The preview is the report, `pre-wrap`, in the mono font, scrolling in its own
box. `[Copy report only]` exists for someone who would rather file the issue by
hand, or paste it into a chat — and it is the honest fallback if the browser
never opens.

Failures use `pgFlash` with `appErrorMessage`, matching the diagnostics buttons
this dialog sits beside. A log that cannot be read is not fatal: the dialog
reports it and still assembles the rest, because an environment-only report is
worth more than no report.

### Entry points

| Where | What it looks like | Seed |
|---|---|---|
| `AppTitlebar` (`AppShell.tsx`) | `PGButton` `icon="bug"`, in `rightSlot` next to `UpdateChip` | none |
| `PGErrorBanner` | a `report` action beside `dismiss` | `errorBannerText(error)` |
| `PGErrorBoundary` | a `Report this bug` button beside `Reload`, via a new optional `onReport` prop wired in `main.tsx` | `error.message` |
| Settings → Diagnostics | a `diagnostics.report` row | none |

**`PGErrorBanner` gets an optional `onReport` prop**, passed at both call sites
(`AppShell` and `screens/Reflog.tsx`). A prop rather than the banner importing
`useReportStore` directly: `src/design/` is the design system and does not reach
into `features/`. The prop being optional keeps the banner usable by a future
surface with no report flow, exactly as `compact` is.

### The error boundary cannot use the dialog

`PGDialogHost` is mounted inside `AppShell` (`AppShell.tsx:479`), and `AppShell`
is inside `PGErrorBoundary` (`main.tsx`). After a render throw, React has
unmounted the whole tree below the boundary: there is no dialog host, no
`ReportIssueDialog`, and no subscriber to `useReportStore`. Calling
`openReport()` from the boundary would set a flag nothing reads and appear to do
nothing at all.

So the boundary does the terminal action itself, with no React tree involved
beyond its own fallback. It must not, however, *import* the machinery: nothing
in `src/design/` imports `@/lib/tauri` today, and the boundary is not the place
to start — a design-system component that performs IPC is a design system that
cannot be tested without a bridge.

The boundary already solves this problem once. It takes an optional
`onReload?: () => void` so its owner can override the reload; it gains an
optional `onReport?: (error: Error) => void` on exactly the same terms, and
renders the report button only when given one. `main.tsx` — which already
imports from `features/` — wires it to `fileBugReport(err.message)`.

`fileReport.ts` therefore holds two exported functions, and the dialog and the
boundary share the second:

```ts
/** Read the version, the environment line and (optionally) the log tail. */
export async function gatherReport(includeLog: boolean): Promise<ReportSources>;

/** Copy the report, then open the issue. In that order — see Why the clipboard. */
export async function copyAndOpenIssue(
  parts: ReportParts & { summary: string },
): Promise<void>;

/** gatherReport + copyAndOpenIssue, for a caller with no UI to offer. */
export async function fileBugReport(summary: string): Promise<void>;
```

This is a real regression risk, not a theoretical one, so it gets its own test
that mounts the boundary with **no** `PGDialogHost` present.

### The icon

`Bug` joins `src/design/icons.tsx` as `"bug"`, in both the lucide import and the
`IconName` union. That file is the only one allowed to import `lucide-react`, and
`test/iconSet.test.ts` fails the build both for a stray import and for a call-site
literal the union does not declare.

## Not in scope

- **No attachment upload.** GitHub's API can attach files; doing so needs a token
  and turns a rendered URL into a network call. The clipboard is the whole point.
- **No Store gating.** `UpdateCapability` gates *update* surfaces, because Store
  policy 10.2.5 makes notifying about an update the violation. A link to an issue
  tracker is not an update surface and ships in every channel.
- **No crash auto-reporting.** Nothing is ever sent without the user pressing a
  button; that is the privacy story, and an automatic report would be telemetry
  under a friendlier name.
- **No feature-request path.** Decision 2 above.

## Testing

| Layer | File | What it pins |
|---|---|---|
| unit (pure) | `src/features/report/report.test.ts` | body mirrors the template's headings; the paste marker is present; `title` is `[bug] ` + first line; percent-encoding; each `include*` flag adds/removes exactly its section; the URL budget truncates the summary and never exceeds `MAX_URL_LEN` |
| component | `src/features/report/ReportIssueDialog.test.tsx` | preview tracks the checkboxes; `[Copy report only]` writes the clipboard and does not open a URL; `[Copy & open GitHub]` does both, in that order; a failing `readLogTail` still yields an environment report |
| component | `src/design/error-boundary.test.tsx` (extended) | the report button copies and opens **with no `PGDialogHost` mounted** |
| component | `src/screens/settings.index.test.tsx` (existing gate) | the new Diagnostics row is in `meta.cards[].rows` |
| guard | `test/iconSet.test.ts` (existing gate) | `"bug"` is declared, and lucide is still imported from one file |
| guard | `test/docs.test.ts` (existing gate) | `features/report` is named in `docs/dev/architecture.md` |
| e2e | `e2e/specs/settings.e2e.ts` (extended) | the dialog opens from Settings and renders a preview. It does **not** click through to GitHub — a spec must never open a browser. |

## Documentation

- `docs/dev/architecture.md` — `features/report/` in the frontend tree. Required:
  `test/docs.test.ts` fails the build without it.
- `docs/dev/frontend.md` — the dialog, the four entry points, the clipboard split
  and the reason the error boundary bypasses the store.
- `CLAUDE.md` — one convention line, because the boundary trap is the kind of
  thing that gets "simplified" back into a bug: the report logic stays pure and
  the boundary calls it directly.
