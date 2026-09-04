// Creating a repository window (#256).
//
// The merge resolver (`features/merge/openMergeWindow.ts`) is the precedent: a
// second Tauri window running this same bundle. A repository window differs in
// two ways. It carries no query param — `main.tsx` routes only `?window=merge`,
// and everything else is the full app — and it is seeded through STORAGE rather
// than through the URL: the seed is written under the new window's own
// open-repositories key before the window exists, so the new window restores
// into it through its ordinary session-restore path, with no cross-window IPC
// and nothing to replay if it reloads.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { warn as logWarn } from "@tauri-apps/plugin-log";

import { getPlatform } from "@/lib/platform";
import { describeError } from "@/lib/errors";
import { nextWindowLabel } from "@/lib/tauri";
import { saveOpenRepos } from "@/features/repo/tabs";
import {
  cascadeFrom,
  forgetWindow,
  isRepoWindowLabel,
  openReposKey,
  rememberWindow,
  REPO_WINDOW_PREFIX,
  type WindowBounds,
  type WindowRecord,
} from "./windowKind";

/**
 * Labels this webview has already asked for.
 *
 * `next_window_label` answers from the windows Tauri knows about, and a window
 * is not in that list the instant its constructor returns — the creation is a
 * message. So two "New window" clicks in quick succession both get `pg-1`, and
 * the second one loses: its `WebviewWindow` fails on the duplicate label, and
 * on the way there it has already overwritten the first window's seed.
 *
 * Remembering what we asked for closes that window without a lock or a retry:
 * the backend's answer is a floor, and a label we have already claimed is
 * skipped. Released when the window is closed, so labels stay reusable across a
 * long session.
 */
const claimed = new Set<string>();

/** Take the lowest free label at or above the backend's answer. */
function claimLabel(fromBackend: string): string {
  let label = fromBackend;
  if (claimed.has(label)) {
    // Only a well-formed `pg-<n>` can be bumped; anything else is passed
    // through so the failure is the backend's answer, not a label we invented.
    const n = Number(label.slice(REPO_WINDOW_PREFIX.length));
    if (isRepoWindowLabel(label) && Number.isInteger(n)) {
      let next = n;
      do {
        next += 1;
        label = `${REPO_WINDOW_PREFIX}${next}`;
      } while (claimed.has(label));
    }
  }
  claimed.add(label);
  return label;
}

/** Let a label be handed out again once its window is gone. */
export function releaseWindowLabel(label: string): void {
  claimed.delete(label);
}

/** Test seam — the claim set is module state, like the resolver's attribution. */
export function __resetWindowClaims(): void {
  claimed.clear();
}

/** The literal `--bg-0` of the default dark theme, as the main window and the
 *  resolver both carry it. Without it both the window and webview layers
 *  default to white and a new window flashes a white rectangle before the dark
 *  UI arrives — see the startup-paint rule in CLAUDE.md. */
export const WINDOW_BACKGROUND = "#0d1013";

/** The geometry `tauri.conf.json` gives `main`, so a second window is the same
 *  window rather than a smaller one. */
const DEFAULTS = { width: 1200, height: 800, minWidth: 800, minHeight: 600 };

/**
 * Where the current window is, in physical pixels — the anchor a new window
 * cascades off, and what a sibling writes back as it is moved. Null when it
 * cannot be read, which every caller reads as "let the OS decide".
 */
export async function currentBounds(): Promise<WindowBounds | null> {
  try {
    const win = getCurrentWindow();
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

/**
 * Chrome the runtime has to pass explicitly, because a window created at
 * runtime does not inherit `tauri.conf.json`'s.
 *
 * macOS keeps the native traffic lights and lets content run under them
 * (`overlay` + the same traffic-light offset `main` uses). Windows and Linux
 * drop the OS frame entirely and render `PGWindowControls` instead.
 *
 * Passed at CREATION rather than applied afterwards on purpose. `lib.rs` records
 * what stripping the frame after the fact cost on Windows: the window was
 * created decorated and shown, and the native title bar appeared and then
 * vanished.
 */
export async function chromeOptions(): Promise<Record<string, unknown>> {
  const platform = await getPlatform();
  if (platform === "macos") {
    return {
      titleBarStyle: "overlay",
      hiddenTitle: true,
      trafficLightPosition: { x: 12, y: 20 },
    };
  }
  return { decorations: false };
}

/**
 * Put the window where it was, in PHYSICAL pixels.
 *
 * Deliberately NOT `WebviewWindowOptions`' `x`/`y`/`width`/`height`, which are
 * LOGICAL units: the bounds we remember are physical (see `WindowBounds`), and
 * handing physical numbers to a logical option is wrong by the scale factor —
 * on a 2× display a window would come back at twice its size, on the wrong part
 * of the wrong monitor. `setPosition`/`setSize` take the unit explicitly, so
 * there is nothing to convert and no scale factor to guess at for a monitor the
 * window has not landed on yet.
 *
 * Runs while the window is still hidden (see the creation call), so there is no
 * visible jump from the default geometry to this one. Failure is a nicety lost,
 * never an error: the window is already open and usable wherever the OS put it.
 */
async function applyBounds(
  win: WebviewWindow,
  bounds: WindowBounds | null,
): Promise<void> {
  if (!bounds) return;
  try {
    await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
    await win.setSize(new PhysicalSize(bounds.width, bounds.height));
  } catch (e) {
    logWarn(`could not place window ${win.label}: ${describeError(e)}`);
  }
}

export interface NewWindowOptions {
  /** Repositories the new window opens with, in tab order. Empty → Welcome. */
  seedPaths?: string[];
  /** Which of them is active. Defaults to the first. */
  seedActive?: string | null;
  /**
   * Recreate a window that already exists in the restore set, at its remembered
   * place. Mutually exclusive with the seed fields: a restored window's
   * repositories are already sitting under its own storage key, which is the
   * whole point of seeding through storage.
   */
  restore?: WindowRecord;
}

/**
 * Open a repository window and return its label, or null if it could not be
 * opened.
 *
 * For a NEW window the ordering is load-bearing:
 *
 * 1. ask the backend for a free label — only it can see every live window;
 * 2. write the seed under that label's key, BEFORE the window exists, so the
 *    new window's own `restoreSession()` finds it;
 * 3. remember the window, so a launch after a quit brings it back;
 * 4. create it.
 *
 * A creation failure rolls (2) and (3) back. A remembered window that was never
 * created would be resurrected at the next launch, which is a strange way for a
 * failed click to come back.
 */
export async function openAppWindow(
  options: NewWindowOptions = {},
): Promise<string | null> {
  const restoring = options.restore;
  let label: string;
  let bounds: WindowBounds | null;

  if (restoring) {
    label = restoring.label;
    bounds = restoring.bounds;
    // Claimed as well: a restore happens at launch, and a "New window" clicked
    // before Tauri has registered the restored ones must not be handed one of
    // their labels.
    claimed.add(label);
  } else {
    try {
      label = claimLabel(await nextWindowLabel());
    } catch (e) {
      logWarn(`could not name a new window: ${describeError(e)}`);
      return null;
    }
    const seedPaths = options.seedPaths ?? [];
    bounds = cascadeFrom(await currentBounds());
    saveOpenRepos(
      seedPaths.map((path) => ({ path })),
      options.seedActive ?? seedPaths[0] ?? null,
      openReposKey(label),
    );
    rememberWindow(label, bounds);
  }

  try {
    const win = new WebviewWindow(label, {
      url: "/",
      title: "PlatypusGit",
      ...DEFAULTS,
      ...(await chromeOptions()),
      // Hidden, exactly like `main`: `RevealOnFirstPaint` shows it once React
      // has committed, so the window appears already drawn instead of as an
      // empty frame. The resolver is the deliberate exception — it opens in
      // response to a click on a control that is right there, where appearing
      // instantly beats appearing complete.
      visible: false,
      backgroundColor: WINDOW_BACKGROUND,
    });
    void win.once("tauri://error", (e) => {
      logWarn(`window ${label} failed to open: ${JSON.stringify(e.payload)}`);
    });
    await applyBounds(win, bounds);
    return label;
  } catch (e) {
    logWarn(`could not open a window: ${describeError(e)}`);
    // Undo the seed and the record — but only for a window this call invented.
    // Forgetting a RESTORED one would delete a session the user still has,
    // because a restore failure is usually "that label is somehow already
    // taken", not "that window is gone".
    if (!restoring) {
      forgetWindow(label);
      releaseWindowLabel(label);
    }
    return null;
  }
}
