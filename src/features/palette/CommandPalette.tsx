import React from "react";
import ReactDOM from "react-dom";
import { PGIcon, PGSearchInput } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "./usePaletteStore";
import { chordFor, formatChord, useKeymapStore } from "@/features/keymap";
import { branchItems, buildCommands, commitItems, fileItems } from "./commands";
import { fuzzyMatch } from "./fuzzyMatch";
import { frecencyScore, bumpFrecency, loadFrecency, recentIds } from "./frecency";
import type { PaletteItem, ResultType } from "./types";

function highlight(text: string, indices: number[]): React.ReactNode {
  if (indices.length === 0) return text;
  const hit = new Set(indices);
  const out: React.ReactNode[] = [];
  let run = "";
  let runHit = false;
  const flush = (key: number) => {
    if (run === "") return;
    if (runHit) {
      out.push(
        <span key={key} style={{ color: "var(--color-accent)", fontWeight: 600 }}>
          {run}
        </span>,
      );
    } else {
      out.push(run);
    }
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isHit = hit.has(i);
    if (isHit !== runHit) flush(i);
    run += text[i];
    runHit = isHit;
  }
  flush(text.length);
  return out;
}

interface ScoredRow {
  item: PaletteItem;
  score: number;
  labelIndices: number[];
}

const TYPE_LABEL: Record<ResultType, string> = {
  command: "Commands",
  branch: "Branches",
  file: "Files",
  commit: "Commits",
};
const TYPE_ORDER: ResultType[] = ["command", "branch", "file", "commit"];
const CHIPS: { kind: import("./types").ChipKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "command", label: "Commands" },
  { kind: "branch", label: "Branches" },
  { kind: "file", label: "Files" },
  { kind: "commit", label: "Commits" },
];
// Per-type row cap, applied to PICK steps as well as the root — a pick step is
// just a one-type source. So a row that exists is not necessarily a row that
// renders: with an empty query every candidate ties on score, the sort is
// stable, and everything past the cap in source order is dropped. An e2e spec
// that clicks a commit row without typing is therefore asserting against the
// newest 8 only, and passes purely by fixture size (bisect.e2e.ts hit this: a
// 9-commit fixture whose GOOD end is the oldest commit). Type to filter.
const CAP: Record<ResultType, number> = { command: 12, branch: 8, file: 12, commit: 8 };
const QUICK_IDS = ["action:push-current", "action:pull-current", "screen:commit", "action:fetch-all"];
const WIDTH = 560;

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const stack = usePaletteStore((s) => s.stack);
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const closePalette = usePaletteStore((s) => s.closePalette);
  const popStep = usePaletteStore((s) => s.popStep);
  const activeChip = usePaletteStore((s) => s.activeChip);
  const setChip = usePaletteStore((s) => s.setChip);

  // Chord chips re-render when the user switches keymap preset.
  useKeymapStore((s) => s.activePresetId);
  const repoOpen = useRepoStore((s) => !!s.current);
  const branches = useRepoStore((s) => s.branches);
  const allFiles = useRepoStore((s) => s.allFiles);
  const commits = useRepoStore((s) => s.commits);
  const setIntent = useNavStore((s) => s.setIntent);

  const step = stack[stack.length - 1];

  const frecency = React.useMemo(() => loadFrecency(), [open, stack.length]);

  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  // Root-step candidate set: commands (catalog) + live branch/file/commit rows.
  // The row shapes come from commands.ts — same builders the pick steps use, so
  // a row kind cannot drift between the root step and a pick step. Only the id
  // namespace differs (root rows have their own frecency keys).
  // Gated on `open`: this component is always mounted (AppShell), and its
  // inputs — `commits`, `allFiles` — change on every refresh and page load.
  // Without the gate, every git op rebuilt one row object + closure per tracked
  // file and loaded commit, then the scoring memo below sorted them, all for a
  // palette nobody could see. Closed ⇒ empty; the real list builds on open.
  const candidates = React.useMemo<PaletteItem[]>(
    () =>
      !open || step.kind !== "root"
        ? []
        : [
            ...buildCommands(),
            ...branchItems({
              branches,
              idPrefix: "branch",
              icon: "branch",
              onPick: (name) => void useRepoStore.getState().checkoutBranch(name),
            }),
            ...fileItems({
              files: allFiles,
              idPrefix: "file",
              icon: "file",
              onPick: (path) => setIntent({ kind: "diff-file", path }),
            }),
            ...commitItems({
              commits,
              idPrefix: "commit",
              icon: "commit",
              onPick: (oid) => setIntent({ kind: "commit-vs-wt", oid }),
            }),
          ],
    [open, step.kind, branches, allFiles, commits, setIntent],
  );

  // Source list for the active step: root → candidates; pick → step.items.
  const source: PaletteItem[] =
    step.kind === "root" ? candidates : step.kind === "pick" ? step.items : [];

  // Filter + score + (root only) group + cap, then flatten for keyboard nav.
  const { flat, groups } = React.useMemo(() => {
    // On the root step a non-"all" chip renders only its own type. Skip the
    // other types BEFORE fuzzy-matching so a selected chip doesn't pay to score
    // the entire candidate set (up to ~500 rows) each keystroke.
    const chipFilter =
      step.kind === "root" && activeChip !== "all" ? activeChip : null;
    const byType: Record<ResultType, ScoredRow[]> = { command: [], branch: [], file: [], commit: [] };
    for (const item of source) {
      if (chipFilter && item.type !== chipFilter) continue;
      const mSearch = fuzzyMatch(query, item.search);
      const mLabel = item.search !== item.label ? fuzzyMatch(query, item.label) : mSearch;
      const best = mSearch.score >= mLabel.score ? mSearch : mLabel;
      if (!best.matched) continue;
      const labelIndices = query.length === 0 ? [] : mLabel.indices;
      const boosted = best.score + frecencyScore(frecency, item.id, Date.now());
      byType[item.type].push({ item, score: boosted, labelIndices });
    }
    const groupsOut: { type: ResultType; rows: ScoredRow[] }[] = [];
    const flatOut: ScoredRow[] = [];
    for (const type of TYPE_ORDER) {
      const sorted = byType[type].sort((a, b) => b.score - a.score).slice(0, CAP[type]);
      if (sorted.length === 0) continue;
      groupsOut.push({ type, rows: sorted });
      flatOut.push(...sorted);
    }
    return { flat: flatOut, groups: groupsOut };
  }, [source, query, step.kind, activeChip]);

  // Where the cursor rests before the user aims it. A pick step may decline a
  // resting row (`cursor: "none"`) so Enter does nothing until they do — the
  // branch steps use it, because #135 pins the default branch at row 0 and
  // "⌘P, delete branch, Enter, Enter" would otherwise delete `main`. Only
  // while the query is empty: once they type, the top match IS the target.
  const restingIndex =
    step.kind === "pick" && step.cursor === "none" && query === "" ? -1 : 0;

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(restingIndex);
    if (repoOpen) void useRepoStore.getState().refreshAllFiles();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoOpen, stack.length]);

  // Home-screen rows (computed before early return so navRows is available for effects).
  const byId = (id: string) => candidates.find((c) => c.id === id);
  const quickRows: PaletteItem[] =
    step.kind === "root" && query === "" && activeChip === "all"
      ? QUICK_IDS.map(byId).filter((x): x is PaletteItem => x != null)
      : [];
  const recentRows: PaletteItem[] =
    step.kind === "root" && query === "" && activeChip === "all"
      ? recentIds(frecency, 6)
          .map(byId)
          .filter((x): x is PaletteItem => x != null)
      : [];
  const showEmptyHome =
    step.kind === "root" &&
    query === "" &&
    activeChip === "all" &&
    (quickRows.length > 0 || recentRows.length > 0);

  // Keyboard nav must index the SAME rows the DOM renders. On the root step a
  // non-"all" chip renders only that type's rows (see render below), so nav
  // rows are filtered to match — otherwise activeIndex points into the full
  // `flat` list and Enter fires an unshown row (e.g. a force-push command).
  const navRows: ScoredRow[] = showEmptyHome
    ? [...quickRows, ...recentRows].map((item) => ({ item, score: 0, labelIndices: [] }))
    : step.kind === "root" && activeChip !== "all"
      ? flat.filter((r) => r.item.type === activeChip)
      : flat;

  React.useEffect(() => { setActiveIndex(restingIndex); }, [query, activeChip, restingIndex]);
  React.useEffect(() => {
    // -1 (no resting row) is below every length, so this leaves it alone.
    if (activeIndex >= navRows.length) setActiveIndex(Math.max(0, navRows.length - 1));
  }, [navRows.length, activeIndex]);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pal-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // ---- input step submit ----
  const [inputError, setInputError] = React.useState<string | null>(null);
  const submitInput = () => {
    if (step.kind !== "input") return;
    const err = step.validate?.(query) ?? null;
    if (err) { setInputError(err); return; }
    setInputError(null);
    step.onSubmit(query);
  };
  React.useEffect(() => { setInputError(null); }, [stack.length]);

  if (!open) return null;

  const activate = (row: ScoredRow | undefined) => {
    if (!row) return;
    const id = row.item.id;
    row.item.run();
    if (!usePaletteStore.getState().open) bumpFrecency(id, Date.now());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys already routed by the global dispatcher (e.g. Escape closing the
    // cheat-sheet stacked above the palette) must not double-fire here.
    if (e.defaultPrevented) return;
    // An Enter that confirms an IME composition (CJK etc.) must not submit the
    // step or activate a row — the composition is being committed, not the
    // palette. keyCode 229 is the legacy signal for "still composing".
    if (
      e.key === "Enter" &&
      (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
    ) {
      return;
    }
    if (e.key === "Tab" && e.ctrlKey && step.kind === "root") {
      e.preventDefault();
      const i = CHIPS.findIndex((c) => c.kind === activeChip);
      const next = (i + (e.shiftKey ? CHIPS.length - 1 : 1)) % CHIPS.length;
      setChip(CHIPS[next].kind);
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); popStep(); return; }
    if (e.key === "Backspace" && query === "" && stack.length > 1) {
      e.preventDefault(); popStep(); return;
    }
    if (step.kind === "input") {
      if (e.key === "Enter") { e.preventDefault(); submitInput(); }
      return; // input step has no list nav
    }
    if (e.key === "ArrowDown") {
      e.preventDefault(); setActiveIndex((i) => Math.min(navRows.length - 1, i + 1)); return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); return;
    }
    if (e.key === "Enter") { e.preventDefault(); activate(navRows[activeIndex]); return; }
    if (e.key === "Tab") {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) { e.preventDefault(); inputRef.current?.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) { e.preventDefault(); last.focus(); }
      } else {
        if (activeEl === last || !root.contains(activeEl)) { e.preventDefault(); first.focus(); }
      }
    }
  };

  const sectionHeader = (label: string, count: number) => (
    <div style={{
      padding: "8px 12px 2px", fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)",
      color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {label} <span style={{ color: "var(--fg-3)" }}>({count})</span>
    </div>
  );

  const renderRow = (row: ScoredRow, flatIndex: number) => {
    const { item, labelIndices } = row;
    const active = flatIndex === activeIndex;
    const chord = item.chord
      ? formatChord(item.chord)
      : item.actionId
        ? chordFor(item.actionId)
        : "";
    return (
      <div
        key={item.id}
        data-pal-index={flatIndex}
        data-pal-type={item.type}
        onClick={() => activate(row)}
        onMouseEnter={() => setActiveIndex(flatIndex)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          height: "calc(30px + var(--row-step))", padding: "0 12px",
          background: active ? "var(--bg-selection)" : "transparent", cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
        }}
      >
        <PGIcon name={item.icon} size={13} style={{ color: "var(--fg-2)" }} />
        <span title={item.label} style={{
          flexShrink: 0, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: item.danger ? "var(--git-removed)" : "var(--fg-0)",
        }}>
          {highlight(item.label, labelIndices)}
        </span>
        <span style={{
          flex: 1, minWidth: 0, textAlign: "right", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: "var(--fg-3)", fontSize: "var(--fs-10)",
        }} title={item.detail}>
          {item.detail}
        </span>
        {chord && (
          <kbd data-pal-chord="" style={{ flexShrink: 0, color: "var(--fg-2)" }}>
            {chord}
          </kbd>
        )}
      </div>
    );
  };

  let runningIndex = 0;

  // Breadcrumb of step titles (root excluded).
  const crumbs = stack
    .map((s) => (s.kind === "root" ? null : s.title))
    .filter((t): t is string => t != null);

  const placeholder =
    step.kind === "input" ? step.placeholder
    : step.kind === "pick" ? `Filter ${step.title.toLowerCase()}…`
    : "Search branches, files, commits, commands…";

  const content = (
    <div
      role="dialog" aria-modal="true" aria-label="Command palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200, display: "flex",
        justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh",
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div
        ref={dialogRef} onKeyDown={onKeyDown}
        style={{
          width: WIDTH, maxWidth: "90vw", maxHeight: "60vh", background: "var(--bg-1)",
          border: "1px solid var(--border-1)", borderRadius: "var(--r-3)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)", display: "flex",
          flexDirection: "column", overflow: "hidden",
        }}
      >
        {crumbs.length > 0 && (
          <div style={{
            padding: "6px 12px", borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)", color: "var(--fg-2)",
          }}>
            {crumbs.join(" › ")}
          </div>
        )}
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query} onChange={setQuery} placeholder={placeholder} inputRef={inputRef}
          />
          {step.kind === "input" && inputError && (
            <div style={{
              padding: "4px 4px 0", fontSize: "var(--fs-10)",
              color: "var(--git-removed)", fontFamily: "var(--font-mono)",
            }}>
              {inputError}
            </div>
          )}
          {step.kind === "root" && (
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {CHIPS.map((c) => (
                <button
                  key={c.kind}
                  onClick={() => setChip(c.kind)}
                  aria-pressed={activeChip === c.kind}
                  style={{
                    padding: "2px 8px", borderRadius: "var(--r-2)",
                    fontFamily: "var(--font-mono)", fontSize: "var(--fs-10)",
                    border: "1px solid var(--border-1)", cursor: "pointer",
                    background: activeChip === c.kind ? "var(--color-accent)" : "transparent",
                    color: activeChip === c.kind ? "var(--bg-0)" : "var(--fg-2)",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {step.kind === "input" ? (
          <div style={{
            padding: 12, fontSize: "var(--fs-11)", color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
          }}>
            Press Enter to confirm · Esc to go back
          </div>
        ) : (
          <div ref={listRef} style={{ flex: 1, overflow: "auto", paddingBottom: 4 }}>
            {showEmptyHome ? (
              <>
                {quickRows.length > 0 && sectionHeader("Quick actions", quickRows.length)}
                {quickRows.map((item) =>
                  renderRow({ item, score: 0, labelIndices: [] }, runningIndex++),
                )}
                {recentRows.length > 0 && sectionHeader("Recent", recentRows.length)}
                {recentRows.map((item) =>
                  renderRow({ item, score: 0, labelIndices: [] }, runningIndex++),
                )}
              </>
            ) : flat.length === 0 ? (
              <div style={{
                padding: 16, fontSize: "var(--fs-12)", color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}>
                {query ? `No matches for "${query}".` : "Type to search."}
              </div>
            ) : step.kind === "pick" ? (
              flat.map((row) => renderRow(row, runningIndex++))
            ) : (
              (activeChip === "all" ? groups : groups.filter((g) => g.type === activeChip)).map((g) => (
                <React.Fragment key={g.type}>
                  {sectionHeader(TYPE_LABEL[g.type], g.rows.length)}
                  {g.rows.map((item) => renderRow(item, runningIndex++))}
                </React.Fragment>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
