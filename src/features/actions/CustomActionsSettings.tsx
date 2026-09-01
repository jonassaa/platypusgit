// Managing user-defined commands (#225).
//
// The hint text carries real weight here: this is the one Settings surface that
// spawns a process, and the two things people get wrong about it are (a)
// expecting shell syntax and (b) not knowing the placeholders. Both are said
// plainly rather than left to be discovered by a command that silently does
// nothing useful.

import * as React from "react";

import { PGButton, PGInput, PGToggle } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

import {
  PLACEHOLDERS,
  blankAction,
  isSavableAction,
  normalizeAction,
  removeAction,
  upsertAction,
  type CustomAction,
} from "./customActions";

export function CustomActionsSettings() {
  const actions = useSettingsStore((s) => s.customActions);
  const setSetting = useSettingsStore((s) => s.set);
  const [draft, setDraft] = React.useState<CustomAction | null>(null);

  function save() {
    if (!draft || !isSavableAction(draft)) return;
    setSetting("customActions", upsertAction(actions, normalizeAction(draft)));
    setDraft(null);
  }

  return (
    <div
      data-testid="custom-actions"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-3)",
          lineHeight: 1.5,
        }}
      >
        Your own commands, in the command palette. The command is a program and
        its arguments —{" "}
        <strong>not a shell line</strong>: quotes group arguments, and{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>| &gt; ; &amp;&amp;</code>{" "}
        are ordinary characters, so a branch name or a path can never turn into
        a second command. Placeholders:{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          {PLACEHOLDERS.join(" ")}
        </code>
        . They run in the repository&rsquo;s directory and are never given a
        token or credential.
      </div>

      {actions.length === 0 && !draft && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
          No custom actions yet.
        </div>
      )}

      {actions.map((a) =>
        draft?.id === a.id ? (
          <ActionEditor
            key={a.id}
            draft={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <div
            key={a.id}
            data-testid="custom-action-row"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-11)",
                  color: "var(--fg-3)",
                  overflowWrap: "anywhere",
                }}
              >
                {a.command}
              </div>
            </div>
            <PGButton
              size="xs"
              variant="ghost"
              icon="edit"
              title="Edit"
              onClick={() => setDraft(a)}
              data-testid="custom-action-edit"
            />
            <PGButton
              size="xs"
              variant="ghost"
              icon="trash"
              title="Remove"
              onClick={() => setSetting("customActions", removeAction(actions, a.id))}
              data-testid="custom-action-remove"
            />
          </div>
        ),
      )}

      {draft && !actions.some((a) => a.id === draft.id) && (
        <ActionEditor
          draft={draft}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      )}

      {!draft && (
        <div>
          <PGButton
            size="xs"
            variant="outline"
            icon="plus"
            onClick={() => setDraft(blankAction())}
            data-testid="custom-action-add"
          >
            Add action
          </PGButton>
        </div>
      )}
    </div>
  );
}

function ActionEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: CustomAction;
  onChange: (a: CustomAction) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="custom-action-editor"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <PGInput
          value={draft.name}
          onChange={(v) => onChange({ ...draft, name: v })}
          placeholder="Open in editor"
          size="sm"
          aria-label="Name"
          data-testid="custom-action-name-input"
          style={{ flex: "1 1 140px", minWidth: 0 }}
        />
        <PGInput
          value={draft.command}
          onChange={(v) => onChange({ ...draft, command: v })}
          placeholder="code -g $FILE"
          size="sm"
          mono
          aria-label="Command"
          data-testid="custom-action-command-input"
          style={{ flex: "2 1 240px", minWidth: 0 }}
        />
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PGToggle
            checked={draft.showOutput}
            onChange={(v) => onChange({ ...draft, showOutput: v })}
            data-testid="custom-action-show-output"
          />
          <span style={{ fontSize: "var(--fs-11)" }}>
            Show output (a failure is always shown)
          </span>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <PGToggle
            checked={draft.refreshAfter}
            onChange={(v) => onChange({ ...draft, refreshAfter: v })}
            data-testid="custom-action-refresh-after"
          />
          <span style={{ fontSize: "var(--fs-11)" }}>Refresh when it exits</span>
        </label>
        <PGButton
          size="xs"
          variant="primary"
          // Name and command non-blank, and nothing more: whether the command
          // PARSES is the backend's question, and its refusal names what is
          // wrong. A second parser here would be a second place to drift.
          disabled={!isSavableAction(draft)}
          onClick={onSave}
          data-testid="custom-action-save"
        >
          Save
        </PGButton>
        <PGButton size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </PGButton>
      </div>
    </div>
  );
}
