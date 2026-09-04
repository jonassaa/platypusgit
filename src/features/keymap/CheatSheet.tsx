// CheatSheet — shortcut reference overlay (toggled by `?`). Rows are derived
// entirely from the action catalog + active preset; no hardcoded key lists, so
// it always reflects the live keymap. Open/close state lives in the overlay
// store so the `app.cheatSheet` / `app.closeOverlay` default runners drive it.

import { ACTIONS, ALL_ACTION_IDS, type ActionCategory } from "./actions";
import { presetById } from "./presets";
import { formatChord } from "./chord";
import { useKeymapStore } from "./useKeymapStore";
import { useOverlayStore } from "./useOverlayStore";

const CATEGORY_ORDER: ActionCategory[] = [
  "Navigation",
  "Repository",
  "Palette",
  "Panes",
  "Lists & trees",
  "Diff",
  "App",
];

/** A whole family of chords (Alt+1…Alt+9 for `tab.select`) reads as a range, not
 *  as nine slash-separated entries that swamp the row it belongs to. */
function formatBindings(chords: string[]): string {
  if (chords.length > 3) {
    return `${formatChord(chords[0])}–${formatChord(chords[chords.length - 1])}`;
  }
  return chords.map((c) => formatChord(c)).join(" / ");
}

/** One reference row. Shared so a custom action's row cannot drift from a
 *  built-in one — they are the same thing to the person reading the sheet. */
function Row({ title, keys }: { title: string; keys: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 24,
        padding: "3px 0",
      }}
    >
      <span>{title}</span>
      <span
        style={{
          color: "var(--fg-1)",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {keys}
      </span>
    </div>
  );
}

export function CheatSheet() {
  const open = useOverlayStore((s) => s.cheatSheetOpen);
  const close = useOverlayStore((s) => s.closeCheatSheet);
  const presetId = useKeymapStore((s) => s.activePresetId);
  // User-defined shortcuts (#225) belong on the same sheet as everything else —
  // straight from the dispatcher's own table, so a chord that fires is a chord
  // that is listed. They are not catalog actions and have no preset binding, so
  // they get their own section rather than a category.
  const userBindings = useKeymapStore((s) => s.userBindings);
  if (!open) return null;
  const preset = presetById(presetId);

  return (
    <div
      onMouseDown={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          padding: 20,
          maxHeight: "80vh",
          overflow: "auto",
          minWidth: 480,
          color: "var(--fg-0)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <h2 style={{ fontSize: 16 }}>Keyboard shortcuts</h2>
          <span style={{ color: "var(--fg-3)", fontSize: 11 }}>
            {preset.name}
          </span>
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const ids = ALL_ACTION_IDS.filter(
            (id) => ACTIONS[id].category === cat,
          );
          if (!ids.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div
                style={{
                  color: "var(--fg-2)",
                  fontSize: 11,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {cat}
              </div>
              {ids.map((id) => (
                <Row
                  key={id}
                  title={ACTIONS[id].title}
                  keys={formatBindings(preset.bindings[id] ?? [])}
                />
              ))}
            </div>
          );
        })}
        {userBindings.size > 0 && (
          <div style={{ marginBottom: 16 }} data-testid="cheat-sheet-custom">
            <div
              style={{
                color: "var(--fg-2)",
                fontSize: 11,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Custom actions
            </div>
            {[...userBindings].map(([chord, binding]) => (
              <Row key={chord} title={binding.title} keys={formatChord(chord)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
