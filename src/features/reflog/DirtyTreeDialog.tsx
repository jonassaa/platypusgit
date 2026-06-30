import React from "react";
import { PGButton } from "@/design";

export type DirtyChoice = "stash" | "commit-first" | "discard" | "cancel";

interface Props {
  onResolve: (choice: DirtyChoice) => void;
}

export function DirtyTreeDialog({ onResolve }: Props) {
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  return (
    <Shell onCancel={() => onResolve("cancel")}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        You have uncommitted changes.
      </div>
      <div
        style={{
          color: "var(--fg-2)",
          fontSize: "var(--fs-12)",
          marginBottom: 14,
        }}
      >
        Decide what to do with them before jumping to the reflog entry.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <PGButton onClick={() => onResolve("stash")}>
          Stash them (auto-named)
        </PGButton>
        <PGButton onClick={() => onResolve("commit-first")}>
          Commit first — I'll do it manually
        </PGButton>
        {!confirmingDiscard && (
          <PGButton onClick={() => setConfirmingDiscard(true)}>
            Discard them…
          </PGButton>
        )}
        {confirmingDiscard && (
          <PGButton variant="danger" onClick={() => onResolve("discard")}>
            Really discard — this is irreversible
          </PGButton>
        )}
        <PGButton variant="ghost" onClick={() => onResolve("cancel")}>
          Cancel
        </PGButton>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onCancel,
}: {
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      onClick={(e) => {
        if (e.currentTarget === e.target) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 101,
      }}
    >
      <div
        style={{
          background: "var(--bg-0)",
          color: "var(--fg-0)",
          border: "1px solid var(--border-0)",
          borderRadius: 6,
          padding: 16,
          width: 420,
          maxWidth: "90vw",
        }}
      >
        {children}
      </div>
    </div>
  );
}
