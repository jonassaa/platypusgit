import React from "react";
import {
  updatesManagedExternally,
  useUpdateStore,
} from "@/features/update/useUpdateStore";
import { buildIndex, type IndexedRow } from "./match";

/**
 * The search index, with conditional rows resolved.
 *
 * A hook rather than a module constant because the update gate needs runtime
 * state. It reuses `updatesManagedExternally` instead of re-spelling
 * `=== "store-managed"` — that predicate's own comment asks for exactly this,
 * and it means the index's exposure window is identical to the Updates card's
 * (both answer "not managed" while the capability is still null, so an ordinary
 * install never flickers).
 *
 * Lives in its own module rather than `pages.ts`: `match.ts` imports
 * `pages.ts`, so a hook that imports `match.ts` FROM `pages.ts` would be a
 * `pages ↔ match` cycle. The one-way shape is
 * `useSettingsIndex.ts → match.ts → pages.ts → types.ts`.
 */
export function useSettingsIndex(): IndexedRow[] {
  const capability = useUpdateStore((s) => s.capability);
  const updatable = !updatesManagedExternally(capability);
  return React.useMemo(() => buildIndex({ updatable }), [updatable]);
}
