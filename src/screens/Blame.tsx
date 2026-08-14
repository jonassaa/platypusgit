import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { blameFile } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { PGPane, FocusableScroll } from "@/features/keymap";
import { useSyntax, type SyntaxToken } from "@/lib/syntax";
import { buildLineSpans } from "@/lib/lineSpans";
import type { BlameLine } from "@/lib/types";

/**
 * One blame line's text, highlighted when tokens for it have arrived. Bare
 * string while they haven't, so the row never waits on tokenization.
 */
function BlameText({ text, syntax }: { text: string; syntax?: SyntaxToken[] }) {
  if (!syntax || syntax.length === 0) return <>{text}</>;
  return (
    <>
      {buildLineSpans(text, syntax, undefined).map((s, i) => (
        <span key={i} className={s.cls}>
          {text.slice(s.start, s.end)}
        </span>
      ))}
    </>
  );
}

export function BlameScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<BlameLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "blame") {
      setPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    blameFile(repo.id, path)
      .then((l) => { if (!cancelled) setLines(l); })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path]);

  // Blame already holds the whole file, so the tokens come from joining it back
  // up rather than a second read. Memoized: a new string identity on every
  // render would re-tokenize the file each time.
  const text = React.useMemo(
    () => (lines.length > 0 ? lines.map((l) => l.content).join("\n") : null),
    [lines],
  );
  const syntax = useSyntax(path, text);

  if (!path) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DeepViewHeader crumbs={["Blame"]} />
        <PGEmpty icon="search" title="No file selected">
          Right-click a file and choose "Blame".
        </PGEmpty>
      </div>
    );
  }

  return (
    <PGPane id="blame.content" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`Blame — ${path}`]} />
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      <FocusableScroll style={{
        flex: 1,
        fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
      }}>
        {lines.map((l, i) => (
          <div key={l.lineNo} style={{
            display: "flex",
            gap: 12,
            padding: "0 12px",
            whiteSpace: "pre",
          }}>
            <span style={{ width: 56, color: "var(--fg-3)" }}>{l.shortOid}</span>
            <span style={{ width: 120, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {l.author}
            </span>
            <span style={{ width: 40, color: "var(--fg-3)", textAlign: "right" }}>{l.lineNo}</span>
            <span style={{ flex: 1 }}>
              <BlameText text={l.content} syntax={syntax?.[i]} />
            </span>
          </div>
        ))}
      </FocusableScroll>
    </PGPane>
  );
}
