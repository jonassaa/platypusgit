import React from "react";
import { PGButton, PGCheckbox, PGInput } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { ReflogActionChoice } from "./useReflogStore";
import { useReflogStore } from "./useReflogStore";
import type { ReflogEntry } from "@/lib/types";

interface Props {
  entry: ReflogEntry;
  onResolve: (choice: ReflogActionChoice, branchName?: string) => void;
  onCancel: () => void;
}

export function ReflogActionDialog({ entry, onResolve, onCancel }: Props) {
  const headDetached = useRepoStore((s) => {
    if (!s.current) return false;
    // Detached HEAD = no local branch has isHead: true. This is the live-refreshed
    // view; s.current.head is only set at openRepo time and would go stale after
    // an in-app detached checkout.
    return !s.branches.some((b) => b.isHead);
  });
  const remembered = useReflogStore((s) => s.rememberedAction);
  const rememberAction = useReflogStore((s) => s.rememberAction);

  const [choice, setChoice] = React.useState<ReflogActionChoice>(
    remembered ?? (headDetached ? "checkout" : "reset"),
  );
  const [branchName, setBranchName] = React.useState("");
  const [remember, setRemember] = React.useState(false);

  const canGo = choice !== "branch" || branchName.trim().length > 0;

  function confirm() {
    if (remember) rememberAction(choice);
    onResolve(choice, choice === "branch" ? branchName.trim() : undefined);
  }

  return (
    <ModalShell onCancel={onCancel}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>
        Go to{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>{entry.shortOid}</span>
        {entry.message ? ` — ${entry.message}` : ""}
      </div>

      <Option
        checked={choice === "reset"}
        disabled={headDetached}
        onChange={() => setChoice("reset")}
        title="Reset branch here"
        desc="Moves your current branch to this point. Commits after this point stay recoverable from the reflog."
        disabledReason={
          headDetached
            ? "You're on a detached HEAD — there's no branch to reset."
            : undefined
        }
      />
      <Option
        checked={choice === "checkout"}
        onChange={() => setChoice("checkout")}
        title="Check out (detached)"
        desc="Lets you look around at this point without moving any branch. You can create a branch later if you want to keep changes."
      />
      <Option
        checked={choice === "branch"}
        onChange={() => setChoice("branch")}
        title="Create a new branch here"
        desc="Makes a new branch starting at this point and switches to it. Your current branch is unchanged."
      />
      {choice === "branch" && (
        <div style={{ marginLeft: 24, marginTop: 6 }}>
          <PGInput
            autoFocus
            placeholder="branch name"
            value={branchName}
            onChange={setBranchName}
            mono
            style={{ width: "60%" }}
          />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <PGCheckbox
          checked={remember}
          onChange={setRemember}
          label="Remember my choice for this session."
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 14,
        }}
      >
        <PGButton onClick={onCancel}>Cancel</PGButton>
        <PGButton variant="primary" disabled={!canGo} onClick={confirm}>
          Go
        </PGButton>
      </div>
    </ModalShell>
  );
}

function Option({
  checked,
  disabled,
  onChange,
  title,
  desc,
  disabledReason,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  desc: string;
  disabledReason?: string;
}) {
  return (
    <label
      title={disabledReason}
      style={{
        display: "block",
        marginTop: 8,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginRight: 8 }}
      />
      <strong>{title}</strong>
      <div
        style={{
          marginLeft: 24,
          color: "var(--fg-2)",
          fontSize: "var(--fs-12)",
        }}
      >
        {desc}
      </div>
    </label>
  );
}

function ModalShell({
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
          width: 480,
          maxWidth: "90vw",
        }}
      >
        {children}
      </div>
    </div>
  );
}
