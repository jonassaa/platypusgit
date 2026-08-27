// The find bar every diff surface mounts, driven by `useDiffFind`.
//
// It renders INSIDE the diff pane on purpose. Focusing the input then puts the
// focus store on that pane (PGPane's onFocusCapture), which is what keeps the
// pane-scoped Escape binding (`diff.closeFind`) alive while the caret sits in the
// box — a bar mounted outside the pane would close only after clicking away.
import { PGButton, PGIconButton, PGInput } from "@/design";
import type { DiffFind } from "./useDiffFind";

/**
 * "3 of 128", "No results", or nothing at all before anything is typed.
 *
 * The count is over the WHOLE row model, which is the point of the feature: a
 * count of what is rendered would say "1" for a file with two hundred hits.
 */
function countLabel(find: DiffFind): string {
  if (find.query.length === 0) return "";
  if (find.matchCount === 0) return "No results";
  const total = find.truncated ? `${find.matchCount}+` : `${find.matchCount}`;
  return `${find.current + 1} of ${total}`;
}

export function DiffFindBar({ find }: { find: DiffFind }) {
  if (!find.open) return null;
  return (
    <div
      data-testid="diff-find-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border-0)",
        flexShrink: 0,
      }}
    >
      <PGInput
        icon="search"
        size="sm"
        mono
        value={find.query}
        onChange={find.setQuery}
        inputRef={find.inputRef}
        placeholder="Find in diff"
        aria-label="Find in diff"
        data-testid="diff-find-input"
        style={{ width: 240 }}
        // Enter / Shift+Enter step the matches. Handled on the input rather than
        // through the keymap because the caret is IN it: the dispatcher suppresses
        // bare-key chords inside a text field (so `list.activate` never sees this
        // Enter), and "Enter submits the box you are typing in" is the one chord a
        // form owns rather than the app.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (e.shiftKey) find.prev();
          else find.next();
        }}
      />
      <span
        data-testid="diff-find-count"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          minWidth: 74,
        }}
      >
        {countLabel(find)}
      </span>
      <PGButton
        size="xs"
        variant={find.caseSensitive ? "primary" : "ghost"}
        aria-pressed={find.caseSensitive}
        title="Match case"
        data-testid="diff-find-case"
        onClick={() => find.setCaseSensitive(!find.caseSensitive)}
      >
        Aa
      </PGButton>
      <PGIconButton
        icon="chevronUp"
        size="sm"
        title="Previous match (Shift+Enter)"
        onClick={find.prev}
      />
      <PGIconButton
        icon="chevronDown"
        size="sm"
        title="Next match (Enter)"
        onClick={find.next}
      />
      <PGIconButton icon="x" size="sm" title="Close (Escape)" onClick={find.close} />
    </div>
  );
}
