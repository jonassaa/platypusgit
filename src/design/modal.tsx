import React from "react";

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
        zIndex: 100,
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
