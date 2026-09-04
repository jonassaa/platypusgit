import { PGInput, PGSelect, PGToggle } from "@/design";
import {
  isValidDiffToolName,
  useSettingsStore,
} from "@/features/settings/useSettingsStore";
import { SettingsCard, SettingsRow } from "@/features/settings/layout/SettingsCard";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "git.diff",
  group: "git",
  title: "Diff",
  icon: "diff",
  cards: [
    {
      id: "diff",
      title: "Diff",
      subtitle: "How diffs are rendered across the app.",
      rows: [
        { id: "diff.layout", label: "Layout", keywords: "split unified inline side by side" },
        { id: "diff.show", label: "Show", keywords: "whole file context hunks" },
        { id: "diff.context", label: "Context lines" },
        { id: "diff.whitespace", label: "Ignore whitespace" },
        { id: "diff.tool", label: "External diff tool", keywords: "difftool meld kdiff3 vimdiff bcompare" },
      ],
    },
  ],
};

export function DiffPage() {
  const s = useSettingsStore();
  return (
    <SettingsCard id="diff" title="Diff" subtitle="How diffs are rendered across the app.">
      <SettingsRow
        id="diff.layout"
        label="Layout"
        hint="Inline shows one column with added and removed lines interleaved. Split shows the old and new file side by side."
        control={
          <PGSelect
            value={s.diffViewMode}
            onChange={(v) => s.set("diffViewMode", v as "inline" | "split")}
            options={[
              { value: "inline", label: "Inline" },
              { value: "split", label: "Split" },
            ]}
          />
        }
      />
      <SettingsRow
        id="diff.show"
        label="Show"
        hint="Whole file reads the file top to bottom with each change in place. Changed chunks shows only the hunks and their context lines. Either way, staging still applies exactly the hunks git would."
        control={
          <PGSelect
            value={s.diffContextMode}
            onChange={(v) =>
              s.set("diffContextMode", v as "wholeFile" | "chunks")
            }
            options={[
              { value: "wholeFile", label: "Whole file" },
              { value: "chunks", label: "Changed chunks" },
            ]}
          />
        }
      />
      <SettingsRow
        id="diff.context"
        label="Context lines"
        hint="Unchanged lines shown around each hunk in the changed-chunks view. Also the context every hunk stage/discard is computed against, so it applies in both views."
        control={
          <PGInput
            type="number"
            value={String(s.diffContextLines)}
            onChange={(v) => {
              const n = Math.max(0, Math.min(20, parseInt(v, 10) || 3));
              s.set("diffContextLines", n);
            }}
            style={{ width: 72 }}
          />
        }
      />
      <SettingsRow
        id="diff.whitespace"
        label="Ignore whitespace"
        hint="Hide whitespace-only changes when reviewing reformatted code. Hunk staging is unavailable while this is on — the filtered hunks aren't the ones git would apply."
        control={
          <PGToggle
            checked={s.ignoreWhitespaceInDiff}
            onChange={(v) => s.set("ignoreWhitespaceInDiff", v)}
          />
        }
      />
      <SettingsRow
        id="diff.tool"
        label="External diff tool"
        hint={
          <>
            Which tool &quot;Open in external diff tool&quot; hands a file
            to. Leave it empty and git decides, from{" "}
            <code>diff.guitool</code>, <code>diff.tool</code> or{" "}
            <code>merge.tool</code> — so anyone who has already configured
            one needs nothing here. A tool NAME, not a command line
            (<code>meld</code>, <code>bc</code>, <code>vimdiff</code>, or one
            you defined with <code>difftool.&lt;tool&gt;.cmd</code>).
          </>
        }
        control={
          <PGInput
            value={s.externalDiffTool}
            onChange={(v) => s.set("externalDiffTool", v)}
            // A command line here would fail inside git with a message
            // about a tool nobody configured, so the field says so while it
            // is being typed — same treatment as the ticket pattern above.
            error={!isValidDiffToolName(s.externalDiffTool)}
            aria-invalid={!isValidDiffToolName(s.externalDiffTool)}
            mono
            size="sm"
            placeholder="git decides"
            style={{ width: 220 }}
            data-testid="settings-external-diff-tool"
          />
        }
      />
    </SettingsCard>
  );
}
