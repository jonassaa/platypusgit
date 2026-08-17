// git-LFS state (#93).
//
// Loaded on demand by the LFS panel rather than on every repo refresh: probing the
// binary and listing objects are two subprocesses, and most repositories use no LFS
// at all.

import { create } from "zustand";
import type { AppError } from "@/lib/errors";
import { describeError, isAppError } from "@/lib/errors";
import type { LfsStatus } from "@/lib/types";
import { lfsCheckout, lfsFetch, lfsPull, lfsStatus } from "@/lib/tauri";
import { useRepoStore, withAuthRetry } from "@/features/repo/useRepoStore";

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: describeError(e) };
}

/** Human-readable byte size for a pointer's payload. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above — "1.4 MB", "512 MB".
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Materialized vs pointer counts, for the panel's summary line. */
export function lfsCounts(status: LfsStatus | null): {
  total: number;
  materialized: number;
  pointers: number;
} {
  const files = status?.files ?? [];
  const materialized = files.filter((f) => f.materialized).length;
  return {
    total: files.length,
    materialized,
    pointers: files.length - materialized,
  };
}

/** Why the LFS actions are unavailable, or null when they are usable. */
export function lfsDisabledReason(status: LfsStatus | null): string | null {
  if (!status) return "Checking for git-lfs…";
  if (!status.installed) return "git-lfs is not installed";
  if (!status.inUse) return "This repository does not use LFS";
  return null;
}

type LfsOp = "fetch" | "pull" | "checkout";

interface LfsState {
  status: LfsStatus | null;
  loading: boolean;
  error: AppError | null;
  /** Which op is in flight, for per-button spinners. */
  busy: LfsOp | null;
  refresh: () => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  checkout: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useLfsStore = create<LfsState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  busy: null,

  clearError() {
    set({ error: null });
  },

  reset() {
    set({ status: null, error: null, busy: null, loading: false });
  },

  async refresh() {
    const repo = useRepoStore.getState().current;
    if (!repo) {
      set({ status: null, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      set({ status: await lfsStatus(repo.id), loading: false });
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async fetch() {
    await runNetworkOp(set, get, "fetch", (id, creds) => lfsFetch(id, null, creds));
  },

  async pull() {
    await runNetworkOp(set, get, "pull", (id, creds) => lfsPull(id, null, creds));
  },

  async checkout() {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    set({ busy: "checkout", error: null });
    try {
      await lfsCheckout(repo.id);
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
    } finally {
      set({ busy: null });
    }
  },
}));

/**
 * `git lfs fetch`/`pull` talk to the LFS endpoint, so they go through the SHARED
 * credential flow — an LFS server behind HTTPS auth raises the same `Auth`
 * challenge every other network op does, answered by the one `CredentialDialog`.
 */
async function runNetworkOp(
  set: (partial: Partial<LfsState>) => void,
  get: () => LfsState,
  op: LfsOp,
  run: (repoId: string, creds?: Parameters<typeof lfsFetch>[2]) => Promise<void>,
): Promise<void> {
  const repo = useRepoStore.getState().current;
  if (!repo) return;
  set({ busy: op, error: null });
  try {
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await run(repo.id, creds);
        await get().refresh();
        // A pull materializes files, which changes the worktree.
        await useRepoStore.getState().refreshStatus();
      },
      async (e) => {
        await get().refresh();
        set({ error: toAppError(e) });
      },
    );
  } finally {
    set({ busy: null });
  }
}
