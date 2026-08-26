import React from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGCheckbox, PGInput, PGModal } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { CloneProgress } from "@/lib/types";
import { deriveRepoName } from "./deriveRepoName";
import { Field } from "./Field";
import { useCreateStore } from "./useCreateStore";

export function CloneDialog() {
  const open = useCreateStore((s) => s.open);
  const busy = useCreateStore((s) => s.busy);
  const progress = useCreateStore((s) => s.progress);
  const error = useCreateStore((s) => s.error);
  const close = useCreateStore((s) => s.close);
  const runClone = useCreateStore((s) => s.runClone);
  const setProgress = useCreateStore((s) => s.setProgress);
  const cloneOpId = useCreateStore((s) => s.cloneOpId);
  const cancelClone = useCreateStore((s) => s.cancelClone);

  const [url, setUrl] = React.useState("");
  const [parentDir, setParentDir] = React.useState(
    () => useSettingsStore.getState().lastCreateDir,
  );
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [recurse, setRecurse] = React.useState(true);
  // Local, not store state: it is about what THIS dialog has been asked to do,
  // and the store's own `busy`/`cloneOpId` are what actually gate the button.
  // Cleared on the next open along with the rest of the form.
  const [cancelling, setCancelling] = React.useState(false);

  // Listen before the first clone starts: the first progress tick can land
  // before the invoke promise settles. This dialog stays mounted for the
  // life of the app (AppShell renders it unconditionally; it self-gates
  // below), so this subscribes exactly once, well before any clone runs.
  React.useEffect(() => {
    const un = listen<CloneProgress>("clone://progress", (e) =>
      setProgress(e.payload),
    );
    return () => {
      void un.then((f) => f());
    };
  }, [setProgress]);

  // Because the dialog stays mounted, closing it is a `return null` below,
  // not an unmount — every useState here would otherwise survive to the
  // next open. Reset the form on each closed→open transition. `parentDir`
  // is re-read from settings rather than cleared: it's the whole point of
  // persisting `lastCreateDir` that the next clone starts where the last
  // one left off. Everything else (url, name, the nameEdited latch, recurse)
  // starts fresh — a name the user edited on a previous clone must not
  // silently disable URL→name derivation for future ones.
  React.useEffect(() => {
    if (open !== "clone") return;
    setUrl("");
    setName("");
    setNameEdited(false);
    setRecurse(true);
    setCancelling(false);
    setParentDir(useSettingsStore.getState().lastCreateDir);
  }, [open]);

  if (open !== "clone") return null;

  function onUrlChange(next: string) {
    setUrl(next);
    // Only track the URL while the user hasn't taken over the name field.
    if (!nameEdited) setName(deriveRepoName(next));
  }

  async function pickParent() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Clone into",
    });
    if (typeof picked === "string") setParentDir(picked);
  }

  const resolved = parentDir && name ? `${parentDir}/${name}` : "";
  const canClone = !busy && url.trim() !== "" && parentDir !== "" && name !== "";

  return (
    <PGModal onCancel={close} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Clone repository</div>

      <Field label="Repository URL">
        <PGInput
          data-testid="clone-url"
          value={url}
          disabled={busy}
          placeholder="https://github.com/org/repo.git"
          onChange={(e) => onUrlChange(e)}
        />
      </Field>

      <Field label="Clone into">
        <div style={{ display: "flex", gap: 6 }}>
          <PGInput
            data-testid="clone-parent"
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
          data-testid="clone-name"
          value={name}
          disabled={busy}
          onChange={(e) => {
            setNameEdited(true);
            setName(e);
          }}
        />
      </Field>

      <PGCheckbox
        checked={recurse}
        disabled={busy}
        onChange={() => setRecurse((v) => !v)}
        label="Initialize submodules"
      />

      {resolved && (
        <div
          data-testid="clone-resolved"
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

      {busy && (
        <div
          data-testid="clone-progress"
          style={{ marginTop: 12, fontSize: "var(--fs-12)" }}
        >
          {cancelling
            ? "Stopping…"
            : progress
              ? `${progress.phase} — ${progress.percent}%`
              : "Cloning…"}
          <div
            style={{
              height: 4,
              marginTop: 6,
              background: "var(--bg-2)",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress?.percent ?? 0}%`,
                background: "var(--accent)",
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          data-testid="clone-error"
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
        {/*
          One button, two jobs — and deliberately so: while a clone runs, Cancel
          is the control the user is already reaching for, and a separate Stop
          next to a disabled Cancel would be two ways to say the same thing.
          `close()` still refuses to close mid-run; the store closes the dialog
          once the backend confirms it has cleaned up the partial destination.

          Disabled while busy with no op id: that clone was started without one
          (an older frontend, or the id was dropped), so nothing can stop it and
          the button must not pretend otherwise.
        */}
        <PGButton
          data-testid="clone-cancel"
          onClick={() => {
            if (!busy) {
              close();
              return;
            }
            setCancelling(true);
            cancelClone();
          }}
          disabled={busy && !cloneOpId}
          title={
            busy
              ? cancelling
                ? "Still stopping — click again to force it"
                : "Stop the clone and remove the partial download"
              : undefined
          }
        >
          Cancel
        </PGButton>
        <PGButton
          variant="primary"
          data-testid="clone-submit"
          disabled={!canClone}
          onClick={() =>
            void runClone({
              url: url.trim(),
              parentDir,
              name,
              recurseSubmodules: recurse,
            })
          }
        >
          {busy ? "Cloning…" : "Clone"}
        </PGButton>
      </div>
    </PGModal>
  );
}
