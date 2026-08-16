import React from "react";

import { PGButton, PGCheckbox, PGInput, PGModal, PGTextarea } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { Field } from "@/features/create/Field";
import { useCreateTagStore } from "./useCreateTagStore";

/**
 * Create a tag: name, annotation and signing in one place (#132).
 *
 * Replaces the three single-value `pgPrompt` call sites (the commit context
 * menu, History's commit detail, the palette), which between them could not
 * express three values — two of them hardcoded `annotation: null`, so an
 * annotated tag was unreachable from either.
 */
export function CreateTagDialog() {
  const target = useCreateTagStore((s) => s.target);
  const close = useCreateTagStore((s) => s.close);
  const done = useCreateTagStore((s) => s.done);
  const createTag = useRepoStore((s) => s.createTag);

  const [name, setName] = React.useState("");
  const [annotation, setAnnotation] = React.useState("");
  // null = follow tag.gpgsign, which the frontend cannot read; true/false
  // override it for this tag. Same three states CommitPanel uses.
  const [sign, setSign] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  // The dialog stays mounted (AppShell renders it unconditionally; it self-gates
  // below), so closing it is a `return null`, not an unmount — every useState
  // here would otherwise survive to the next open. Reset on each closed→open
  // transition. Signing in particular must not be sticky: it is an override,
  // and carrying it into the next tag would surprise, exactly as the per-commit
  // override does not persist between commits.
  React.useEffect(() => {
    if (!target) return;
    setName("");
    setAnnotation("");
    setSign(null);
    setBusy(false);
  }, [target]);

  if (!target) return null;

  const annotated = annotation.trim() !== "";
  // Signing implies annotated: a lightweight tag is a ref, with no object to
  // carry a signature. The backend refuses the combination; the UI never offers
  // it, so the refusal is a boundary check rather than a reachable error.
  const effectiveSign = annotated ? sign : false;
  const canCreate = !busy && name.trim() !== "";
  const shortOid = target.shortOid ?? target.oid.slice(0, 7);

  async function submit() {
    if (!canCreate || !target) return;
    setBusy(true);
    try {
      await createTag(name.trim(), {
        oid: target.oid,
        annotation: annotated ? annotation : null,
        sign: effectiveSign,
      });
      // The store surfaces a failure through the error banner; either way the
      // dialog is finished with. Leaving it open on failure would hide the
      // banner behind the backdrop.
      done();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PGModal onCancel={close} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Create tag</div>
      <div
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          marginBottom: 12,
        }}
      >
        Tagging <span className="mono">{shortOid}</span>.
      </div>

      <Field label="Name">
        <PGInput
          data-testid="create-tag-name"
          value={name}
          onChange={setName}
          placeholder="v1.0.0"
          mono
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </Field>

      <Field label="Annotation — leave blank for a lightweight tag">
        <PGTextarea
          data-testid="create-tag-annotation"
          value={annotation}
          onChange={setAnnotation}
          rows={3}
          placeholder="Release notes for this tag"
        />
      </Field>

      {/*
        Three states rather than two, matching the commit box. Indeterminate is
        "follow tag.gpgsign", which the frontend cannot read — showing it as
        plain unchecked would claim the tag is unsigned in a repository that has
        tag signing on. A signing failure fails the tag; it never silently
        produces an unsigned one.
      */}
      <PGCheckbox
        testId="create-tag-sign"
        checked={effectiveSign === true}
        indeterminate={annotated && sign === null}
        disabled={!annotated}
        onChange={(v) => setSign(v)}
        label={
          !annotated
            ? "Sign this tag — needs an annotation"
            : sign === null
              ? "Sign this tag — following git config"
              : sign
                ? "Sign this tag"
                : "Don't sign this tag"
        }
      />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <PGButton variant="ghost" onClick={close} disabled={busy}>
          Cancel
        </PGButton>
        <PGButton
          data-testid="create-tag-submit"
          variant="primary"
          icon="tag"
          disabled={!canCreate}
          onClick={() => void submit()}
        >
          Create tag
        </PGButton>
      </div>
    </PGModal>
  );
}
