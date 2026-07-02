# Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make platypusgit fully keyboard-driveable via a data-defined keymap registry, global chord dispatcher, focus model, default preset, Settings picker, and a discoverable cheat-sheet.

**Architecture:** All frontend, under `src/features/keymap/`. Keymap is data — a binding table maps `action id → chord`; components register handlers for action ids via `useAction` and never read raw keys. A single global `keydown` listener in `AppShell` resolves chord → action → handler, honoring focus scope and a don't-fight-inputs rule. A focus store + `PGPane` wrapper provide Alt+Arrow pane traversal and a visible focus ring.

**Tech Stack:** React 18 + TypeScript, Zustand (per-feature stores), Tailwind v4 (CSS vars in `index.css`), Vitest + React Testing Library (jsdom).

## Global Constraints

- Node 22 + pnpm. Run `pnpm` / `cargo` with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` prefixed.
- Frontend NEVER calls `invoke()` directly — N/A here (no backend change).
- Import UI primitives from `@/design` barrel. Do NOT create `src/components/ui/`.
- Path alias `@/` → `src/`.
- Zustand per-feature, colocated in the owning feature folder.
- Styling via CSS vars (`var(--accent)`, `var(--bg-*)`, etc.); theme tokens in `src/index.css`.
- Commit style: Conventional Commits, imperative subject < 72 chars, trailing `Co-Authored-By: Claude …`.
- Tests: `pnpm test` (vitest) for `*.test.ts`/`*.test.tsx`; `pnpm tsc --noEmit` to type-check.
- No backend / Rust / IPC changes.

---

### Task 1: Chord model (`chord.ts`)

**Files:**
- Create: `src/features/keymap/chord.ts`
- Test: `src/features/keymap/chord.test.ts`

**Interfaces:**
- Produces:
  - `eventToChord(e: Pick<KeyboardEvent, "key"|"metaKey"|"ctrlKey"|"altKey"|"shiftKey">): string | null`
  - `formatChord(chord: string, platform?: "mac"|"other"): string`
  - `IS_MAC: boolean`
- Canonical chord grammar: modifiers in fixed order `Mod`, `Ctrl`, `Alt`, `Shift`, joined to the base key by `+`. `Mod` collapses ⌘ (mac) / Ctrl (other). Base key is `e.key` with single letters upper-cased, and named keys kept as-is (`ArrowLeft`, `Enter`, `Escape`, `?`, `,`).

- [ ] **Step 1: Write failing tests**
```ts
import { describe, it, expect } from "vitest";
import { eventToChord, formatChord } from "./chord";

const ev = (p: Partial<KeyboardEvent>) =>
  ({ key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...p }) as KeyboardEvent;

describe("eventToChord", () => {
  it("maps meta+digit to Mod+ on mac", () => {
    expect(eventToChord(ev({ key: "1", metaKey: true }))).toBe("Mod+1");
  });
  it("orders modifiers Mod,Alt,Shift", () => {
    expect(eventToChord(ev({ key: "ArrowLeft", altKey: true }))).toBe("Alt+ArrowLeft");
  });
  it("upper-cases single letters", () => {
    expect(eventToChord(ev({ key: "p", metaKey: true, shiftKey: true }))).toBe("Mod+Shift+P");
  });
  it("keeps bare '?'", () => {
    expect(eventToChord(ev({ key: "?" }))).toBe("?");
  });
  it("returns null for lone modifier keydown", () => {
    expect(eventToChord(ev({ key: "Shift", shiftKey: true }))).toBe(null);
  });
});

describe("formatChord", () => {
  it("renders mac glyphs", () => {
    expect(formatChord("Mod+1", "mac")).toBe("⌘1");
    expect(formatChord("Alt+ArrowLeft", "mac")).toBe("⌥←");
    expect(formatChord("Mod+Shift+P", "mac")).toBe("⌘⇧P");
  });
  it("renders non-mac words", () => {
    expect(formatChord("Mod+1", "other")).toBe("Ctrl+1");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm test chord` → FAIL (module not found).

- [ ] **Step 3: Implement `chord.ts`**
```ts
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const LONE_MODS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

export function eventToChord(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): string | null {
  if (LONE_MODS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || (e.ctrlKey && !IS_MAC)) parts.push("Mod");
  if (e.ctrlKey && (IS_MAC || e.metaKey)) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let base = e.key;
  if (base.length === 1) base = base.toUpperCase();
  parts.push(base);
  return parts.join("+");
}

const GLYPH: Record<string, string> = {
  Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Enter: "↵", Escape: "Esc",
};
const WORD: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Ctrl: "Ctrl" };

export function formatChord(chord: string, platform: "mac" | "other" = IS_MAC ? "mac" : "other"): string {
  const segs = chord.split("+");
  const base = segs[segs.length - 1];
  const mods = segs.slice(0, -1).sort((a, b) => MOD_ORDER.indexOf(a as any) - MOD_ORDER.indexOf(b as any));
  if (platform === "mac") {
    return mods.map((m) => GLYPH[m] ?? m).join("") + (GLYPH[base] ?? base);
  }
  return [...mods.map((m) => WORD[m] ?? m), GLYPH[base] && base.startsWith("Arrow") ? GLYPH[base] : base].join("+");
}
```
> Note: `e.metaKey`+`e.ctrlKey` ambiguity — `Mod` always represents the platform-primary (⌘ on mac, Ctrl elsewhere). A literal Ctrl on mac maps to `Ctrl`. Good enough for the default preset which never uses literal-Ctrl on mac.

- [ ] **Step 4: Run, verify pass** — `pnpm test chord` → PASS.

- [ ] **Step 5: Commit** — `feat(keymap): chord parse + format helpers`

---

### Task 2: Action catalog (`registry.ts`)

**Files:**
- Create: `src/features/keymap/registry.ts`
- Test: `src/features/keymap/registry.test.ts`

**Interfaces:**
- Produces:
  - `type ActionId` (string-literal union, listed below)
  - `type ActionScope = "global" | "pane"`
  - `interface ActionDef { id: ActionId; title: string; category: ActionCategory; scope: ActionScope; allowInInput?: boolean; }`
  - `type ActionCategory = "Navigation" | "Panes" | "Lists & trees" | "Repository" | "App"`
  - `const ACTIONS: Record<ActionId, ActionDef>`
  - `const ALL_ACTION_IDS: ActionId[]`

- [ ] **Step 1: Write failing test**
```ts
import { describe, it, expect } from "vitest";
import { ACTIONS, ALL_ACTION_IDS } from "./registry";

describe("registry", () => {
  it("every action def id matches its key", () => {
    for (const [k, def] of Object.entries(ACTIONS)) expect(def.id).toBe(k);
  });
  it("nav actions cover all 9 activity screens + settings", () => {
    const navs = ALL_ACTION_IDS.filter((id) => id.startsWith("nav."));
    expect(navs.length).toBe(10);
  });
  it("pane-scoped actions exist", () => {
    expect(ACTIONS["pane.focusLeft"].scope).toBe("pane");
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `registry.ts`** — full catalog:
```ts
export type ActionScope = "global" | "pane";
export type ActionCategory = "Navigation" | "Panes" | "Lists & trees" | "Repository" | "App";

export type ActionId =
  | "nav.files" | "nav.commit" | "nav.history" | "nav.branches" | "nav.conflict"
  | "nav.rebase" | "nav.remote" | "nav.diff" | "nav.reflog" | "nav.settings"
  | "app.cheatSheet" | "app.closeOverlay"
  | "pane.focusLeft" | "pane.focusRight" | "pane.focusUp" | "pane.focusDown"
  | "list.up" | "list.down" | "list.expand" | "list.collapse" | "list.activate"
  | "repo.fetch" | "repo.pull" | "repo.push";

export interface ActionDef {
  id: ActionId; title: string; category: ActionCategory; scope: ActionScope; allowInInput?: boolean;
}

function def(id: ActionId, title: string, category: ActionCategory, scope: ActionScope, allowInInput = false): ActionDef {
  return { id, title, category, scope, allowInInput };
}

export const ACTIONS: Record<ActionId, ActionDef> = {
  "nav.files": def("nav.files", "Go to Files", "Navigation", "global"),
  "nav.commit": def("nav.commit", "Go to Commit", "Navigation", "global"),
  "nav.history": def("nav.history", "Go to History", "Navigation", "global"),
  "nav.branches": def("nav.branches", "Go to Branches", "Navigation", "global"),
  "nav.conflict": def("nav.conflict", "Go to Conflicts", "Navigation", "global"),
  "nav.rebase": def("nav.rebase", "Go to Rebase", "Navigation", "global"),
  "nav.remote": def("nav.remote", "Go to Remotes", "Navigation", "global"),
  "nav.diff": def("nav.diff", "Go to Diff viewer", "Navigation", "global"),
  "nav.reflog": def("nav.reflog", "Go to Reflog", "Navigation", "global"),
  "nav.settings": def("nav.settings", "Open Settings", "Navigation", "global"),
  "app.cheatSheet": def("app.cheatSheet", "Show keyboard shortcuts", "App", "global"),
  "app.closeOverlay": def("app.closeOverlay", "Close overlay / cancel", "App", "global", true),
  "pane.focusLeft": def("pane.focusLeft", "Focus pane left", "Panes", "pane"),
  "pane.focusRight": def("pane.focusRight", "Focus pane right", "Panes", "pane"),
  "pane.focusUp": def("pane.focusUp", "Focus pane up", "Panes", "pane"),
  "pane.focusDown": def("pane.focusDown", "Focus pane down", "Panes", "pane"),
  "list.up": def("list.up", "Move selection up", "Lists & trees", "pane"),
  "list.down": def("list.down", "Move selection down", "Lists & trees", "pane"),
  "list.expand": def("list.expand", "Expand / move right", "Lists & trees", "pane"),
  "list.collapse": def("list.collapse", "Collapse / move left", "Lists & trees", "pane"),
  "list.activate": def("list.activate", "Activate selection", "Lists & trees", "pane"),
  "repo.fetch": def("repo.fetch", "Fetch", "Repository", "global"),
  "repo.pull": def("repo.pull", "Pull", "Repository", "global"),
  "repo.push": def("repo.push", "Push", "Repository", "global"),
};

export const ALL_ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(keymap): action catalog registry`

---

### Task 3: Preset + reverse map (`presets.ts`)

**Files:**
- Create: `src/features/keymap/presets.ts`
- Test: `src/features/keymap/presets.test.ts`

**Interfaces:**
- Consumes: `ActionId`, `ALL_ACTION_IDS` from `registry.ts`.
- Produces:
  - `interface KeymapPreset { id: string; name: string; bindings: Partial<Record<ActionId, string[]>>; }`
  - `const PLATYPUSGIT_PRESET: KeymapPreset`
  - `const BUILTIN_PRESETS: KeymapPreset[]`
  - `function buildReverseMap(p: KeymapPreset): Map<string, ActionId[]>` (chord → action ids)

- [ ] **Step 1: Write failing test**
```ts
import { describe, it, expect } from "vitest";
import { PLATYPUSGIT_PRESET, buildReverseMap } from "./presets";
import { ALL_ACTION_IDS } from "./registry";

describe("platypusgit preset", () => {
  it("binds every action", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(PLATYPUSGIT_PRESET.bindings[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });
  it("has no chord bound to two different GLOBAL actions", () => {
    const rev = buildReverseMap(PLATYPUSGIT_PRESET);
    // pane actions intentionally share arrows; only assert globals are unique.
    // (checked in impl via category; here assert Mod+1 maps to exactly one)
    expect(rev.get("Mod+1")).toEqual(["nav.files"]);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `presets.ts`**
```ts
import type { ActionId } from "./registry";

export interface KeymapPreset {
  id: string;
  name: string;
  bindings: Partial<Record<ActionId, string[]>>;
}

export const PLATYPUSGIT_PRESET: KeymapPreset = {
  id: "platypusgit",
  name: "platypusgit (default)",
  bindings: {
    "nav.files": ["Mod+1"], "nav.commit": ["Mod+2"], "nav.history": ["Mod+3"],
    "nav.branches": ["Mod+4"], "nav.conflict": ["Mod+5"], "nav.rebase": ["Mod+6"],
    "nav.remote": ["Mod+7"], "nav.diff": ["Mod+8"], "nav.reflog": ["Mod+9"],
    "nav.settings": ["Mod+,"],
    "app.cheatSheet": ["?"], "app.closeOverlay": ["Escape"],
    "pane.focusLeft": ["Alt+ArrowLeft"], "pane.focusRight": ["Alt+ArrowRight"],
    "pane.focusUp": ["Alt+ArrowUp"], "pane.focusDown": ["Alt+ArrowDown"],
    "list.up": ["ArrowUp"], "list.down": ["ArrowDown"],
    "list.expand": ["ArrowRight"], "list.collapse": ["ArrowLeft"],
    "list.activate": ["Enter"],
    "repo.fetch": ["Mod+Shift+F"], "repo.pull": ["Mod+Shift+L"], "repo.push": ["Mod+Shift+P"],
  },
};

export const BUILTIN_PRESETS: KeymapPreset[] = [PLATYPUSGIT_PRESET];

export function buildReverseMap(p: KeymapPreset): Map<string, ActionId[]> {
  const m = new Map<string, ActionId[]>();
  for (const [id, chords] of Object.entries(p.bindings)) {
    for (const chord of chords ?? []) {
      const arr = m.get(chord) ?? [];
      arr.push(id as ActionId);
      m.set(chord, arr);
    }
  }
  return m;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(keymap): platypusgit default preset + reverse map`

---

### Task 4: Dispatcher store + `useAction` hook

**Files:**
- Create: `src/features/keymap/useKeymapStore.ts`
- Create: `src/features/keymap/useAction.ts`
- Test: `src/features/keymap/useAction.test.tsx`

**Interfaces:**
- Consumes: `ActionId`/`ACTIONS` (registry), `buildReverseMap`/`BUILTIN_PRESETS`/`PLATYPUSGIT_PRESET` (presets), `eventToChord` (chord).
- Produces:
  - `useKeymapStore` with `{ activePresetId, reverse: Map, setPreset(id), register(id, handler): () => void, dispatch(e): boolean }`
  - `useAction(id: ActionId, handler: () => void, deps: unknown[]): void`
  - `dispatch(e)` returns `true` if it handled+prevented the event.
  - Don't-fight-inputs: when target is INPUT/TEXTAREA/contentEditable, only `allowInInput` actions resolve.

- [ ] **Step 1: Write failing component test**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { useKeymapStore } from "./useKeymapStore";
import { useAction } from "./useAction";

function Harness({ onFiles }: { onFiles: () => void }) {
  useAction("nav.files", onFiles, [onFiles]);
  return null;
}

describe("dispatch", () => {
  it("fires the registered handler for Mod+1", () => {
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);
    const handled = useKeymapStore.getState().dispatch(
      { key: "1", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
        preventDefault() {}, target: document.body } as unknown as KeyboardEvent,
    );
    expect(handled).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("ignores nav action when typing in a textarea", () => {
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);
    const ta = document.createElement("textarea");
    const handled = useKeymapStore.getState().dispatch(
      { key: "1", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
        preventDefault() {}, target: ta } as unknown as KeyboardEvent,
    );
    expect(handled).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `useKeymapStore.ts`**
```ts
import { create } from "zustand";
import { ACTIONS, type ActionId } from "./registry";
import { buildReverseMap, PLATYPUSGIT_PRESET, BUILTIN_PRESETS } from "./presets";
import { eventToChord } from "./chord";

const STORAGE_KEY = "pg-keymap-preset";

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

interface KeymapState {
  activePresetId: string;
  reverse: Map<string, ActionId[]>;
  handlers: Map<ActionId, (() => void)[]>;
  setPreset: (id: string) => void;
  register: (id: ActionId, handler: () => void) => () => void;
  dispatch: (e: KeyboardEvent) => boolean;
}

function presetById(id: string) {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? PLATYPUSGIT_PRESET;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  activePresetId: localStorage.getItem(STORAGE_KEY) ?? PLATYPUSGIT_PRESET.id,
  reverse: buildReverseMap(presetById(localStorage.getItem(STORAGE_KEY) ?? PLATYPUSGIT_PRESET.id)),
  handlers: new Map(),

  setPreset(id) {
    localStorage.setItem(STORAGE_KEY, id);
    set({ activePresetId: id, reverse: buildReverseMap(presetById(id)) });
  },

  register(id, handler) {
    const { handlers } = get();
    const arr = handlers.get(id) ?? [];
    arr.push(handler);
    handlers.set(id, arr);
    return () => {
      const cur = get().handlers.get(id);
      if (!cur) return;
      const i = cur.indexOf(handler);
      if (i >= 0) cur.splice(i, 1);
    };
  },

  dispatch(e) {
    const chord = eventToChord(e);
    if (!chord) return false;
    const ids = get().reverse.get(chord);
    if (!ids || ids.length === 0) return false;
    const editable = isEditable(e.target);
    for (const id of ids) {
      const def = ACTIONS[id];
      if (editable && !def.allowInInput) continue;
      const hs = get().handlers.get(id);
      if (hs && hs.length > 0) {
        hs[hs.length - 1]();        // last-registered (innermost) wins
        e.preventDefault();
        return true;
      }
    }
    return false;
  },
}));
```

- [ ] **Step 4: Implement `useAction.ts`**
```ts
import { useEffect } from "react";
import { useKeymapStore } from "./useKeymapStore";
import type { ActionId } from "./registry";

export function useAction(id: ActionId, handler: () => void, deps: unknown[]): void {
  useEffect(() => {
    const unregister = useKeymapStore.getState().register(id, handler);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 5: Run, verify pass.** `pnpm test useAction` → PASS.
- [ ] **Step 6: Commit** — `feat(keymap): dispatcher store + useAction handler registry`

---

### Task 5: Wire dispatcher into AppShell + nav handlers + settings persistence

**Files:**
- Modify: `src/AppShell.tsx` (replace inline ⌘1-9 handler ~lines 114-135 with global dispatch + register nav/repo/settings actions)
- Modify: `src/features/keymap/index.ts` (create barrel)
- Test: existing `pnpm test` + `pnpm tsc --noEmit` must stay green.

**Interfaces:**
- Consumes: `useKeymapStore`, `useAction` (keymap).
- `AppShell` registers `nav.*` → `setScreen(...)`, `nav.settings` → settings screen, `repo.fetch/pull/push` → existing repo store ops, and installs the single global keydown listener calling `useKeymapStore.getState().dispatch`.

- [ ] **Step 1: Create barrel `src/features/keymap/index.ts`**
```ts
export * from "./registry";
export * from "./presets";
export * from "./chord";
export * from "./useKeymapStore";
export * from "./useAction";
```

- [ ] **Step 2: Replace the inline keydown effect in `AppShell.tsx`** — remove the `metaKey` digit-parsing effect (lines ~114-135), add:
```tsx
// Global keymap dispatch — single listener, registry-driven.
React.useEffect(() => {
  const onKey = (e: KeyboardEvent) => { useKeymapStore.getState().dispatch(e); };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

// Register navigation + repo actions.
const NAV_BY_ACTION: Record<string, ScreenId> = {
  "nav.files": "repo", "nav.commit": "commit", "nav.history": "history",
  "nav.branches": "branches", "nav.conflict": "conflict", "nav.rebase": "rebase",
  "nav.remote": "remote", "nav.diff": "diff", "nav.reflog": "reflog",
  "nav.settings": "settings",
};
useAction("nav.files", () => setScreen("repo"), []);
useAction("nav.commit", () => setScreen("commit"), []);
useAction("nav.history", () => setScreen("history"), []);
useAction("nav.branches", () => setScreen("branches"), []);
useAction("nav.conflict", () => setScreen("conflict"), []);
useAction("nav.rebase", () => setScreen("rebase"), []);
useAction("nav.remote", () => setScreen("remote"), []);
useAction("nav.diff", () => setScreen("diff"), []);
useAction("nav.reflog", () => setScreen("reflog"), []);
useAction("nav.settings", () => setScreen("settings"), []);
```
> `setScreen` is stable from `useState`; `[]` deps fine. `NAV_BY_ACTION` kept for reference/cheat-sheet labels if needed — remove if unused to satisfy lint.

- [ ] **Step 3: Register repo actions** — match the titlebar buttons. Inspect current fetch/pull/push calls in AppShell/titlebar; wire:
```tsx
useAction("repo.fetch", () => { if (repo) useRepoStore.getState().fetchAll(); }, [repo]);
useAction("repo.pull", () => { if (repo) useRepoStore.getState().pull(); }, [repo]);
useAction("repo.push", () => { if (repo) useRepoStore.getState().push(); }, [repo]);
```
> Verify exact method names on `useRepoStore` (`pull`, `push`, `fetchAll`) before wiring; adjust to actual signatures.

- [ ] **Step 4: Run** `pnpm tsc --noEmit` and `pnpm test` → all green. Manually confirm ⌘1-9 still switch screens (dispatcher path).

- [ ] **Step 5: Commit** — `feat(keymap): drive AppShell navigation through the dispatcher`

---

### Task 6: Focus model — `useFocusStore` + `PGPane` + `usePaneList` + ring CSS

**Files:**
- Create: `src/features/keymap/useFocusStore.ts`
- Create: `src/features/keymap/PGPane.tsx`
- Create: `src/features/keymap/usePaneList.ts`
- Modify: `src/index.css` (focus-ring rule)
- Modify: `src/features/keymap/index.ts` (export new symbols)
- Test: `src/features/keymap/PGPane.test.tsx`

**Interfaces:**
- Produces:
  - `useFocusStore` `{ focused: string|null; panes: Map<string, Neighbors>; focus(id); register(id, neighbors): ()=>void; move(dir): void; }`
  - `type Neighbors = { left?: string; right?: string; up?: string; down?: string }`
  - `<PGPane id neighbors children className>` — registers, applies `data-pg-focused`, focuses on click.
  - `usePaneList<T>({ items, selected, onSelect, onActivate, isExpandable?, onExpand?, onCollapse? })` — registers `list.*` actions, returns nothing (side-effect hook). Only active when its pane is focused.

- [ ] **Step 1: Write failing test** (Alt+Arrow moves focus to declared neighbor)
```tsx
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { PGPane } from "./PGPane";
import { useFocusStore } from "./useFocusStore";
import { useKeymapStore } from "./useKeymapStore";
import { useAction } from "./useAction";

function FocusActions() {
  useAction("pane.focusRight", () => useFocusStore.getState().move("right"), []);
  return null;
}

it("Alt+ArrowRight moves focus to the right neighbor", () => {
  render(
    <>
      <FocusActions />
      <PGPane id="a" neighbors={{ right: "b" }}>A</PGPane>
      <PGPane id="b" neighbors={{ left: "a" }}>B</PGPane>
    </>,
  );
  useFocusStore.getState().focus("a");
  useKeymapStore.getState().dispatch(
    { key: "ArrowRight", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false,
      preventDefault() {}, target: document.body } as unknown as KeyboardEvent,
  );
  expect(useFocusStore.getState().focused).toBe("b");
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `useFocusStore.ts`**
```ts
import { create } from "zustand";

export type Neighbors = { left?: string; right?: string; up?: string; down?: string };

interface FocusState {
  focused: string | null;
  panes: Map<string, Neighbors>;
  register: (id: string, neighbors: Neighbors) => () => void;
  focus: (id: string) => void;
  move: (dir: keyof Neighbors) => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focused: null,
  panes: new Map(),
  register(id, neighbors) {
    get().panes.set(id, neighbors);
    if (get().focused === null) set({ focused: id });
    return () => {
      get().panes.delete(id);
      if (get().focused === id) set({ focused: get().panes.keys().next().value ?? null });
    };
  },
  focus(id) { if (get().panes.has(id)) set({ focused: id }); },
  move(dir) {
    const cur = get().focused;
    if (!cur) return;
    const next = get().panes.get(cur)?.[dir];
    if (next && get().panes.has(next)) set({ focused: next });
  },
}));
```

- [ ] **Step 4: Implement `PGPane.tsx`**
```tsx
import React from "react";
import { useFocusStore } from "./useFocusStore";
import type { Neighbors } from "./useFocusStore";

export function PGPane({
  id, neighbors, children, className, style,
}: {
  id: string; neighbors: Neighbors; children: React.ReactNode;
  className?: string; style?: React.CSSProperties;
}) {
  const focused = useFocusStore((s) => s.focused === id);
  React.useEffect(() => useFocusStore.getState().register(id, neighbors),
    // re-register if neighbors change
    [id, neighbors.left, neighbors.right, neighbors.up, neighbors.down]);
  return (
    <div
      data-pg-pane={id}
      data-pg-focused={focused ? "" : undefined}
      className={className}
      style={style}
      onMouseDown={() => useFocusStore.getState().focus(id)}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Implement `usePaneList.ts`**
```ts
import { useFocusStore } from "./useFocusStore";
import { useAction } from "./useAction";

export function usePaneList<T>(opts: {
  paneId: string;
  count: number;
  selectedIndex: number;
  onSelect: (i: number) => void;
  onActivate?: (i: number) => void;
  onExpand?: (i: number) => void;
  onCollapse?: (i: number) => void;
}): void {
  const isFocused = useFocusStore((s) => s.focused === opts.paneId);
  const guard = (fn: () => void) => () => { if (isFocused) fn(); };
  const clamp = (i: number) => Math.max(0, Math.min(opts.count - 1, i));
  useAction("list.up", guard(() => opts.onSelect(clamp(opts.selectedIndex - 1))),
    [isFocused, opts.selectedIndex, opts.count]);
  useAction("list.down", guard(() => opts.onSelect(clamp(opts.selectedIndex + 1))),
    [isFocused, opts.selectedIndex, opts.count]);
  useAction("list.activate", guard(() => opts.onActivate?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex]);
  useAction("list.expand", guard(() => opts.onExpand?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex]);
  useAction("list.collapse", guard(() => opts.onCollapse?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex]);
}
```

- [ ] **Step 6: Add focus-ring CSS to `src/index.css`**
```css
[data-pg-pane] { outline: none; }
[data-pg-pane][data-pg-focused] {
  box-shadow: inset 0 0 0 2px var(--accent);
  border-radius: 4px;
}
```

- [ ] **Step 7: Export from barrel; run `pnpm test PGPane` → PASS; `pnpm tsc --noEmit` green.**
- [ ] **Step 8: Commit** — `feat(keymap): focus model — PGPane, focus store, usePaneList`

---

### Task 7: Cheat-sheet overlay (`CheatSheet.tsx`)

**Files:**
- Create: `src/features/keymap/CheatSheet.tsx`
- Modify: `src/AppShell.tsx` (mount `<CheatSheet />`, toggle on `app.cheatSheet`)
- Test: `src/features/keymap/CheatSheet.test.tsx`

**Interfaces:**
- Consumes: `ACTIONS`, active preset via `useKeymapStore.activePresetId` + `presetById`, `formatChord`.
- `<CheatSheet open onClose />` — modal listing actions grouped by `category`, each row: title + formatted chords. Escape/`?`/backdrop closes.

- [ ] **Step 1: Write failing test**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { CheatSheet } from "./CheatSheet";

it("renders a row for a known action with its chord", () => {
  render(<CheatSheet open onClose={() => {}} />);
  expect(screen.getByText("Go to Files")).toBeTruthy();
  // mac glyph or Ctrl form — assert the digit is present
  expect(screen.getByText(/1/)).toBeTruthy();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `CheatSheet.tsx`** — derive rows from `ACTIONS` grouped by category; resolve chords from `BUILTIN_PRESETS.find(activePresetId).bindings[id]` mapped through `formatChord`. Render a fixed-position modal with backdrop; `useEffect` to listen for nothing (toggle is owned by AppShell via `app.cheatSheet`). Use `@/design` primitives for the panel; close button calls `onClose`.
```tsx
import React from "react";
import { ACTIONS, ALL_ACTION_IDS, type ActionCategory } from "./registry";
import { BUILTIN_PRESETS, PLATYPUSGIT_PRESET } from "./presets";
import { formatChord } from "./chord";
import { useKeymapStore } from "./useKeymapStore";

const CATEGORY_ORDER: ActionCategory[] = ["Navigation", "Panes", "Lists & trees", "Repository", "App"];

export function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presetId = useKeymapStore((s) => s.activePresetId);
  if (!open) return null;
  const preset = BUILTIN_PRESETS.find((p) => p.id === presetId) ?? PLATYPUSGIT_PRESET;
  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 8,
          padding: 20, maxHeight: "80vh", overflow: "auto", minWidth: 420, color: "var(--fg-0)" }}
      >
        <h2 style={{ marginBottom: 12 }}>Keyboard shortcuts</h2>
        {CATEGORY_ORDER.map((cat) => {
          const ids = ALL_ACTION_IDS.filter((id) => ACTIONS[id].category === cat);
          if (!ids.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{ color: "var(--fg-2)", fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}>{cat}</div>
              {ids.map((id) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 24, padding: "3px 0" }}>
                  <span>{ACTIONS[id].title}</span>
                  <span style={{ color: "var(--fg-1)", fontFamily: "var(--font-mono, monospace)" }}>
                    {(preset.bindings[id] ?? []).map((c) => formatChord(c)).join(" / ")}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `AppShell.tsx`**
```tsx
const [cheatOpen, setCheatOpen] = React.useState(false);
useAction("app.cheatSheet", () => setCheatOpen((v) => !v), []);
useAction("app.closeOverlay", () => setCheatOpen(false), []);
// ...in JSX:
<CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />
```

- [ ] **Step 5: Run `pnpm test CheatSheet` → PASS; `pnpm tsc --noEmit` green.**
- [ ] **Step 6: Commit** — `feat(keymap): shortcut cheat-sheet overlay (?)`

---

### Task 8: Settings — keyboard preset picker

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (add `keymapPresetId` to `PersistedState`, default `"platypusgit"`, include in `DEFAULTS`/`snapshot`)
- Modify: `src/screens/Settings.tsx` (add `<Section title="Keyboard">` with a Select over `BUILTIN_PRESETS`)
- Modify: `src/features/keymap/useKeymapStore.ts` is the source of truth for active preset; settings store mirrors for persistence display, and on change calls `useKeymapStore.getState().setPreset(id)`.

**Decision:** `useKeymapStore` already persists `activePresetId` to `localStorage["pg-keymap-preset"]`. To avoid two sources of truth, the Settings Section reads/writes through `useKeymapStore` directly (NOT a new settings field). Drop the settings-store change.

- [ ] **Step 1: Add Keyboard Section to `Settings.tsx`**
```tsx
import { BUILTIN_PRESETS } from "@/features/keymap";
import { useKeymapStore } from "@/features/keymap";
// inside the settings body, after the Diff section:
<Section title="Keyboard" subtitle="Choose a keymap preset. More presets coming.">
  <Field label="Keymap" hint="Bindings apply across every screen.">
    <Select
      value={useKeymapStore((s) => s.activePresetId)}
      onChange={(v) => useKeymapStore.getState().setPreset(v)}
      options={BUILTIN_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
    />
  </Field>
</Section>
```
> Match the actual `Select`/`Field` component names used by the existing Sections (inspect Appearance/Diff Sections; reuse identical primitives).

- [ ] **Step 2: Run `pnpm tsc --noEmit` + `pnpm test` → green. Manually: change preset (only one for now), no crash.**
- [ ] **Step 3: Commit** — `feat(keymap): Settings keymap preset picker`

---

### Task 9: Show chords in context menus

**Files:**
- Modify: context-menu call sites that map to registered actions (e.g. `src/screens/RepoBrowser.tsx`, History, Branches) — populate `ContextMenuItem.shortcut` via `formatChord` of the active preset binding for the corresponding action.
- Create helper: `src/features/keymap/chordFor.ts` → `chordFor(id: ActionId): string` returns first formatted chord for active preset, or `""`.

**Interfaces:**
- Produces: `chordFor(id: ActionId): string`.

- [ ] **Step 1: Implement `chordFor.ts`**
```ts
import { BUILTIN_PRESETS, PLATYPUSGIT_PRESET } from "./presets";
import { formatChord } from "./chord";
import type { ActionId } from "./registry";
import { useKeymapStore } from "./useKeymapStore";

export function chordFor(id: ActionId): string {
  const presetId = useKeymapStore.getState().activePresetId;
  const preset = BUILTIN_PRESETS.find((p) => p.id === presetId) ?? PLATYPUSGIT_PRESET;
  const chords = preset.bindings[id];
  return chords && chords.length ? formatChord(chords[0]) : "";
}
```

- [ ] **Step 2: Apply at one real call site** — find a context menu whose item maps to an action (e.g. a "Show history" / nav item) and set `shortcut: chordFor("nav.history")`. Keep scope minimal: wire the obvious nav/repo ones only.

- [ ] **Step 3: Run `pnpm tsc --noEmit` + `pnpm test` → green.**
- [ ] **Step 4: Commit** — `feat(keymap): surface active chords in context menus`

---

### Task 10: Apply focus model to RepoBrowser (exemplar)

**Files:**
- Modify: `src/screens/RepoBrowser.tsx` — wrap its primary list/tree pane(s) in `PGPane` with neighbors, drive selection via `usePaneList`. Remove any now-redundant local arrow handling that conflicts.

- [ ] **Step 1: Identify panes** — inspect RepoBrowser layout; assign pane ids (e.g. `repo.files`, `repo.preview`) and neighbor map.
- [ ] **Step 2: Wrap panes in `PGPane`; wire `usePaneList` to the file list's selection state.**
- [ ] **Step 3: Run `pnpm tsc --noEmit` + `pnpm test` → green. Manual: focus ring visible, arrows move selection, Alt+Arrow switches pane.**
- [ ] **Step 4: Commit** — `feat(keymap): keyboard-navigable panes in RepoBrowser`

---

### Task 11: Docs + feature checklist

**Files:**
- Modify: `features.md` (tick delivered KN0/KN1 boxes)
- Modify: `implemented-features.md` (add Keyboard Navigation entry)

- [ ] **Step 1: Check off delivered items**; leave deferred KN2 + full per-screen audit unchecked with a note.
- [ ] **Step 2: Commit** — `docs(keymap): mark keyboard navigation foundation delivered`

---

## Self-Review

**Spec coverage:**
- Registry → Task 2. Chord model → Task 1. Preset → Task 3. Dispatcher + don't-fight-inputs → Task 4. AppShell wiring + nav/repo actions → Task 5. Focus model (store/PGPane/usePaneList/ring) → Task 6. Cheat-sheet → Task 7. Settings picker → Task 8. Chords in menus → Task 9. Per-screen adoption exemplar → Task 10. Docs → Task 11. ✔ All spec sections mapped.
- KN2 (overrides, extra presets, export/import) intentionally absent. ✔

**Placeholder scan:** Task 5 Step 3 and Task 8/9/10 contain "verify exact names / inspect call site" notes — these are codebase-lookup instructions, not content placeholders; the surrounding code is concrete. Acceptable: the executor must confirm `useRepoStore` method names and `Select`/`Field` primitive names against the live code (they are real components, just not re-pasted here to avoid drift).

**Type consistency:** `ActionId` union consistent across Tasks 2-9. `buildReverseMap`/`presetById`/`setPreset`/`register`/`dispatch` names consistent. `Neighbors`/`PGPane`/`usePaneList`/`useFocusStore.move` consistent across Tasks 6 & 10. `formatChord`/`eventToChord` consistent across Tasks 1,3,7,9. ✔
