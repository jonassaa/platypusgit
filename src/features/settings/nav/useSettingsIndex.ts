import React from "react";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import {
  updatesManagedExternally,
  useUpdateStore,
} from "@/features/update/useUpdateStore";
import { buildIndex, type IndexedRow } from "./match";

/**
 * The search index, with conditional rows resolved.
 *
 * A hook rather than a module constant because every gate needs runtime state.
 *
 * Lives in its own module rather than `pages.ts`: `match.ts` imports
 * `pages.ts`, so a hook that imports `match.ts` FROM `pages.ts` would be a
 * `pages ↔ match` cycle. The one-way shape is
 * `useSettingsIndex.ts → match.ts → pages.ts → types.ts`.
 */
export function useSettingsIndex(): IndexedRow[] {
  const capability = useUpdateStore((s) => s.capability);
  const themeMode = useSettingsStore((s) => s.themePreference.mode);

  // The INDEX treats a not-yet-known capability as store-managed, which is the
  // OPPOSITE of what `updatesManagedExternally` answers for `null` — and the
  // asymmetry is deliberate on both sides.
  //
  // That predicate stays the single spelling of "some other thing does the
  // updating" (a future winget/msstore channel is one edit there), and its own
  // comment explains why `null` answers `false`: it keeps the update UI from
  // hiding for a frame on every ordinary install. Right for the PANEL — a
  // control that flickers into existence is a cosmetic cost.
  //
  // A search is not a panel. `loadCapability()` is asynchronous, so on a Store
  // install `capability` is null for a moment after Settings opens — and
  // permanently if the probe fails — and during that window an ungated index
  // would put "Check for updates" and "Release channel" in the results pane
  // with live controls, and a hit badge on the Updates nav row. Store policy
  // 10.2.5 makes *naming* an update check the violation, not just performing
  // one; v0.4.0 failed certification on a notification. So for a search the
  // safe direction is briefly MISSING a row (an ordinary install where the
  // probe is still in flight, or failed, cannot find two rows by search until
  // it lands — the Updates page itself still shows them) rather than briefly
  // NAMING a check on an install that must never mention one.
  //
  // `SettingsScreen` primes `loadCapability()` on mount so the window is as
  // short as it can be: the old flat screen mounted `UpdatesSection`
  // unconditionally, and per-page mounting is what turned "primed whenever
  // Settings opens" into "primed only when the Updates page mounts".
  const updatable = capability !== null && !updatesManagedExternally(capability);

  // The two halves of `AppearancePage`'s `following ? … : …`, spelled as its
  // exact complement rather than as `mode === "fixed"` / `mode === "system"`:
  // the page renders the single theme picker for ANY mode that is not
  // "system", so deriving both from one boolean is what keeps the index from
  // describing neither row if a third mode ever appears.
  const followsSystem = themeMode === "system";

  return React.useMemo(
    () =>
      buildIndex({
        updatable,
        themeFixed: !followsSystem,
        themeFollowsSystem: followsSystem,
      }),
    [updatable, followsSystem],
  );
}
