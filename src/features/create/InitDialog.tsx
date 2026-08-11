import React from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGInput, PGModal } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { defaultInitBranch } from "@/lib/tauri";
import { Field } from "./Field";
import { useCreateStore } from "./useCreateStore";

export function InitDialog() {
  const open = useCreateStore((s) => s.open);
  const busy = useCreateStore((s) => s.busy);
  const error = useCreateStore((s) => s.error);
  const close = useCreateStore((s) => s.close);
  const runInit = useCreateStore((s) => s.runInit);

  const [parentDir, setParentDir] = React.useState(
    () => useSettingsStore.getState().lastCreateDir,
  );
  const [name, setName] = React.useState("");
  const [branch, setBranch] = React.useState("");

  // Because the dialog stays mounted (AppShell renders it unconditionally;
  // it self-gates below), closing it is a `return null`, not an unmount —
  // every useState here would otherwise survive to the next open. Reset the
  // form on each closed→open transition. `parentDir` is re-read from
  // settings rather than cleared: persisting `lastCreateDir` exists so the
  // next init starts where the last one left off. `name` and `branch` start
  // fresh so a stale value (or a stale fetched default) from a prior open
  // never lingers.
  React.useEffect(() => {
    if (open !== "init") return;
    setParentDir(useSettingsStore.getState().lastCreateDir);
    setName("");
    setBranch("");
  }, [open]);

  React.useEffect(() => {
    if (open !== "init") return;
    let live = true;
    void defaultInitBranch()
      .then((b) => {
        // Don't clobber a value the user already typed.
        if (live) setBranch((cur) => (cur === "" ? b : cur));
      })
      .catch((e: unknown) => {
        // The backend already falls back to "main" on its own failure path,
        // so there's nothing to recover here — just keep this a console
        // warning instead of an unhandled promise rejection. The field
        // stays blank until the user types a branch themselves.
        console.warn("defaultInitBranch failed", e);
      });
    return () => {
      live = false;
    };
  }, [open]);

  if (open !== "init") return null;

  async function pickParent() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Create repository in",
    });
    if (typeof picked === "string") setParentDir(picked);
  }

  const resolved = parentDir && name ? `${parentDir}/${name}` : "";
  const canCreate = !busy && parentDir !== "" && name !== "";

  return (
    <PGModal onCancel={close} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>New repository</div>

      <Field label="Create in">
        <div style={{ display: "flex", gap: 6 }}>
          <PGInput
            data-testid="init-parent"
            value={parentDir}
            disabled={busy}
            onChange={(e) => setParentDir(e)}
          />
          <PGButton size="sm" disabled={busy} onClick={() => void pickParent()}>
            Browse…
          </PGButton>
        </div>
      </Field>

      <Field label="Folder name">
        <PGInput
          data-testid="init-name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e)}
        />
      </Field>

      <Field label="Initial branch">
        <PGInput
          data-testid="init-branch"
          value={branch}
          disabled={busy}
          onChange={(e) => setBranch(e)}
        />
      </Field>

      {resolved && (
        <div
          data-testid="init-resolved"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            marginTop: 10,
          }}
        >
          → {resolved}
        </div>
      )}

      {error && (
        <div
          data-testid="init-error"
          style={{
            marginTop: 12,
            fontSize: "var(--fs-12)",
            color: "var(--git-removed)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
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
        <PGButton onClick={close} disabled={busy}>
          Cancel
        </PGButton>
        <PGButton
          variant="primary"
          data-testid="init-submit"
          disabled={!canCreate}
          onClick={() => void runInit({ parentDir, name, branch: branch.trim() })}
        >
          {busy ? "Creating…" : "Create"}
        </PGButton>
      </div>
    </PGModal>
  );
}
