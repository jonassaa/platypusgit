import React from "react";

/**
 * The two stacking layers a modal can sit on (#212).
 *
 * `base` is where every dialog lives. `nested` is for a modal raised BY one of
 * those and answered before it — the credential prompt over the Clone dialog —
 * which MUST paint above it: two dialogs on the same z-index tie-break on DOM
 * order, and AppShell mounts the credential dialog first, so the prompt ended
 * up behind the Clone dialog's own backdrop, unclickable.
 *
 * Between the update panel (`zIndex` 50, an anchored dropdown) and the cheat
 * sheet (1000, a full-screen overlay). `app.closeOverlay` walks the same order
 * for Escape — keep the two in step.
 */
export const MODAL_Z = { base: 100, nested: 150 } as const;

interface Props {
  children: React.ReactNode;
  /** Backdrop click. Ignored entirely when `dismissable` is false. */
  onCancel: () => void;
  width?: number;
  /**
   * False while an operation the dialog owns is running and cannot be
   * cancelled — a clone in flight, for example. Dismissing then would orphan
   * the work with no way to reach it again.
   */
  dismissable?: boolean;
  /** See [`MODAL_Z`]. Defaults to `base`; only a dialog raised over another
   *  dialog needs `nested`. */
  layer?: keyof typeof MODAL_Z;
}

// Escape is deliberately NOT handled here. It's the keymap's job — wire it
// via `app.closeOverlay` (features/keymap) in the dialog/screen that owns
// this modal, the same way UpdatePanel does (see its comment). A second,
// component-local capture-phase Escape listener is exactly what issue #47's
// fix (deliberate precedence in usePaneList.ts) was written to avoid.
export function PGModal({
  children,
  onCancel,
  width = 480,
  dismissable = true,
  layer = "base",
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal
      onClick={(e) => {
        if (dismissable && e.currentTarget === e.target) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: MODAL_Z[layer],
      }}
    >
      <div
        style={{
          background: "var(--bg-0)",
          color: "var(--fg-0)",
          border: "1px solid var(--border-0)",
          borderRadius: 6,
          padding: 16,
          width,
          maxWidth: "90vw",
        }}
      >
        {children}
      </div>
    </div>
  );
}
