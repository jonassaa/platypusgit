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
  "App",
];

export function CheatSheet() {
  const open = useOverlayStore((s) => s.cheatSheetOpen);
  const close = useOverlayStore((s) => s.closeCheatSheet);
  const presetId = useKeymapStore((s) => s.activePresetId);
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
                <div
                  key={id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 24,
                    padding: "3px 0",
                  }}
                >
                  <span>{ACTIONS[id].title}</span>
                  <span
                    style={{
                      color: "var(--fg-1)",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {(preset.bindings[id] ?? [])
                      .map((c) => formatChord(c))
                      .join(" / ")}
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
