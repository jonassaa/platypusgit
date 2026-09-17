// The scene registry. `?scene=<key>` in the browser and `pnpm shoot <key>` on
// the command line both index into this.
import type { Scene } from "../shim/core";
import { welcome } from "./welcome";
import { history } from "./history";

export const scenes: Record<string, Scene> = {
  welcome,
  history,
};
