# Native Window Titlebar — Design

**Date:** 2026-04-24
**Status:** Approved
**Related:** `2026-04-24-centralized-branch-ui-design.md` (owns branch chip + picker)

## Problem

Today `platypusgit` renders a 38px in-app bar (`PGTitlebar`) *below* the OS window frame. The OS frame is still the default Tauri-decorated chrome (macOS traffic lights + window title stripe). Result: two stacked horizontal bars at the top of the window, wasting ~28px of vertical real estate and looking unpolished.

The goal is to merge repo identity, branch chip, and fetch/pull/push actions into the OS window chrome itself, so the native titlebar *is* the app titlebar.

## Goals

1. Single visual titlebar, hosting: repo name, branch chip (with dirty badge), Refresh / Fetch / Pull / Push, Close repo, Settings gear.
2. Native traffic lights on macOS (no custom re-render).
3. Functional min / maximize / close controls on Windows and Linux.
4. Window remains draggable from empty titlebar regions.
5. No change to existing activity bar, status bar, or screens.

## Non-goals

- Re-implementing macOS traffic lights in HTML (fake mac controls rejected in brainstorm).
- Adding new titlebar surface items (terminal / search / notifications icons were considered and dropped).
- Custom caption button theming on Windows beyond a minimal Win11-style trio.
- Tabbed / multi-repo windows.

## Approach — per-platform native chrome

### macOS

- `tauri.conf.json` window: `"titleBarStyle": "Overlay"`, `"hiddenTitle": true`.
- Native traffic lights remain, rendered by the OS over our web content, top-left.
- Titlebar root gets a left padding of 80px on macOS to clear the traffic-light cluster.
- Window title string suppressed (`hiddenTitle`). We still set `title: "PlatypusGit"` so the dock / task switcher shows the app name.

### Windows & Linux

- `tauri.conf.json` window: `"decorations": false` (applies cross-platform, but macOS overrides with `titleBarStyle`).
  - Tauri v2 precedence: when `titleBarStyle` is set on macOS, `decorations` is ignored there. On Windows/Linux `decorations: false` hides the native frame entirely.
- Render our own min / maximize / close trio on the far right of the titlebar, after the Settings gear. Order: minimize, maximize/restore, close. Matches Windows convention; Linux users get Windows-style controls (acceptable — app is developer-focused and already fully custom visually).
- Controls call `getCurrentWindow().minimize() / toggleMaximize() / close()` from `@tauri-apps/api/window`.
- No per-platform asymmetry in button placement (always right). GNOME's left-hand close button is a theme preference; we don't honor it in our custom frame.

### Drag region

- Root titlebar `<div>` carries `data-tauri-drag-region`.
- Flex spacer `<div>` between branch chip and action buttons also carries `data-tauri-drag-region`.
- All interactive elements (chips, buttons, icon buttons, window controls) sit on top and naturally stop drag because they are real buttons / have click handlers. We do **not** need to sprinkle `onMouseDown={e => e.stopPropagation()}` — Tauri's drag region ignores elements with their own `onclick` per its docs. Verified empirically in Tauri v2.

## Layout

Left → right, single row, 38px tall:

```
[ macOS shim 80px | repo-icon repo-name / branch-chip ] [ flex spacer — drag ] [ Refresh | Fetch | Pull ↓n | Push ↑n | divider | Close repo | Settings gear ] [ Win/Linux: min | max | close ]
```

- macOS shim: empty 80px div, only rendered when platform === `macos`.
- Win/Linux control group: only rendered when platform !== `macos`. Each control is a 46×38 rectangle (matches Win11 caption button size), no border, hover bg = `var(--bg-2)`, close hover = red (`#e81123`).

## Architecture

### Configuration

- `src-tauri/tauri.conf.json`:
  ```jsonc
  "windows": [{
    "title": "PlatypusGit",
    "width": 1200, "height": 800,
    "minWidth": 800, "minHeight": 600,
    "resizable": true,
    "fullscreen": false,
    "decorations": false,
    "titleBarStyle": "Overlay",
    "hiddenTitle": true
  }]
  ```
- `src-tauri/Cargo.toml`: add `tauri-plugin-os = "2"`.
- `src-tauri/src/lib.rs`: register `.plugin(tauri_plugin_os::init())`.
- `src-tauri/capabilities/default.json`: add `os:default`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`.
- `package.json`: add `@tauri-apps/plugin-os`.

### Frontend

- New helper `src/lib/platform.ts`:
  - `getPlatform(): "macos" | "windows" | "linux"` — cached result from `@tauri-apps/plugin-os` `platform()`.
  - `usePlatform()` hook that returns the cached string after first mount (never flips after initial read).
- `src/design/chrome.tsx` — `PGTitlebar` rework:
  - Accept existing props plus an internal platform read via `usePlatform()`.
  - Root div gets `data-tauri-drag-region`.
  - Remove existing `PGTrafficLights` usage from runtime path (component can stay as dead code or be deleted; delete to keep surface clean).
  - Conditionally render `<MacShim />`, `<WindowControls />` sub-components based on platform.
- New `src/design/window-controls.tsx`:
  - `PGWindowControls` — three-button group (min, max, close) using `getCurrentWindow()` from `@tauri-apps/api/window`. Max button swaps icon between "maximize" and "restore" based on `window.onResized` state.
  - Exported via `design/index.ts`.
- `src/AppShell.tsx`:
  - `AppTitlebar` drops `showTrafficLights={false}` (no longer a toggle — `PGTitlebar` internal).
  - No structural change to the rest of the shell.

## Error & edge cases

- **Fullscreen on macOS:** Overlay-style titlebar auto-adjusts; traffic lights fade. Our 80px shim remains harmless (just empty space). Acceptable.
- **Maximized on Windows:** We listen to `onResized` and swap the middle button's icon between maximize and restore. No rounded corners issue — borderless window handles itself.
- **Drag region swallowing clicks:** Noted above. Any regression in click targets is a bug to fix by ensuring the element is rendered *after* the drag-region element in DOM order (buttons are).
- **Platform detection race:** `usePlatform()` returns `undefined` on first render until the OS plugin resolves. `PGTitlebar` treats `undefined` the same as macOS (most common dev target) to avoid a flash of the wrong controls. Re-renders once platform resolves.
- **Window title plugin missing on Linux distros without libappindicator:** n/a — we don't use tray / indicator here.

## Testing

- **Component (`PGTitlebar`):** Mock `usePlatform()` returning each of `macos` / `windows` / `linux`. Assert: macOS branch renders shim and no window controls; Windows/Linux branch renders `PGWindowControls` and no shim.
- **Component (`PGWindowControls`):** Mock `getCurrentWindow()` from `@tauri-apps/api/window`. Assert each button invokes the correct method.
- **Manual:** Run on macOS, confirm:
  - Traffic lights visible, clickable (close/min/max all work).
  - No double titlebar.
  - Drag window by empty titlebar area.
  - Double-click empty titlebar area toggles maximize (OS behavior).
  - Branch chip, buttons clickable, popover opens at correct position.
- **CI:** Type-check + unit tests only. Windows/Linux manual verification deferred until those environments exist.

## Risks

1. **Tauri Overlay titlebar on older macOS:** Requires macOS 11+. Config already sets `minimumSystemVersion: "10.15"`. Bump to `"11.0"` as part of this work.
2. **Custom caption buttons on Windows feel "off":** Mitigation — match Win11 sizing and hover colors exactly. If user reports poor feel, re-evaluate using Tauri's built-in Windows caption button plugin later.
3. **Linux window manager quirks:** Some tiling WMs ignore `decorations: false` or force their own borders. Out of scope to solve — we ship what Tauri gives us.

## Open questions

None — all pinned during brainstorm.
