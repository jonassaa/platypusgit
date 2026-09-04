// Recording a custom action's shortcut (#225).
//
// A record-the-key field rather than a text box asking for `"Mod+Shift+G"`: the
// chord syntax is an internal spelling (`Mod` is ⌘ on macOS and Ctrl
// everywhere else, letters come from `e.code` so layouts do not matter), and
// asking a user to type it would be asking them to learn it.
//
// The recording itself belongs to the dispatcher — see `beginCapture`. A
// listener of this component's own could never win: the global one runs in the
// capture phase on `window` and is registered first, so ⌘K would be recorded
// AND commit.

import * as React from "react";

import { PGButton } from "@/design";
import { formatChord } from "@/features/keymap/chord";
import { useKeymapStore } from "@/features/keymap/useKeymapStore";

import { chordConflict, describeConflict } from "./actionChords";
import { chordRefusal, showsOn, type CustomAction } from "./customActions";

/** Why the field is unavailable, or null when it is not. */
function dormantReason(draft: CustomAction): string | null {
  // A shortcut runs the action the way the palette does, so it needs the
  // palette. Said here rather than enforced by silently clearing the chord —
  // the stored value survives, and re-ticking gives it back.
  return showsOn(draft, "repo")
    ? null
    : "A shortcut runs the action from the command palette — tick it to use one.";
}

export function ChordField({
  draft,
  actions,
  onChange,
}: {
  draft: CustomAction;
  /** The saved list, for detecting a chord another action already took. */
  actions: readonly CustomAction[];
  onChange: (next: CustomAction) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const dormant = dormantReason(draft);
  // One line under the row, in priority order: why the last press was refused,
  // why the field is unavailable, or what to do now.
  const note =
    refusal ??
    dormant ??
    (recording ? "Press a shortcut, or Esc to cancel." : null);

  // The recorder is torn down by the effect's cleanup, so leaving the editor
  // mid-recording (Cancel, a re-render that unmounts the row) can never leave
  // the dispatcher swallowing every key.
  React.useEffect(() => {
    if (!recording) return;
    return useKeymapStore.getState().beginCapture((chord) => {
      if (chord === "Escape") {
        setRecording(false);
        setRefusal(null);
        return;
      }
      const unusable = chordRefusal(chord);
      if (unusable) {
        // Keep recording: the next press is almost certainly the correction,
        // and dropping out of the mode would make the user click again to
        // make it.
        setRefusal(unusable);
        return;
      }
      const clash = chordConflict(chord, actions, draft.id);
      if (clash) {
        setRefusal(`${formatChord(chord)} — ${describeConflict(clash)}`);
        return;
      }
      onChange({ ...draft, chord });
      setRefusal(null);
      setRecording(false);
    });
  }, [recording, actions, draft, onChange]);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}>
        Shortcut:
      </span>
      <span
        data-testid="custom-action-chord-value"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: dormant && draft.chord ? "var(--fg-3)" : "var(--fg-1)",
          minWidth: 60,
        }}
      >
        {/* Only ever a chord or "None". The recording prompt goes in the note
            below instead, so this column keeps its width and the buttons beside
            it do not jump every time the state changes. */}
        {draft.chord ? formatChord(draft.chord) : "None"}
      </span>
      <PGButton
        size="xs"
        variant="outline"
        disabled={!!dormant}
        onClick={() => {
          setRefusal(null);
          setRecording((r) => !r);
        }}
        data-testid="custom-action-chord-record"
      >
        {/* "Stop", not "Cancel": the editor has a Cancel of its own, and two
            buttons with one word between them is a coin toss. */}
        {recording ? "Stop" : draft.chord ? "Change" : "Set shortcut"}
      </PGButton>
      {!!draft.chord && !recording && (
        <PGButton
          size="xs"
          variant="ghost"
          onClick={() => {
            setRefusal(null);
            onChange({ ...draft, chord: "" });
          }}
          data-testid="custom-action-chord-clear"
        >
          Clear
        </PGButton>
      )}
      {note && (
        <span
          data-testid="custom-action-chord-note"
          style={{ fontSize: "var(--fs-11)", color: "var(--fg-3)" }}
        >
          {note}
        </span>
      )}
    </div>
  );
}
