// welcome-dark — the app with no repository open.
//
// The cheapest scene, and the smoke test for the whole shim layer: storage
// holds no repository, so whatever the app asks for here it asks for on EVERY
// start. That is why those handlers live in shared.ts rather than here.
import type { Scene } from "../shim/core";
import { BOOT_HANDLERS, SETTINGS_STORAGE } from "./shared";

export const welcome: Scene = {
  name: "welcome",
  figure: "welcome-dark",
  now: "2026-07-28T10:30:00+02:00",
  storage: {
    "pg-settings-v2": SETTINGS_STORAGE,
    // No `pg-open-repos`: nothing open IS the figure.
  },
  handlers: { ...BOOT_HANDLERS },
};
