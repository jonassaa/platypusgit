import React from "react";
import { PGButton, PGModal } from "@/design";

export type DirtyChoice = "stash" | "commit-first" | "discard" | "cancel";

interface Props {
  onResolve: (choice: DirtyChoice) => void;
}

export function DirtyTreeDialog({ onResolve }: Props) {
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  return (
    <PGModal onCancel={() => onResolve("cancel")} width={420}>
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
    </PGModal>
  );
}
