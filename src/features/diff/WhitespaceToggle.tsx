// Whitespace-ignore toggle for diff toolbars (#61 D2).
//
// One shared control because the setting is global and persisted: flipping it
// in any diff surface flips it everywhere, which is what you want when you are
// reviewing one reformatted change across several screens.

import { PGIconButton } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

/** The reason hunk-level actions are unavailable, or undefined when they are. */
export function useHunkActionsDisabledReason(): string | undefined {
  const on = useSettingsStore((s) => s.ignoreWhitespaceInDiff);
  return on
    ? "Hunk staging is unavailable while whitespace is ignored — these hunks are a filtered view, not the ones git would apply."
    : undefined;
}

export function useIgnoreWhitespace(): boolean {
  return useSettingsStore((s) => s.ignoreWhitespaceInDiff);
}

export function WhitespaceToggle() {
  const on = useSettingsStore((s) => s.ignoreWhitespaceInDiff);
  const set = useSettingsStore((s) => s.set);
  return (
    <PGIconButton
      icon="filter"
      size="sm"
      active={on}
      title={
        on
          ? "Ignoring whitespace — click to show whitespace-only changes (re-enables hunk staging)"
          : "Ignore whitespace-only changes"
      }
      onClick={() => set("ignoreWhitespaceInDiff", !on)}
    />
  );
}
