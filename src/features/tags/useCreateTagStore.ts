import { create } from "zustand";

/** What the dialog is being opened for. */
export interface CreateTagTarget {
  /** Full oid of the commit to tag. */
  oid: string;
  /** Display sha for the dialog's subtitle. Derived when omitted. */
  shortOid?: string;
}

interface CreateTagState {
  target: CreateTagTarget | null;
  /**
   * Open the create-tag dialog for `target`. Resolves when it closes — after a
   * successful create, or on dismissal.
   *
   * Promise-shaped and store-driven for the same reason `useAuthStore` is: two
   * of the three call sites (a context-menu item builder and a palette step)
   * are not React components and cannot render a modal themselves (#132).
   */
  openCreateTag: (target: CreateTagTarget) => Promise<void>;
  /** Dismiss without creating. Also what `app.closeOverlay` calls. */
  close: () => void;
  /** Settle the pending promise. The dialog calls this after a create. */
  done: () => void;
}

/**
 * Resolver for the open dialog. Deliberately module state rather than a store
 * field: it is a continuation, not something anything renders, and keeping it
 * out of the store means no component re-renders when it is swapped.
 */
let pending: (() => void) | null = null;

function settle() {
  const resolve = pending;
  pending = null;
  resolve?.();
}

export const useCreateTagStore = create<CreateTagState>((set) => ({
  target: null,
  openCreateTag: (target) =>
    new Promise<void>((resolve) => {
      // A second open replaces the first rather than stacking: only one modal
      // is ever mounted, so the earlier promise must settle or its caller waits
      // forever.
      settle();
      pending = resolve;
      set({ target });
    }),
  close: () => {
    set({ target: null });
    settle();
  },
  done: () => {
    set({ target: null });
    settle();
  },
}));

/** Imperative opener for non-component call sites. */
export function openCreateTag(target: CreateTagTarget): Promise<void> {
  return useCreateTagStore.getState().openCreateTag(target);
}
