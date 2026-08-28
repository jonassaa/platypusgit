import React from "react";
import { PGEmpty, PGSpinner, PGToggle } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { blameFile } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { PGPane, FocusableScroll } from "@/features/keymap";
import { useSyntax, type SyntaxToken } from "@/lib/syntax";
import { buildLineSpans } from "@/lib/lineSpans";
import type { BlameLine, BlameResult } from "@/lib/types";

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

/**
 * git's own marks for a line an ignored revision touched: `?` when the
 * attribution beside it is a guess, `*` when nothing earlier can own the line
 * at all. Empty unless the repository asked for them
 * (`blame.markIgnoredLines` / `blame.markUnblamableLines`) — git only marks
 * when asked, and a mark nobody configured would read as a defect in the line.
 */
function markFor(l: BlameLine): string {
  if (l.unblamable) return "*";
  if (l.ignored) return "?";
  return " ";
}

export function BlameScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<BlameResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * Honour `blame.ignoreRevsFile` — git's own default — until the user says
   * otherwise.
   *
   * Deliberately NOT a persisted setting. The right default is git's behaviour
   * every time you open a file; a remembered "off" would silently contradict
   * the repository's own `.git-blame-ignore-revs` in some later session, with
   * nothing on screen explaining why the formatter owns every line.
   */
  const [ignoreRevs, setIgnoreRevs] = React.useState(true);

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
    blameFile(repo.id, path, ignoreRevs)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path, ignoreRevs]);

  const lines = result?.lines ?? [];

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

  const marked = result?.markIgnoredLines || result?.markUnblamableLines;

  return (
    <PGPane id="blame.content" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`Blame — ${path}`]} />
      {/* The toggle exists only where an ignore-revs file does: a repository
          without one would gain a control that changes nothing. */}
      {result?.ignoreRevsFile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 12px",
            borderBottom: "1px solid var(--border-0)",
            flexShrink: 0,
          }}
        >
          <PGToggle
            testId="blame-ignore-revs-toggle"
            checked={ignoreRevs}
            onChange={setIgnoreRevs}
            label={`Ignore revisions in ${result.ignoreRevsFile}`}
          />
          <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}>
            {ignoreRevs
              ? "lines a listed revision only reformatted are blamed on whoever wrote them"
              : "showing the raw blame — listed revisions own their lines"}
          </span>
        </div>
      )}
      {result?.ignoreRevsError && (
        <div
          data-testid="blame-ignore-revs-warning"
          style={{
            padding: "6px 12px",
            color: "var(--git-modified)",
            fontSize: "var(--fs-11)",
            borderBottom: "1px solid var(--border-0)",
            flexShrink: 0,
          }}
        >
          {result.ignoreRevsError}
        </div>
      )}
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      <FocusableScroll testId="blame-content" style={{
        flex: 1,
        fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
      }}>
        {lines.map((l, i) => (
          <div key={l.lineNo} data-testid="blame-line" style={{
            display: "flex",
            gap: 12,
            padding: "0 12px",
            whiteSpace: "pre",
          }}>
            {marked && (
              <span
                title={
                  l.unblamable
                    ? "Added by an ignored revision — no earlier commit can own this line"
                    : l.ignored
                      ? "Changed by an ignored revision — this attribution is git's best guess"
                      : undefined
                }
                style={{ width: 8, color: "var(--git-modified)" }}
              >
                {markFor(l)}
              </span>
            )}
            <span style={{ width: 56, color: "var(--fg-3)" }}>{l.shortOid}</span>
            <span style={{ width: 120, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {l.author}
            </span>
            <span style={{ width: 40, color: "var(--fg-3)", textAlign: "right" }}>{l.lineNo}</span>
            {/* The one selectable cell in the row: the source, without the
                oid / author / line-number gutters beside it, so a copied block
                pastes as code. `.pg-selectable` (index.css) opts back in from
                the app-wide `user-select: none` — without it a blamed line could
                not be selected or copied AT ALL, which is the same contract the
                four diff surfaces have kept since #61 (#297). */}
            <span className="pg-selectable" style={{ flex: 1 }}>
              <BlameText text={l.content} syntax={syntax?.[i]} />
            </span>
          </div>
        ))}
      </FocusableScroll>
    </PGPane>
  );
}
