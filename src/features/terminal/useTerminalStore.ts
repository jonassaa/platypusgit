import { create } from "zustand";

const TERMINAL_UI_KEY = "pg.terminal.ui";

/** Below this the terminal cannot show a prompt and a line of output, so the
 *  drag handle stops here rather than letting the panel collapse to a sliver
 *  the user then cannot grab. */
export const MIN_HEIGHT = 80;
/** Above this the panel has eaten the app. */
export const MAX_HEIGHT = 2000;
/** What a double-click on the handle returns to, and the first-run height. */
export const DEFAULT_HEIGHT = 240;

export const clampHeight = (px: number) =>
  Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(px)));

interface PersistedUi {
  open: boolean;
  heightPx: number;
}

function load(): PersistedUi {
  try {
    const raw = localStorage.getItem(TERMINAL_UI_KEY);
    if (!raw) return { open: false, heightPx: DEFAULT_HEIGHT };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { open: false, heightPx: DEFAULT_HEIGHT };
    }
    const { open, heightPx } = parsed as Partial<PersistedUi>;
    return {
      open: typeof open === "boolean" ? open : false,
      heightPx:
        typeof heightPx === "number" ? clampHeight(heightPx) : DEFAULT_HEIGHT,
    };
  } catch {
    return { open: false, heightPx: DEFAULT_HEIGHT };
  }
}

function persist(ui: PersistedUi): void {
  try {
    localStorage.setItem(TERMINAL_UI_KEY, JSON.stringify(ui));
  } catch {
    // non-fatal — the session just won't remember the panel
  }
}

interface TerminalState {
  /**
   * Whether the panel is showing.
   *
   * Closed by default. A terminal nobody asked for should not spawn a shell for
   * every repository they open — a `.zshrc` that runs nvm would then be paid
   * for on every tab, invisibly.
   */
  open: boolean;
  heightPx: number;
  /**
   * The live session epoch per repository.
   *
   * Per-repo state lives HERE and not in `useRepoStore`. `RepoSlice` holds
   * exactly one repository's state and is cleared on every tab switch, which is
   * right for a diff and catastrophic for a session handle: it would orphan the
   * shells of every inactive tab. This is the shape `useTabsStore` has — all
   * open repositories at once.
   *
   * Deliberately NOT persisted: the shells die with the process, so a restored
   * epoch would be a handle to nothing.
   */
  epochs: Record<string, number>;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setHeight: (px: number) => void;
  noteEpoch: (repoId: string, epoch: number) => void;
  forget: (repoId: string) => void;
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  ...load(),
  epochs: {},
  toggle: () => {
    const open = !get().open;
    set({ open });
    persist({ open, heightPx: get().heightPx });
  },
  setOpen: (open) => {
    set({ open });
    persist({ open, heightPx: get().heightPx });
  },
  setHeight: (px) => {
    const heightPx = clampHeight(px);
    set({ heightPx });
    persist({ open: get().open, heightPx });
  },
  noteEpoch: (repoId, epoch) =>
    set((s) => ({ epochs: { ...s.epochs, [repoId]: epoch } })),
  forget: (repoId) =>
    set((s) => {
      const next = { ...s.epochs };
      delete next[repoId];
      return { epochs: next };
    }),
}));
