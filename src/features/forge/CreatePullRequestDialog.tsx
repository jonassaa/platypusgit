// Create a pull / merge request from the current branch (#92).
//
// Escape is NOT handled here — it goes through the keymap's `app.closeOverlay`,
// like every other overlay in the app (see PGModal's comment).

import React from "react";

import {
  PGButton,
  PGCheckbox,
  PGInput,
  PGModal,
  PGSelect,
  PGTextarea,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch } from "@/lib/derive";
import { useForgeStore } from "./useForgeStore";
import { prNoun, titleFromBranch } from "./forgeLabels";

export function CreatePullRequestDialog() {
  const open = useForgeStore((s) => s.createOpen);
  const forge = useForgeStore((s) => s.forge);
  const creating = useForgeStore((s) => s.creating);
  const error = useForgeStore((s) => s.error);
  const branches = useRepoStore((s) => s.branches);

  const head = currentBranch(branches);
  const kind = forge?.kind ?? null;
  const noun = prNoun(kind);

  // Local branches that could be the target. Remote-tracking entries are the
  // same refs by another name, so listing both would double every option.
  const targets = React.useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote && b.name !== head?.name)
        .map((b) => b.name),
    [branches, head?.name],
  );

  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [draft, setDraft] = React.useState(false);

  // Seed each time the dialog opens, not on every render: the user's typing must
  // survive an unrelated store update.
  React.useEffect(() => {
    if (!open) return;
    setTitle(head?.name ? titleFromBranch(head.name) : "");
    setBody("");
    setDraft(false);
    // Prefer main/master/develop if present — the overwhelmingly common target.
    const preferred = ["main", "master", "develop", "trunk"].find((n) =>
      targets.includes(n),
    );
    setTarget(preferred ?? targets[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !forge) return null;

  const source = head?.name ?? "";
  const canSubmit =
    !!source && !!target && source !== target && title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    void useForgeStore.getState().create({
      title: title.trim(),
      body,
      sourceBranch: source,
      targetBranch: target,
      draft,
    });
  };

  return (
    <PGModal
      onCancel={() => useForgeStore.getState().closeCreate()}
      width={560}
      dismissable={!creating}
    >
      <div data-testid="create-pr-dialog">
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: "var(--fs-16)",
            fontFamily: "var(--font-display)",
          }}
        >
          New {noun}
        </h2>
        <p
          style={{
            margin: "0 0 14px",
            fontSize: "var(--fs-12)",
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {forge.owner}/{forge.name} on {forge.host}
        </p>

        {!source && (
          <p
            role="alert"
            style={{
              margin: "0 0 12px",
              fontSize: "var(--fs-12)",
              color: "var(--git-removed)",
            }}
          >
            HEAD is detached — check out a branch first.
          </p>
        )}

        <Field label="Title">
          <PGInput
            value={title}
            onChange={setTitle}
            placeholder={`What this ${noun} does`}
            data-testid="create-pr-title"
          />
        </Field>

        <Field label="From → into">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--accent)",
              }}
              data-testid="create-pr-source"
            >
              {source || "(detached)"}
            </span>
            <span style={{ color: "var(--fg-3)" }}>→</span>
            <PGSelect
              value={target}
              onChange={setTarget}
              options={targets.map((n) => ({ value: n, label: n }))}
              data-testid="create-pr-target"
            />
          </div>
        </Field>

        <Field label="Description">
          <PGTextarea
            value={body}
            onChange={setBody}
            rows={6}
            placeholder="Why this change (optional)"
            data-testid="create-pr-body"
          />
        </Field>

        <div style={{ margin: "10px 0 14px" }}>
          <PGCheckbox
            checked={draft}
            onChange={setDraft}
            label={`Create as a draft ${noun}`}
            // PGCheckbox spreads no rest — testId is how the hook reaches it.
            testId="create-pr-draft"
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              margin: "0 0 12px",
              fontSize: "var(--fs-12)",
              color: "var(--git-removed)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <PGButton
            variant="ghost"
            onClick={() => useForgeStore.getState().closeCreate()}
            disabled={creating}
          >
            Cancel
          </PGButton>
          <PGButton
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
            loading={creating}
            data-testid="create-pr-submit"
          >
            Create {noun}
          </PGButton>
        </div>
      </div>
    </PGModal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span
        style={{
          display: "block",
          marginBottom: 4,
          fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--fg-2)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
