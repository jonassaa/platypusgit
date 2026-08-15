// "Add worktree" (#93). Mounted only while open (unlike CloneDialog/InitDialog,
// which self-gate), so the form resets by unmounting and needs no reset effect.

import React from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGButtonGroup, PGInput, PGModal, PGSelect } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { localBranches } from "@/lib/derive";

/** The git-visible worktree name a path implies — its basename, as `git worktree
 *  add` derives it. Exported for the component test. */
export function worktreeNameFromPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

export function WorktreeAddDialog({ onClose }: { onClose: () => void }) {
  const branches = useRepoStore((s) => s.branches);
  const busy = useWorktreesStore((s) => s.busy) === "*";
  const [parentDir, setParentDir] = React.useState("");
  const [name, setName] = React.useState("");
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [newBranch, setNewBranch] = React.useState("");
  const locals = localBranches(branches);
  const [existing, setExisting] = React.useState(
    () => locals.find((b) => !b.isHead)?.name ?? locals[0]?.name ?? "",
  );

  async function pickParent() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Create the worktree in",
    });
    if (typeof picked === "string") setParentDir(picked);
  }

  const resolved = parentDir && name ? `${parentDir}/${name}` : "";
  const branchOk = mode === "new" ? newBranch.trim() !== "" : existing !== "";
  const canCreate = !busy && resolved !== "" && branchOk;

  const submit = async () => {
    const ok = await useWorktreesStore.getState().add(
      resolved,
      mode === "new"
        ? { kind: "new", name: newBranch.trim() }
        : { kind: "existing", name: existing },
    );
    // Stay open on failure so the error (already on the store) is next to the
    // form that caused it.
    if (ok) onClose();
  };

  return (
    <PGModal onCancel={onClose} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Add worktree</div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            marginBottom: 4,
          }}
        >
          Create in
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <PGInput
            data-testid="worktree-parent"
            value={parentDir}
            disabled={busy}
            onChange={(v) => setParentDir(v)}
          />
          <PGButton size="sm" disabled={busy} onClick={() => void pickParent()}>
            Browse…
          </PGButton>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            marginBottom: 4,
          }}
        >
          Folder name
        </div>
        <PGInput
          data-testid="worktree-name"
          value={name}
          disabled={busy}
          onChange={(v) => setName(v)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            marginBottom: 4,
          }}
        >
          Branch
        </div>
        <PGButtonGroup
          size="sm"
          value={mode}
          onChange={(v) => setMode(v as "new" | "existing")}
          options={[
            { value: "new", label: "New branch" },
            { value: "existing", label: "Existing branch" },
          ]}
        />
        <div style={{ marginTop: 6 }}>
          {mode === "new" ? (
            <PGInput
              data-testid="worktree-new-branch"
              value={newBranch}
              disabled={busy}
              placeholder="feature/thing"
              onChange={(v) => setNewBranch(v)}
            />
          ) : (
            <PGSelect
              data-testid="worktree-existing-branch"
              value={existing}
              onChange={(v) => setExisting(v)}
              options={locals.map((b) => ({ value: b.name, label: b.name }))}
            />
          )}
        </div>
        {mode === "existing" && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
            }}
          >
            {/* git refuses a branch that is already checked out somewhere, and so
                does the backend — say so before the attempt, not after. */}
            A branch checked out in another worktree cannot be used here.
          </div>
        )}
      </div>

      {resolved && (
        <div
          data-testid="worktree-resolved"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            marginTop: 10,
          }}
        >
          → {resolved} (worktree “{worktreeNameFromPath(resolved)}”)
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <PGButton onClick={onClose} disabled={busy}>
          Cancel
        </PGButton>
        <PGButton
          variant="primary"
          data-testid="worktree-submit"
          disabled={!canCreate}
          onClick={() => void submit()}
        >
          {busy ? "Creating…" : "Create"}
        </PGButton>
      </div>
    </PGModal>
  );
}
