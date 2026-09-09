# Theme creation revamp + a working file path — spec

Issue: #435 (`[bug] ubuntu 26.04 > export theme does not work`), plus the
theme-creation UX revamp the fix was scoped with.

## The bug, precisely

Every "export" in the app writes its file the same way:

```ts
const blob = new Blob([json], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `${slug}.pgtheme.json`;
a.click();
```

Three call sites do this — `useSettingsStore.downloadTheme`,
`useSettingsStore.downloadSettings`, and the editor's inline "Export draft"
handler. **WebKitGTK ignores the `download` attribute on a blob URL**, so on
Linux the click is a no-op with no error, no console message and no file: the
exact report in #435. It is not a Linux-only latent bug either — a webview is
not a browser, and nothing about `<a download>` is contracted to work in one.

The mirror image is import, which goes through a hidden `<input type="file">`
in two places (`pages/appearance.tsx`, `pages/backup.tsx`). That one happens to
work today because WebKitGTK ships a default file chooser, but it is the same
category of mistake: the app reaches for a browser affordance where it has a
native one, and it cannot report the path it read, so the UI has to say vague
things like "your downloads folder".

There is no backend file-write command at all, and only `dialog:allow-open` is
granted in `capabilities/default.json`. So the fix is a real native save path,
not a patch to the anchor click.

## Scope

Approved with the issue:

1. **One native file path**, used by every export and import. Covers the
   settings backup card too — it is broken by the identical mechanism, and
   fixing the mechanism once while leaving a second caller on the broken one is
   how this regresses.
2. **A theme gallery** replacing the name-only dropdown on the Appearance page.
3. **A rebuilt editor**: design-system modal, an inline live preview of the real
   UI, a guided base+accent start, and advisory contrast warnings.

Out of scope: new built-in themes, syntax-token editing (`SYNTAX_TOKENS` and
`SEMANTIC_TOKENS` stay mode-calibrated constants), theme sharing over the
network (there is none — "no telemetry, no account" is a build gate).

## 1. One file path

### Backend — `src-tauri/src/commands/userfile.rs`

Two commands, thin over `std::fs`, both in `spawn_blocking` because fs is sync:

```rust
#[tauri::command]
pub async fn write_user_file(path: String, contents: String) -> AppResult<()>;

#[tauri::command]
pub async fn read_user_file(path: String) -> AppResult<String>;
```

- Errors are `AppError::Io` and `AppError::InvalidPath`. **No new `AppError`
  variant**, so the Rust enum and its TS union stay as they are and
  `test/appErrors.test.ts` needs nothing.
- `read_user_file` is capped at `MAX_USER_FILE_BYTES` (4 MiB) and refuses
  anything larger with `InvalidPath`. A settings bundle with every custom theme
  is a few tens of KB; the cap is there because the path comes from a file
  picker and a mis-picked disk image should not be slurped into the webview.
- `write_user_file` writes the whole string in one `fs::write`, creating or
  truncating. It does **not** create parent directories: the path came from a
  native save dialog, so its directory exists, and inventing directories from a
  webview string is a bigger privilege than this feature needs.
- The module doc says plainly what the trust model is: these take an absolute
  path the **user** chose in a native dialog. Nothing in the frontend may
  synthesise a path for them.

Registered in `commands/mod.rs` and in `invoke_handler![…]` in `lib.rs`, and
listed in `docs/dev/architecture.md`'s backend tree — `test/docs.test.ts` fails
the build otherwise.

### Frontend — `src/lib/userFile.ts`

The single place that picks a file and moves its bytes:

```ts
export type FileFilter = { name: string; extensions: string[] };

/** Native save dialog, then write. `null` when the user cancelled. */
export async function saveTextFile(opts: {
  defaultName: string;
  contents: string;
  filters?: FileFilter[];
}): Promise<string | null>;

/** Native open dialog, then read. `null` when the user cancelled. */
export async function openTextFile(opts?: {
  filters?: FileFilter[];
}): Promise<{ path: string; contents: string } | null>;
```

- `save()` / `open()` come from `@tauri-apps/plugin-dialog`; the read and write
  go through the typed `invoke` wrappers in `lib/tauri.ts` (never `invoke`
  directly).
- **Returning the path is the point.** Every surface can then say *Saved to
  `/home/you/my-theme.pgtheme.json`* instead of guessing at a downloads folder.
- Cancel is `null`, never a throw — a dismissed dialog is "no answer", matching
  how `pgConfirm`/`pgPrompt` read a dismissal.

`dialog:allow-save` joins `capabilities/default.json`. `dialog:allow-open` is
already there.

### Callers

| Surface | Was | Becomes |
|---|---|---|
| Appearance → Export | `downloadTheme(id)` (blob) | `exportThemeToFile(id)` → path |
| Editor → Export | inline blob handler | same helper, on the unsaved draft |
| Editor → Import | *(did not exist)* | loads a file into the draft |
| Appearance → Import | `<input type="file">` | `openTextFile` → `importThemeJson` |
| Backup → Export settings | `downloadSettings()` (blob) | `exportSettingsToFile()` → path |
| Backup → Import settings | `<input type="file">` | `openTextFile` → `importSettings` |

`downloadTheme` and `downloadSettings` are **removed** from the store, not kept
as aliases: a working export and a broken one under two names is worse than
either. The store keeps the pure `exportTheme` / `exportSettings` serialisers —
they are what the tests assert on, and keeping the side effect out of them is
the same split `features/report/` already makes between `report.ts` and
`fileReport.ts`. The file-writing wrappers live beside them in
`features/settings/themeFiles.ts`, which is the only module that imports
`lib/userFile.ts` for settings work.

### The guard

`test/fileSave.test.ts` fails the build when a shipped file under `src/`
contains `URL.createObjectURL`, an `a.download =` assignment, or an
`<input type="file">`. That is the house pattern for a rule that cost a release
(`Command::new` outside `proc.rs`, native `<select>`, `window.confirm`), and it
is what stops the next export from being written as an anchor click.

## 2. One theme renderer

`applyTheme` today walks 19 `setProperty` calls on `document.documentElement`,
then writes `SEMANTIC_TOKENS[mode]`, `SELECTION_TOKENS[mode]` and
`SYNTAX_TOKENS[mode]`. Nothing can paint a theme *other than the active one*,
which is why neither a gallery card nor a preview pane is possible today.

Extract the map:

```ts
/** Every CSS var a theme sets, as a plain map. */
export function themeVars(theme: ThemeDef): Record<string, string>;
```

`applyTheme(theme)` becomes "write `themeVars(theme)` to `:root`" and keeps its
signature and behaviour. `ThemePreview` writes the same map as inline style on
its own root element, so a theme renders identically whether it is the active
one or a card on a page painted in something else. **One source of truth for
what a theme means** — a new colour slot or a new derived token lands in
`themeVars` and both surfaces get it.

`src/features/settings/theme/ThemePreview.tsx` renders a miniature of the real
app from an explicit `{ colors, mode }`: titlebar with window controls, sidebar,
two history rows with a graph edge and a HEAD mark, a diff hunk with an added
and a removed line, a primary button, and a status line. It reads **no**
`:root` var — everything it paints comes from the map — so it is honest inside
the editor and inside a card, and a component test can assert its computed
colours without mounting the app.

Sizes: `size="card"` (gallery, ~180×120) and `size="pane"` (editor, fills its
column). Same tree, scaled type and spacing — not two components that drift.

## 3. The gallery

`ThemeGallery.tsx`, on the Appearance page, replacing the `PGSelect` whose
options were `★ ${name}`.

- A card per theme: a `ThemePreview size="card"`, the name, a `Built-in` or
  `Custom` badge, and a ring plus a check when it is the one in use.
- Click activates (`setActiveThemeId`, or `setPairedThemeId` for a half).
- **Follow-system mode shows two galleries**, Light and Dark, each filtered to
  themes of that mode — the same rule `pairOptions` enforces today, since a
  pairing whose halves are the same mode never switches. Fixed mode shows one
  gallery of all nine built-ins plus every custom theme.
- Actions live on the card, not in a detached button row: **Edit**,
  **Duplicate**, **Export…**, **Delete** on a custom card; **Duplicate to
  customise** and **Export…** on a built-in one. `duplicateTheme` already
  exists in the store and has never had a UI.
- Keyboard: the gallery is a `radiogroup`, cards are `radio`s, arrow keys move,
  Enter/Space activates. A visual picker that is mouse-only is not a usability
  win.

**Settings search keeps working.** The `meta.cards[].rows` ids stay
`appearance.theme`, `appearance.light`, `appearance.dark` with the gallery as a
`stacked` control, so `settings.index.test.tsx` and search-by-keyword are
unaffected. The `keywords` gain `gallery preview swatch duplicate`.

## 4. The editor

`ThemeEditorDialog` keeps its name and its `{ mode, sourceTheme, onClose }`
props. What changes:

- **It is a `PGModal`.** The hand-rolled `position: fixed` backdrop goes, and
  so does its local `window.addEventListener("keydown")` Escape handler —
  `modal.tsx` documents that a component-local capture-phase Escape listener is
  precisely the anti-pattern issue #47 was fixed to avoid. Escape routes through
  `app.closeOverlay`, like every other dialog.
- **Two columns.** Controls left, `ThemePreview size="pane"` right, contrast
  warnings under the preview. Live-apply to `:root` stays — seeing the real
  window change is worth keeping, and Cancel still restores the theme captured
  on open — but it is no longer the *only* feedback, which is what made a
  dimmed, 90%-obscured window the judge of a palette.
- **Guided start.** A "Start from" base picker and an accent swatch:

  ```ts
  export function deriveTheme(base: ThemeDef, accent: string): ThemeColors;
  ```

  Takes the base palette, sets `accent`, and recomputes `accentInk` to whichever
  of the base's lightest/darkest ink reads against it. Deliberately no
  hue-shifting of the greys: a two-click theme that is *legible* beats a
  generated palette nobody can predict. Everything else stays editable.
- **All colours** stays — the same 18 fields in the same five groups, collapsed
  behind a disclosure so the guided path is the default and full control is one
  click away.
- **Contrast warnings.** `features/settings/theme/contrast.ts` implements WCAG
  relative luminance and ratio, and the editor checks the pairs that decide
  whether the app is readable: `fg0`/`bg0`, `fg1`/`bg1`, `fg2`/`bg1`,
  `accentInk`/`accent`. Below 4.5:1 warns, below 3:1 warns harder. **Advisory,
  never blocking** — a deliberately low-contrast theme is the user's call, and
  Save is never disabled by it. Today you can build an unreadable theme with no
  feedback at all, which is the single worst thing about the current editor.
- **Mode flip re-bases.** Switching Dark→Light with dark colours in the draft
  offers, via `pgConfirm`, to re-base from the matching built-in. Declining
  keeps the colours. Keeping dark greys under light semantic calibration is
  unreadable (#61 B4), and silently doing that is how "Light" appears broken.
- **Export…/Import…** in the footer, on the native path, both operating on the
  unsaved draft. Import into the editor is new: it is how you round-trip a theme
  through an external editor, which is what #435's reporter was trying to do.

`ColorEditor.tsx` keeps its `{ colors, onPatch }` shape and its `normalizeHex`
export. `ColorField` gains the contrast badge for the pairs it participates in.

## Data flow

```
gallery card ──click──> setActiveThemeId / setPairedThemeId ──> applyResolved
                                                                    │
                                                              themeVars ──> :root
editor draft ──state──> applyTheme(draft)  ──────────────────> themeVars ──> :root
             └────────> ThemePreview ──────────────────────── themeVars ──> subtree
             └────────> contrastReport(colors) ─────────────> warnings

Export:  exportTheme(id) ─json──> saveTextFile ──save()──> write_user_file ──> disk
Import:  openTextFile ──open()──> read_user_file ──json──> importThemeJson ──> store
```

## Error handling

- A cancelled dialog is `null` and produces no message. Silence on cancel,
  never a "failed" flash.
- A failed write flashes the `AppError`'s prose through `appErrorMessage` — the
  existing path. Export lives in Settings, not on a repository surface, so
  `PGErrorBanner`'s repo-scoped placement does not apply; `pgFlash` is what the
  neighbouring settings actions already use.
- A malformed import keeps today's behaviour: `validateTheme` throws, the
  message lands in the row's hint, nothing is changed. `normalizeCustomThemes`
  stays lenient in the direction it already chose — a missing colour is filled
  from the default theme rather than costing the user the file.
- A write that succeeds reports **the path**, which is the whole reason the
  helper returns it.

## Testing

- **Unit** — `contrast.ts` (known WCAG pairs, including the black/white
  extremes), `deriveTheme` (accent lands, ink flips at the crossover, other
  slots untouched), `themeVars` (every `ThemeColors` key appears; the map
  matches what `applyTheme` writes to `:root`, which is what stops the two
  drifting).
- **Component** — gallery (renders every theme, click activates, follow-system
  shows two mode-filtered galleries, arrow-key navigation, per-card actions);
  editor (preview repaints on a colour change, contrast warning appears and
  never disables Save, mode flip prompts, export calls `saveTextFile` with the
  slug and the draft's JSON, import loads a file into the draft); `ThemePreview`
  (computed colours come from the passed theme, not `:root`).
  Clipboard-adjacent assertions use `fireEvent`, not `userEvent` — `setup()`
  replaces `navigator.clipboard` and detaches spies.
- **Guard** — `test/fileSave.test.ts` as above; `test/docs.test.ts` and
  `settings.index.test.tsx` must stay green, which pins the docs entry and the
  settings row ids.
- **Rust** — `userfile.rs` integration tests: round-trip a file, refuse an
  oversized read, report a missing path as `Io`, refuse a directory.
- **E2E** — one addition to `settings.e2e.ts`: open Appearance, duplicate a
  built-in into a custom theme, change a colour, save, and assert the gallery
  shows it as active. The file dialogs are native and out of WebDriver's reach,
  so **e2e does not cover export/import** — that is what the Rust tests and the
  component tests on `saveTextFile` are for. Saying so here is the point: a
  green suite is not evidence that #435 is fixed.

## Docs

- `docs/dev/frontend.md` — the gallery and editor, `themeVars` as the one
  renderer, and why the preview reads no `:root` var.
- `docs/dev/backend.md` — `commands/userfile.rs`, the cap, and the "path came
  from a native dialog" trust model.
- `docs/dev/architecture.md` — `userfile.rs` in the backend tree, the new
  frontend modules in the frontend tree.
- `CLAUDE.md` — one bullet: **one file save/open path (`lib/userFile.ts`);
  never `<a download>`, and a guard test enforces it.** It earns a line for the
  same reason the `proc.rs` and `PGSelect` rules did — it is guard-tested, and a
  webview is not a browser is not something the next session will guess.

## What this deliberately does not do

- No new built-in themes. Nine is enough to fork from.
- No hue-shifting palette generator. `deriveTheme` swaps the accent and fixes
  the ink; anything cleverer produces palettes the user cannot predict or
  correct.
- No blocking on contrast. Warn, never refuse.
- No `tauri-plugin-fs`. Two thin commands match how every other backend
  capability in this app is exposed, and the plugin's scope config would be a
  second, parallel answer to "may the webview touch this path".
