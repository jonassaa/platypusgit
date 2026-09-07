import { PGSelect } from "@/design";
import { CustomActionsSettings } from "@/features/actions/CustomActionsSettings";
import { BUILTIN_PRESETS, useKeymapStore } from "@/features/keymap";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "general.keyboard",
  group: "general",
  title: "Keyboard & actions",
  icon: "kbd",
  cards: [
    {
      id: "keyboard",
      title: "Keyboard",
      subtitle: "Choose a keymap preset. Press ? anywhere to see the active bindings.",
      rows: [{ id: "keyboard.keymap", label: "Keymap", keywords: "shortcuts chords bindings preset vscode" }],
    },
    {
      id: "actions",
      title: "Custom actions",
      subtitle: "Your own commands, available from the command palette.",
      rows: [{ id: "actions.list", label: "Actions", keywords: "custom command script palette" }],
    },
  ],
};

export function KeyboardPage() {
  const activePresetId = useKeymapStore((k) => k.activePresetId);
  return (
    <>
      <SettingsCard
        id="keyboard"
        title="Keyboard"
        subtitle="Choose a keymap preset. Press ? anywhere to see the active bindings."
      >
        <SettingsRow
          id="keyboard.keymap"
          label="Keymap"
          hint="Bindings apply across every screen. More presets coming."
          control={
            <PGSelect
              value={activePresetId}
              onChange={(v) => useKeymapStore.getState().setPreset(v)}
              options={BUILTIN_PRESETS.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              data-testid="keymap-preset-select"
            />
          }
        />
      </SettingsCard>

      <SettingsCard
        id="actions"
        title="Custom actions"
        subtitle="Your own commands, available from the command palette."
      >
        <SettingsRow id="actions.list" label="Actions" stacked control={<CustomActionsSettings />} />
      </SettingsCard>
    </>
  );
}
