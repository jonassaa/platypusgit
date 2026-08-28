import React from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGCheckbox, PGInput, PGModal } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { CloneProgress } from "@/lib/types";
import { deriveRepoName } from "./deriveRepoName";
import { Field } from "./Field";
import { useCreateStore } from "./useCreateStore";

/** What the depth box starts at when shallow is switched on. */
const DEFAULT_DEPTH = 1;

export function CloneDialog() {
  const open = useCreateStore((s) => s.open);
  const busy = useCreateStore((s) => s.busy);
  const progress = useCreateStore((s) => s.progress);
  const error = useCreateStore((s) => s.error);
  const close = useCreateStore((s) => s.close);
  const runClone = useCreateStore((s) => s.runClone);
  const cancelClone = useCreateStore((s) => s.cancelClone);
  const cancelRequested = useCreateStore((s) => s.cancelRequested);
  const setProgress = useCreateStore((s) => s.setProgress);

  const [url, setUrl] = React.useState("");
  const [parentDir, setParentDir] = React.useState(
    () => useSettingsStore.getState().lastCreateDir,
  );
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [recurse, setRecurse] = React.useState(true);
  // #255. `advanced` is disclosure only — the values below it are live whether
  // the section is open or shut, so collapsing it never silently changes what
  // Clone would do. `shallow` and `depth` are two fields because the checkbox is
  // the decision and the number is a detail of it: unticking must not lose the
  // number the user typed, and a blank number must not mean "full clone".
  const [advanced, setAdvanced] = React.useState(false);
  const [shallow, setShallow] = React.useState(false);
  const [depth, setDepth] = React.useState(String(DEFAULT_DEPTH));
  const [blobless, setBlobless] = React.useState(false);
  const [singleBranch, setSingleBranch] = React.useState(false);

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
  // one left off. Everything else (url, name, the nameEdited latch, recurse,
  // and every Advanced field including the disclosure itself) starts fresh —
  // a name the user edited on a previous clone must not silently disable
  // URL→name derivation for future ones, and a `--depth 1` chosen for one
  // enormous repository must not quietly truncate the next.
  React.useEffect(() => {
    if (open !== "clone") return;
    setUrl("");
    setName("");
    setNameEdited(false);
    setRecurse(true);
    setAdvanced(false);
    setShallow(false);
    setDepth(String(DEFAULT_DEPTH));
    setBlobless(false);
    setSingleBranch(false);
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
  // The box is text, because a number input cannot be empty and non-empty at
  // once and the user is allowed to clear it mid-edit. A value that is not a
  // positive integer disables Clone rather than being silently rounded into
  // one — the backend refuses a 0 too, but a form should not need the round
  // trip to say so.
  const parsedDepth = /^\d+$/.test(depth.trim()) ? Number(depth.trim()) : NaN;
  const depthValid = !shallow || (Number.isFinite(parsedDepth) && parsedDepth >= 1);
  const canClone =
    !busy && url.trim() !== "" && parentDir !== "" && name !== "" && depthValid;

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

      {/*
        Progressive disclosure (#255): the default clone is URL + folder +
        Clone, and everything that can truncate what lands on disk is one click
        away rather than in the way. A PGButton rather than a `<details>`: the
        app owns its own chrome, and a native disclosure triangle is the one
        widget in this dialog that would not be themed.
      */}
      <PGButton
        variant="ghost"
        size="sm"
        icon={advanced ? "chevronDown" : "chevronRight"}
        data-testid="clone-advanced-toggle"
        aria-expanded={advanced}
        disabled={busy}
        onClick={() => setAdvanced((v) => !v)}
        style={{ paddingLeft: 0 }}
      >
        Advanced
      </PGButton>

      {advanced && (
        <div
          data-testid="clone-advanced"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "8px 0 4px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PGCheckbox
              testId="clone-shallow"
              checked={shallow}
              disabled={busy}
              onChange={() => setShallow((v) => !v)}
              label="Shallow clone — keep only the newest"
            />
            <PGInput
              data-testid="clone-depth"
              value={depth}
              disabled={busy || !shallow}
              onChange={setDepth}
              size="sm"
              style={{ width: 64 }}
              aria-label="Clone depth"
            />
            <span style={{ fontSize: "var(--fs-12)" }}>commits</span>
          </div>
          {shallow && !depthValid && (
            <div
              data-testid="clone-depth-error"
              style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
            >
              Depth must be a whole number, 1 or more.
            </div>
          )}
          {shallow && (
            <div
              data-testid="clone-shallow-warning"
              style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
            >
              History genuinely stops: older commits are absent, not just
              unfetched, and blame is truncated with them. The app says so
              afterwards and offers to fetch the rest.
            </div>
          )}
          <PGCheckbox
            testId="clone-blobless"
            checked={blobless}
            disabled={busy}
            onChange={() => setBlobless((v) => !v)}
            label="Blobless — full history, file contents fetched on demand"
          />
          <PGCheckbox
            testId="clone-single-branch"
            checked={singleBranch}
            disabled={busy}
            onChange={() => setSingleBranch((v) => !v)}
            label="Single branch — fetch only the default branch"
          />
          <PGCheckbox
            testId="clone-submodules"
            checked={recurse}
            disabled={busy}
            onChange={() => setRecurse((v) => !v)}
            label="Initialize submodules"
          />
        </div>
      )}

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
          {progress ? `${progress.phase} — ${progress.percent}%` : "Cloning…"}
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
          One button, two jobs — and never disabled, which is the point (#234).
          While a clone runs it stops the clone; otherwise it closes the dialog.
          Before this it was greyed out for exactly the minutes a user most
          needs it, and a clone against a stalled host could only be escaped by
          force-quitting the app.

          Deliberately NOT a second button next to it: a disabled "Cancel" beside
          a live "Stop" is the arrangement that teaches people the dialog is
          stuck. The label carries the difference instead — now for three states
          rather than two (#263), because the second click on a running clone
          escalates SIGTERM to SIGKILL and only the SIGTERM lets git clean up
          its own lock files and partial destination. A button whose label did
          not move on the first click would read as "nothing happened", and the
          double-click that follows skips straight past the polite signal.
        */}
        <PGButton
          data-testid="clone-cancel"
          onClick={() => (busy ? void cancelClone() : close())}
        >
          {busy ? (cancelRequested ? "Force stop" : "Cancel clone") : "Cancel"}
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
              options: {
                recurseSubmodules: recurse,
                // The checkbox is what decides, not the box's contents: a
                // number left in the field with shallow unticked must not
                // truncate the clone.
                depth: shallow ? parsedDepth : null,
                blobless,
                singleBranch,
              },
            })
          }
        >
          {busy ? "Cloning…" : "Clone"}
        </PGButton>
      </div>
    </PGModal>
  );
}
