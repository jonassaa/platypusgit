import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { WordSpan } from "@/lib/wordDiff";
import { pairChangedLines } from "@/lib/pairChangedLines";
import { withChangedIndices } from "@/lib/diffRows";
import { buildLineSpans } from "@/lib/lineSpans";
import type { SyntaxLine, SyntaxToken } from "@/lib/syntax";
import { PGIcon, type IconName } from "./icons";
import {
  PGBadge,
  PGAvatar,
  PGBranchPill,
  PGStatusMark,
  PGButton,
  PGIconButton,
  PGTooltip,
  PGCheckbox,
  PGSelect,
} from "./primitives";
import { useDensityStep } from "@/features/settings/useSettingsStore";
import { FOLDER_ICON_COLOR, fileIconSpec } from "@/lib/fileIcon";
import { commitRowGrid, laneX } from "./graph-geometry";
import type { WindowRange } from "@/lib/useWindowedList";

// ═════════════════════════════════════════════════════════
// FILE TREE
// ═════════════════════════════════════════════════════════

export interface PGFileTreeNode {
  name: string;
  status?: string;
  defaultExpanded?: boolean;
  children?: PGFileTreeNode[];
  extra?: ReactNode;
}

/**
 * Staged-ness of a tree row. Folders are tri-state over their descendants:
 * "all" every stageable leaf fully staged, "none" none of them, "partial"
 * anything in between (including a single file with both staged and unstaged
 * changes). `undefined` means the row isn't stageable at all — no checkbox.
 */
export type PGStageState = "none" | "partial" | "all";

export interface PGFileTreeRowProps {
  name: string;
  path?: string;
  indent?: number;
  kind?: "file" | "folder";
  status?: string;
  expanded?: boolean;
  hasChildren?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  extra?: ReactNode;
  hideStatus?: boolean;
  /** Tri-state staging checkbox. Omit for a row that can't be staged. */
  stageState?: PGStageState;
  /** Reserve the checkbox column even when this row has no `stageState`, so
   *  rows stay aligned in a tree where only some rows are stageable. */
  stageSlot?: boolean;
  onStageToggle?: (next: boolean) => void;
}

export function PGFileTreeRow({
  name,
  path,
  indent = 0,
  kind = "file",
  status,
  expanded,
  hasChildren,
  selected,
  onToggle,
  onClick,
  onContextMenu,
  extra,
  hideStatus,
  stageState,
  stageSlot,
  onStageToggle,
}: PGFileTreeRowProps) {
  const [hover, setHover] = React.useState(false);
  // Folders keep the shared accent tint; files resolve a per-type glyph + tint
  // from their path (falling back to `name` for callers that pass no path).
  const glyph =
    kind === "folder"
      ? { icon: (expanded ? "folderOpen" : "folder") as IconName, color: FOLDER_ICON_COLOR }
      : fileIconSpec(path ?? name);
  return (
    <div
      data-path={path}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: "var(--row-h)",
        paddingLeft: 4 + indent * 12,
        paddingRight: 8,
        fontSize: "var(--fs-12)",
        fontFamily: "var(--font-mono)",
        // Selected background comes from the focus-aware [data-pg-row] CSS.
        background: !selected && hover ? "var(--bg-2)" : undefined,
        color: status === "I" ? "var(--fg-3)" : "var(--fg-0)",
        cursor: "pointer",
        userSelect: "none",
        position: "relative",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 3,
            bottom: 3,
            width: 2,
            background: "var(--accent)",
            borderRadius: 1,
          }}
        />
      )}
      <span
        onClick={(e) => {
          if (hasChildren) {
            e.stopPropagation();
            onToggle?.();
          }
        }}
        style={{ width: 12, display: "inline-flex", color: "var(--fg-3)" }}
      >
        {hasChildren && (
          <PGIcon name={expanded ? "chevronDown" : "chevronRight"} size={10} />
        )}
      </span>
      {stageState !== undefined ? (
        <span
          data-testid="tree-row-toggle"
          // The checkbox owns its click: selecting the row underneath as well
          // would move the selection every time you stage something.
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", flexShrink: 0 }}
        >
          <PGCheckbox
            checked={stageState === "all"}
            indeterminate={stageState === "partial"}
            onChange={(v) => onStageToggle?.(v)}
          />
        </span>
      ) : (
        stageSlot && <span style={{ width: 14, flexShrink: 0 }} />
      )}
      <PGIcon name={glyph.icon} size={12} style={{ color: glyph.color }} />
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </span>
      {extra}
      {status && !hideStatus && <PGStatusMark kind={status} size={14} />}
    </div>
  );
}

export interface PGFileTreeProps {
  nodes: PGFileTreeNode[];
  expanded?: Record<string, boolean>;
  /**
   * Fold/unfold a folder. `nextExpanded` is computed here rather than left to
   * the caller: a row's current state is `expanded[key] ?? node.defaultExpanded`,
   * so a caller writing `!expanded[key]` gets it wrong for every
   * default-expanded folder — the first click would re-set `true` and appear
   * to do nothing.
   */
  onToggle?: (key: string, nextExpanded: boolean) => void;
  selected?: string;
  /** Extra keys rendered as selected (multi-select). `selected` stays the primary row. */
  selectedKeys?: ReadonlySet<string>;
  onSelect?: (key: string, node: PGFileTreeNode, e?: MouseEvent) => void;
  onRowContextMenu?: (e: MouseEvent, key: string, node: PGFileTreeNode) => void;
  showStatus?: boolean;
  /**
   * Staging column. Return a state per row key to render its checkbox, or
   * `undefined` for a row that can't be staged (unmodified file, embedded
   * repo, empty folder). Omit the prop entirely to hide the column — the
   * reserved slot only appears once some row in the tree is stageable.
   */
  stageState?: (key: string, node: PGFileTreeNode) => PGStageState | undefined;
  onStageToggle?: (key: string, node: PGFileTreeNode, next: boolean) => void;
  /**
   * Render only rows `[start, end)`, with spacers standing in for the rest
   * (#61 A8). Omit to render every row — every caller that does behaves
   * exactly as before.
   *
   * The caller owns the range because it also owns the scroll element and the
   * `flattenFileTree` result that drives `usePaneList`; indices therefore mean
   * the same row on both sides.
   */
  window?: WindowRange;
}

export interface PGFileTreeFlatNode {
  key: string;
  node: PGFileTreeNode;
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

/**
 * Visible rows of the tree in render order — the same flattening PGFileTree
 * renders from. Exported so callers can compute shift-click ranges over the
 * visible row order.
 */
export function flattenFileTree(
  nodes: PGFileTreeNode[],
  expanded: Record<string, boolean>,
): PGFileTreeFlatNode[] {
  const out: PGFileTreeFlatNode[] = [];
  const walk = (list: PGFileTreeNode[], indent: number, parentKey: string) => {
    for (const node of list) {
      const key = parentKey + "/" + node.name;
      const hasChildren = !!node.children && node.children.length > 0;
      const isExpanded =
        expanded[key] !== undefined ? expanded[key] : !!node.defaultExpanded;
      out.push({ key, node, indent, hasChildren, isExpanded });
      if (hasChildren && isExpanded) walk(node.children!, indent + 1, key);
    }
  };
  walk(nodes, 0, "");
  return out;
}

/**
 * Base row height in px, matching `--row-h: calc(24px + var(--row-step))`
 * (`index.css`). A windowing caller needs the pitch as a NUMBER and must add
 * `useDensityStep()`; a literal would desync the window from the rows in
 * comfortable density (#70). Keep in sync with the token.
 */
export const FILE_TREE_ROW_BASE_H = 24;

export function PGFileTree({
  nodes,
  expanded = {},
  onToggle,
  selected,
  selectedKeys,
  onSelect,
  onRowContextMenu,
  showStatus = true,
  stageState,
  onStageToggle,
  window: win,
}: PGFileTreeProps) {
  const flat = flattenFileTree(nodes, expanded);
  const rowStage = flat.map((f) => stageState?.(f.key, f.node));
  // Reserve the checkbox column for the whole tree as soon as one row uses it,
  // so a mixed tree (changed + unmodified files) keeps its names aligned.
  // Computed over EVERY row, not the visible slice: deriving it from the
  // window would make the column appear and disappear while scrolling.
  const stageSlot = rowStage.some((s) => s !== undefined);
  const range = win ?? { start: 0, end: flat.length, topPad: 0, bottomPad: 0 };

  // Keyboard navigation lives with the owning screen, not here: it goes
  // through the keymap's `usePaneList` so the tree gets the same arrow keys,
  // Home/End, Shift+Arrow ranges, Space-to-stage and type-to-jump
  // speed-search as every flat pane, and so a bare ArrowDown isn't handled
  // twice (once by the dispatcher, once by a local onKeyDown).
  return (
    <div
      tabIndex={0}
      style={{ outline: "none" }}
      data-pg-focus-target=""
      className="focusable"
    >
      {range.topPad > 0 && (
        <div data-tree-spacer="top" style={{ height: range.topPad }} />
      )}
      {flat.slice(range.start, range.end).map((f, sliceIndex) => {
        const i = range.start + sliceIndex;
        return (
        <PGFileTreeRow
          key={f.key}
          name={f.node.name}
          path={f.key.replace(/^\//, "")}
          indent={f.indent}
          kind={f.hasChildren ? "folder" : "file"}
          status={f.node.status}
          hideStatus={!showStatus}
          stageState={rowStage[i]}
          stageSlot={stageSlot}
          onStageToggle={(next) => onStageToggle?.(f.key, f.node, next)}
          expanded={f.isExpanded}
          hasChildren={f.hasChildren}
          selected={selected === f.key || !!selectedKeys?.has(f.key)}
          onClick={(e) => {
            onSelect?.(f.key, f.node, e);
            if (f.hasChildren && !e.metaKey && !e.ctrlKey && !e.shiftKey)
              onToggle?.(f.key, !f.isExpanded);
          }}
          onToggle={() => onToggle?.(f.key, !f.isExpanded)}
          onContextMenu={
            onRowContextMenu
              ? (e) => onRowContextMenu(e, f.key, f.node)
              : undefined
          }
          extra={f.node.extra}
        />
        );
      })}
      {range.bottomPad > 0 && (
        <div data-tree-spacer="bottom" style={{ height: range.bottomPad }} />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// CHANGE LIST
// ═════════════════════════════════════════════════════════

export interface PGChangeRowProps {
  path: string;
  status: string;
  staged?: boolean;
  onToggle?: (v: boolean) => void;
  selected?: boolean;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  additions?: number;
  deletions?: number;
  renamed?: string;
}

export function PGChangeRow({
  path,
  status,
  staged,
  onToggle,
  selected,
  onClick,
  onContextMenu,
  additions,
  deletions,
  renamed,
}: PGChangeRowProps) {
  const [hover, setHover] = React.useState(false);
  const parts = path.split("/");
  const file = parts.pop();
  const dir = parts.join("/");
  const glyph = fileIconSpec(path);
  return (
    <div
      data-path={path}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: "var(--row-h)",
        padding: "0 8px",
        background: !selected && hover ? "var(--bg-2)" : undefined,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        position: "relative",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 3,
            bottom: 3,
            width: 2,
            background: "var(--accent)",
            borderRadius: 1,
          }}
        />
      )}
      {staged !== undefined && (
        <span data-testid="row-toggle">
          <PGCheckbox
            checked={staged}
            onChange={(v) => {
              onToggle?.(v);
            }}
          />
        </span>
      )}
      <PGStatusMark kind={status} size={14} />
      <PGIcon
        name={glyph.icon}
        size={11}
        style={{ color: glyph.color, flexShrink: 0 }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          overflow: "hidden",
        }}
        title={path}
      >
        <span
          style={{
            color: "var(--fg-0)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
            maxWidth: "60%",
          }}
        >
          {file}
        </span>
        {dir && (
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: "var(--fs-11)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              direction: "rtl",
              textAlign: "left",
              minWidth: 0,
              flex: 1,
            }}
          >
            {dir}
          </span>
        )}
      </span>
      {renamed && (
        <span
          style={{
            color: "var(--git-renamed)",
            fontSize: "var(--fs-11)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ← {renamed}
        </span>
      )}
      {(additions || deletions) ? (
        <div
          style={{
            display: "flex",
            gap: 4,
            fontSize: "var(--fs-10)",
            flexShrink: 0,
          }}
        >
          {additions ? (
            <span style={{ color: "var(--git-added)" }}>+{additions}</span>
          ) : null}
          {deletions ? (
            <span style={{ color: "var(--git-removed)" }}>−{deletions}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// DIFF
// ═════════════════════════════════════════════════════════

export type DiffLineKind = "ctx" | "add" | "rem" | "hunk" | "info" | "empty";

export interface DiffLineData {
  kind: DiffLineKind;
  lnL?: number | string;
  lnR?: number | string;
  ln?: number | string;
  text?: string;
  /**
   * Intra-line word spans, present when this line is half of a matched rem/add
   * pair (#61 D8). Set by the renderer's pairing pass, not by callers.
   */
  spans?: WordSpan[];
  /**
   * Index among the hunk's changed (`+`/`-`) lines, counted from 0; undefined
   * for context rows. This is the index space the line-staging backend ops use
   * (#61 D7) — assigned by `PGHunk`, not by callers.
   */
  changedIndex?: number;
  /**
   * Line-relative syntax tokens for this row. Set by `PGHunk` from its `syntax`
   * prop, or directly by a caller rendering a standalone `PGDiffLine`;
   * undefined renders the line unhighlighted.
   */
  syntax?: SyntaxToken[];
}

export function PGDiffLine({
  kind = "ctx",
  lnL,
  lnR,
  text,
  spans,
  syntax,
}: DiffLineData) {
  const bg: Record<DiffLineKind, string> = {
    ctx: "transparent",
    add: "var(--git-added-bg)",
    rem: "var(--git-removed-bg)",
    hunk: "oklch(from var(--accent) l c h / 0.1)",
    info: "var(--bg-2)",
    empty: "var(--bg-2)",
  };
  const marker: Record<DiffLineKind, string> = {
    add: "+",
    rem: "−",
    ctx: " ",
    hunk: "@",
    info: "i",
    empty: "",
  };
  const color: Record<DiffLineKind, string> = {
    ctx: "var(--fg-1)",
    add: "var(--git-added)",
    rem: "var(--git-removed)",
    hunk: "var(--accent)",
    info: "var(--fg-2)",
    empty: "var(--fg-3)",
  };

  if (kind === "hunk") {
    return (
      <div
        style={{
          display: "flex",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          background: bg.hunk,
          color: "var(--fg-2)",
          padding: "2px 0",
          borderTop: "1px solid var(--border-0)",
          borderBottom: "1px solid var(--border-0)",
        }}
      >
        <span
          style={{
            width: 80,
            flexShrink: 0,
            color: "var(--fg-3)",
            textAlign: "right",
            paddingRight: 10,
          }}
        >
          @@
        </span>
        <span style={{ padding: "0 12px", color: "var(--accent)" }}>{text}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        background: bg[kind],
        lineHeight: "var(--lh-code)",
        minHeight: 18,
      }}
    >
      <span
        style={{
          width: 40,
          flexShrink: 0,
          textAlign: "right",
          paddingRight: 6,
          color: "var(--fg-3)",
          userSelect: "none",
          borderRight: "1px solid var(--border-0)",
        }}
      >
        {lnL ?? ""}
      </span>
      <span
        style={{
          width: 40,
          flexShrink: 0,
          textAlign: "right",
          paddingRight: 6,
          color: "var(--fg-3)",
          userSelect: "none",
          borderRight: "1px solid var(--border-0)",
        }}
      >
        {lnR ?? ""}
      </span>
      <span
        style={{
          width: 20,
          flexShrink: 0,
          textAlign: "center",
          color: color[kind],
          userSelect: "none",
        }}
      >
        {marker[kind]}
      </span>
      <span
        style={{
          flex: 1,
          whiteSpace: "pre-wrap",
          color: kind === "ctx" ? "var(--fg-0)" : color[kind],
          paddingRight: 10,
        }}
      >
        <DiffText text={text ?? ""} spans={spans} syntax={syntax} kind={kind} />
      </span>
    </div>
  );
}

interface DiffChunk {
  kind: DiffLineKind;
  lines: DiffLineData[];
}

function chunkDiffLines(lines: DiffLineData[]): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  for (const ln of lines) {
    const last = chunks[chunks.length - 1];
    if (last && last.kind === ln.kind) {
      last.lines.push(ln);
    } else {
      chunks.push({ kind: ln.kind, lines: [ln] });
    }
  }
  return chunks;
}


/**
 * Attach each row's syntax tokens from the correct side of the diff.
 *
 * A `rem` row is a line of the OLD file and reads `old[lnL - 1]`; `add` and
 * `ctx` rows show new text and read `new[lnR - 1]`, falling back to `lnL` so a
 * deleted file's rows still resolve. Anything unresolvable is left plain rather
 * than guessed — a wrong index would colour a line with another line's tokens.
 */
function attachSyntax(
  lines: DiffLineData[],
  syntax: { old: SyntaxLine[] | null; new: SyntaxLine[] | null } | undefined,
): DiffLineData[] {
  if (!syntax) return lines;
  return lines.map((l) => {
    const side = l.kind === "rem" ? syntax.old : syntax.new;
    if (!side) return l;
    const raw = l.kind === "rem" ? l.lnL : (l.lnR ?? l.lnL);
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1) return l;
    const tokens = side[n - 1];
    return tokens ? { ...l, syntax: tokens } : l;
  });
}

/**
 * Attach intra-line word spans to adjacent rem/add chunk pairs (#61 D8).
 *
 * `chunkDiffLines` groups **by kind**, so a removed run and the added run that
 * follows it are two ADJACENT chunks — pairing crosses that pair rather than
 * happening inside one chunk. The pairing rule itself lives in
 * `@/lib/pairChangedLines`, shared with the split view and the commit-diff panel.
 */
function withWordSpans(chunks: DiffChunk[]): DiffChunk[] {
  const out = chunks.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l })) }));
  for (let i = 0; i + 1 < out.length; i++) {
    const rem = out[i];
    const add = out[i + 1];
    if (rem.kind !== "rem" || add.kind !== "add") continue;
    const paired = pairChangedLines(
      rem.lines.map((l) => l.text ?? ""),
      add.lines.map((l) => l.text ?? ""),
    );
    paired.forEach((p, k) => {
      if (!p) return;
      rem.lines[k].spans = p.old;
      add.lines[k].spans = p.new;
    });
  }
  return out;
}

/**
 * Render one line as spans, combining syntax classes and word-diff emphasis.
 *
 * Both come from buildLineSpans, which tiles the line — so this maps and never
 * reasons about gaps or overlaps. The changed-span tint stays relative to the
 * existing git tokens so custom and light themes carry through.
 */
function DiffText({
  text,
  spans,
  syntax,
  kind,
}: {
  text: string;
  spans?: WordSpan[];
  syntax?: SyntaxToken[];
  kind: DiffLineKind;
}) {
  const rendered = React.useMemo(
    () => buildLineSpans(text, syntax ?? null, spans),
    [text, syntax, spans],
  );
  // Nothing to mark: emit the bare string so the DOM stays as light as it was
  // before highlighting existed.
  if (rendered.length === 0) return <>{text}</>;
  if (rendered.length === 1 && !rendered[0].cls && !rendered[0].changed) {
    return <>{text}</>;
  }
  const tint =
    kind === "add"
      ? "oklch(from var(--git-added) l c h / 0.28)"
      : "oklch(from var(--git-removed) l c h / 0.28)";
  return (
    <>
      {rendered.map((s, i) => (
        <span
          key={i}
          className={s.cls}
          data-testid={s.changed ? "word-change" : undefined}
          style={s.changed ? { background: tint, borderRadius: 2 } : undefined}
        >
          {text.slice(s.start, s.end)}
        </span>
      ))}
    </>
  );
}

function PGDiffChunk({
  chunk,
  selectedLines,
  onLineClick,
}: {
  chunk: DiffChunk;
  selectedLines?: number[];
  onLineClick?: (changedIndex: number, range: boolean) => void;
}) {
  const { kind, lines } = chunk;
  const bg: Partial<Record<DiffLineKind, string>> = {
    add: "var(--git-added-bg)",
    rem: "var(--git-removed-bg)",
    hunk: "oklch(from var(--accent) l c h / 0.1)",
    info: "var(--bg-2)",
  };
  const borderColor: Partial<Record<DiffLineKind, string>> = {
    add: "var(--git-added-gutter)",
    rem: "var(--git-removed-gutter)",
  };
  const marker: Record<DiffLineKind, string> = {
    add: "+",
    rem: "−",
    ctx: " ",
    hunk: "@",
    info: "i",
    empty: "",
  };
  const textColor: Record<DiffLineKind, string> = {
    ctx: "var(--fg-0)",
    add: "var(--git-added)",
    rem: "var(--git-removed)",
    hunk: "var(--accent)",
    info: "var(--fg-2)",
    empty: "var(--fg-3)",
  };

  if (kind === "hunk" || kind === "info") {
    return (
      <>
        {lines.map((ln, i) => (
          <PGDiffLine key={i} {...ln} />
        ))}
      </>
    );
  }

  return (
    <div
      style={{
        background: bg[kind] ?? "transparent",
        borderLeft:
          borderColor[kind] !== undefined
            ? `2px solid ${borderColor[kind]}`
            : "2px solid transparent",
      }}
    >
      {lines.map((ln, i) => {
        const selectable = onLineClick != null && ln.changedIndex != null;
        const isSelected =
          ln.changedIndex != null &&
          (selectedLines?.includes(ln.changedIndex) ?? false);
        return (
        <div
          key={i}
          data-testid={selectable ? "diff-line-changed" : undefined}
          data-selected={isSelected || undefined}
          onClick={
            selectable
              ? (e) => onLineClick!(ln.changedIndex!, e.shiftKey)
              : undefined
          }
          style={{
            display: "flex",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            lineHeight: "var(--lh-code)",
            minHeight: 18,
            cursor: selectable ? "pointer" : undefined,
            background: isSelected
              ? "oklch(from var(--accent) l c h / 0.18)"
              : undefined,
          }}
        >
          <span
            style={{
              width: 40,
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 6,
              color: "var(--fg-3)",
              userSelect: "none",
              borderRight: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            {ln.lnL ?? ""}
          </span>
          <span
            style={{
              width: 40,
              flexShrink: 0,
              textAlign: "right",
              paddingRight: 6,
              color: "var(--fg-3)",
              userSelect: "none",
              borderRight: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            {ln.lnR ?? ""}
          </span>
          <span
            style={{
              width: 20,
              flexShrink: 0,
              textAlign: "center",
              color: textColor[kind],
              userSelect: "none",
            }}
          >
            {marker[kind]}
          </span>
          <span
            style={{
              flex: 1,
              whiteSpace: "pre-wrap",
              color: kind === "ctx" ? "var(--fg-0)" : textColor[kind],
              paddingRight: 10,
            }}
          >
            <DiffText
              text={ln.text ?? ""}
              spans={ln.spans}
              syntax={ln.syntax}
              kind={kind}
            />
          </span>
        </div>
        );
      })}
    </div>
  );
}

export interface PGHunkProps {
  header: string;
  lines?: DiffLineData[];
  staged?: boolean;
  onStage?: () => void;
  onDiscard?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Disable Stage/Discard and explain why on hover. Set while the diff is
   * whitespace-ignoring: those hunks are a rewritten view, so their indices
   * don't address the hunks git would apply (#61 D2). It also suppresses line
   * selection, for the same reason (#61 D7).
   */
  actionsDisabledReason?: string;
  /**
   * Selected changed-line indices within this hunk (#61 D7). Selection STATE
   * belongs to the owning screen, not here — a primitive owning it plus the
   * global key dispatcher would both answer the same input and the selection
   * would move twice.
   */
  selectedLines?: number[];
  /** Called with a changed-line index; `range` is true for a shift-click. */
  onLineClick?: (changedIndex: number, range: boolean) => void;
  /**
   * Per-side syntax tokens for the WHOLE file, indexed by line number - 1.
   *
   * A `rem` row reads `old`; `add` and `ctx` rows read `new` — context rows show
   * the new text, and for unchanged lines the two sides agree anyway. A row whose
   * line number is missing, or past the end of its array, renders plain.
   */
  syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
}

export function PGHunk({
  header,
  lines = [],
  staged,
  onStage,
  onDiscard,
  expanded = true,
  onToggle,
  actionsDisabledReason,
  selectedLines,
  onLineClick,
  syntax,
}: PGHunkProps) {
  // Memoized: word diffing every rem/add pair on each render would repeat over
  // lists that are long and windowed.
  //
  // withChangedIndices runs FIRST and over the whole hunk: its numbering is the
  // wire contract shared with the backend's Patch::line_in_hunk (#61 D7), so it
  // must not depend on anything the syntax pass does.
  const chunks = React.useMemo(
    () => withWordSpans(chunkDiffLines(attachSyntax(withChangedIndices(lines), syntax))),
    [lines, syntax],
  );
  // Line selection is meaningless when the hunk's own indices don't address
  // what git would apply — the same condition that disables Stage/Discard.
  const lineClick = actionsDisabledReason ? undefined : onLineClick;
  const selCount = selectedLines?.length ?? 0;
  return (
    <div style={{ borderBottom: "1px solid var(--border-0)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: "calc(26px + var(--row-step))",
          padding: "0 8px",
          background: "var(--bg-2)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
        }}
      >
        <PGIconButton
          icon={expanded ? "chevronDown" : "chevronRight"}
          size="sm"
          onClick={onToggle}
        />
        <span style={{ color: "var(--accent)" }}>@@ {header} @@</span>
        <div style={{ flex: 1 }} />
        <PGButton
          size="xs"
          variant="ghost"
          onClick={onDiscard}
          icon="x"
          disabled={!!actionsDisabledReason}
          title={actionsDisabledReason}
        >
          Discard
        </PGButton>
        <PGButton
          data-testid="hunk-stage"
          size="xs"
          variant={staged ? "outline" : "primary"}
          onClick={onStage}
          icon={staged ? "check" : "plus"}
          disabled={!!actionsDisabledReason}
          title={actionsDisabledReason}
        >
          {selCount > 0
            ? `${staged ? "Unstage" : "Stage"} ${selCount} lines`
            : staged
              ? "Staged"
              : "Stage hunk"}
        </PGButton>
      </div>
      {expanded && (
        <div>
          {chunks.map((c, i) => (
            <PGDiffChunk
              key={i}
              chunk={c}
              selectedLines={selectedLines}
              onLineClick={lineClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface SideLine {
  kind: DiffLineKind;
  ln?: number | string;
  text?: string;
  /** Intra-line word spans, set by the caller's pairing pass (`diffToSplit`). */
  spans?: WordSpan[];
  /** Line-relative syntax tokens for this row's side of the diff. */
  syntax?: SyntaxToken[];
}

export function PGSideBySideDiff({
  left = [],
  right = [],
}: {
  left?: SideLine[];
  right?: SideLine[];
}) {
  const col = (lines: SideLine[], side: "l" | "r") => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        borderRight: side === "l" ? "1px solid var(--border-0)" : undefined,
        overflow: "auto",
      }}
    >
      {lines.map((ln, i) => {
        const bg =
          ln.kind === "add"
            ? "var(--git-added-bg)"
            : ln.kind === "rem"
              ? "var(--git-removed-bg)"
              : ln.kind === "empty"
                ? "var(--bg-2)"
                : "transparent";
        return (
          <div
            key={i}
            style={{
              display: "flex",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
              lineHeight: "var(--lh-code)",
              minHeight: 18,
              background: bg,
            }}
          >
            <span
              style={{
                width: 40,
                textAlign: "right",
                paddingRight: 6,
                color: "var(--fg-3)",
                borderRight: "1px solid var(--border-0)",
                flexShrink: 0,
              }}
            >
              {ln.ln ?? ""}
            </span>
            <span
              style={{
                flex: 1,
                padding: "0 8px",
                whiteSpace: "pre-wrap",
                color:
                  ln.kind === "add"
                    ? "var(--git-added)"
                    : ln.kind === "rem"
                      ? "var(--git-removed)"
                      : "var(--fg-0)",
              }}
            >
              <DiffText
                text={ln.text ?? ""}
                spans={ln.spans}
                syntax={ln.syntax}
                kind={ln.kind}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {col(left, "l")}
      {col(right, "r")}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// GRAPH + COMMIT ROW
// ═════════════════════════════════════════════════════════

/** Dash pattern for an elided link — visibly broken at a 1.5px stroke. */
const ELIDED_DASH = "3 3";

/** Stroke weight: HEAD's first-parent chain is followable at a glance (#68 G6). */
const strokeW = (ln: GraphLane): number => (ln.primary ? 2 : 1.5);

/** Extra width of the background casing drawn under a curve. */
const CASING_EXTRA = 2.5;

const STRAIGHT_KINDS: ReadonlySet<GraphLane["kind"]> = new Set([
  "line",
  "half-top",
  "half-bot",
]);

/** y-extent of each straight kind, in SVG user units. */
const straightY = (
  kind: GraphLane["kind"],
  height: number,
): [number, number] => {
  if (kind === "half-top") return [0, height / 2];
  if (kind === "half-bot") return [height / 2, height];
  return [0, height];
};

/** Curve path for the two bezier kinds. Shared by the casing and the stroke. */
const curvePath = (ln: GraphLane, height: number): string => {
  const x = laneX(ln.col);
  const x2 = laneX(ln.to ?? ln.col + 1);
  return ln.kind === "fork-bot"
    ? `M ${x} ${height / 2} C ${x} ${height * 0.75}, ${x2} ${height * 0.75}, ${x2} ${height}`
    : `M ${x} 0 C ${x} ${height * 0.25}, ${x2} ${height * 0.25}, ${x2} ${height / 2}`;
};

export interface GraphLane {
  col: number;
  color: string;
  kind: "line" | "half-top" | "half-bot" | "fork-bot" | "merge-top";
  to?: number;
  /**
   * The link this lane segment belongs to skipped at least one commit — a
   * filter or the log window removed the commits in between. Rendered dashed.
   * A flag rather than a lane kind because an elided link must render as a
   * straight run, a half-lane, AND a curve depending on the row.
   */
  dashed?: boolean;
  /**
   * This segment is on HEAD's first-parent chain. Drawn heavier so the branch
   * you are actually on is followable at a glance (#68 G6).
   */
  primary?: boolean;
}

export interface GraphNode {
  col: number;
  color: string;
  solid?: boolean;
  merge?: boolean;
  /**
   * The commit has parents, but none of them resolve to anything in the loaded
   * window — so the lane ends here with a stub rather than running to the
   * bottom of the log. Distinct from a true root, which has no parents at all.
   */
  truncated?: boolean;
  /** This commit is HEAD. Drawn as a double ring (#68 G7). */
  head?: boolean;
}

/**
 * `height` is REQUIRED and must be the caller's actual row pitch in px.
 *
 * The lane geometry below is in SVG user units (`y2={height}`, bezier control
 * points at `height / 2`), so it cannot read `--row-step` — a default here
 * would silently draw at one pitch while density moved the rows to another,
 * leaving lanes that don't meet between rows. Callers derive the number from
 * `useDensityStep()`; see `PGCommitRow`.
 *
 * `width` is REQUIRED for the same reason of principle: it must come from
 * `graphWidth(maxCol)`. The old `width = 140` default is exactly what let lanes
 * in column 9 and beyond fall outside the SVG viewport and vanish, node dot
 * included, with no overflow and no warning (#68 G1).
 */
export const PGGraphRow = React.memo(function PGGraphRow({
  lanes = [],
  node,
  width,
  height,
  clamped,
}: {
  lanes?: GraphLane[];
  node?: GraphNode;
  width: number;
  height: number;
  /** Lane count exceeds what the clamped width can show — fade the right edge. */
  clamped?: boolean;
}) {
  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
      {/* Straights first: SVG paint order is document order, so every vertical
          must be on the canvas before a curve's casing can bridge across it. */}
      {lanes
        .filter((ln) => STRAIGHT_KINDS.has(ln.kind))
        .map((ln, i) => {
          const x = laneX(ln.col);
          const [y1, y2] = straightY(ln.kind, height);
          return (
            <line
              key={`s${i}`}
              data-lane-kind={ln.kind}
              x1={x}
              x2={x}
              y1={y1}
              y2={y2}
              stroke={ln.color}
              strokeWidth={strokeW(ln)}
              strokeDasharray={ln.dashed ? ELIDED_DASH : undefined}
              shapeRendering="crispEdges"
            />
          );
        })}
      {/* Then each curve as casing + stroke. The casing is a gap punched in
          whatever it crosses, so it is never dashed. */}
      {lanes
        .filter((ln) => !STRAIGHT_KINDS.has(ln.kind))
        .map((ln, i) => {
          const d = curvePath(ln, height);
          return (
            <React.Fragment key={`c${i}`}>
              <path
                data-lane-casing="true"
                d={d}
                stroke="var(--bg-0)"
                strokeWidth={strokeW(ln) + CASING_EXTRA}
                fill="none"
              />
              <path
                data-lane-kind={ln.kind}
                d={d}
                stroke={ln.color}
                strokeWidth={strokeW(ln)}
                strokeDasharray={ln.dashed ? ELIDED_DASH : undefined}
                fill="none"
              />
            </React.Fragment>
          );
        })}
      {node && (
        <>
          {/* HEAD: a double ring. The outer circle sits outside the dot rather
              than replacing it, so hollow / solid / merge stay readable. */}
          {node.head && (
            <circle
              data-graph-head="true"
              cx={laneX(node.col)}
              cy={height / 2}
              r="6.5"
              fill="none"
              stroke={node.color}
              strokeWidth="1"
            />
          )}
          <circle
            cx={laneX(node.col)}
            cy={height / 2}
            r="4"
            fill="var(--bg-0)"
            stroke={node.color}
            strokeWidth="1.5"
          />
          {node.solid && (
            <circle cx={laneX(node.col)} cy={height / 2} r="2.5" fill={node.color} />
          )}
          {node.merge && (
            <circle
              cx={laneX(node.col)}
              cy={height / 2}
              r="4"
              fill={node.color}
              stroke="var(--bg-0)"
              strokeWidth="1.5"
            />
          )}
          {/* Parents exist but none survive in the loaded window: stop with a
              short dashed tick instead of a lane running off the bottom. */}
          {node.truncated && (
            <line
              data-graph-stub="true"
              x1={laneX(node.col)}
              x2={laneX(node.col)}
              y1={height / 2 + 6}
              y2={height / 2 + 11}
              stroke={node.color}
              strokeWidth="1.5"
              strokeDasharray="2 2"
              shapeRendering="crispEdges"
            />
          )}
        </>
      )}
      {/* More lanes exist than the clamped width can show. Fade the right edge
          so the cut reads as deliberate; the count of hidden lanes goes in the
          GRAPH column header, where a screen reader can reach it. */}
      {clamped && (
        <>
          <defs>
            <linearGradient id="pg-graph-clip-fade" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--bg-0)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--bg-0)" stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect
            data-graph-clamped="true"
            x={width - 16}
            y={0}
            width={16}
            height={height}
            fill="url(#pg-graph-clip-fade)"
          />
        </>
      )}
    </svg>
  );
});

export interface CommitRef {
  name: string;
  tone?: "accent" | "violet" | "green" | "amber" | "red";
  icon?: IconName | string;
  remote?: string;
}

export interface PGCommitRowProps {
  lanes?: GraphLane[];
  node?: GraphNode;
  sha: string;
  message: string;
  author: string;
  date: string;
  refs?: CommitRef[];
  selected?: boolean;
  /** Row identity, handed back to the shared handlers below. */
  oid?: string;
  /**
   * Shared across every row — callers pass one `useCallback` pair rather than a
   * closure per row, which is what lets React.memo actually skip rows whose own
   * props did not change (#68 G9).
   */
  onRowClick?: (oid: string, e: MouseEvent) => void;
  onRowContext?: (oid: string, e: MouseEvent) => void;
  tagged?: string;
  /**
   * Row height in px. Defaults to the density-derived height. Unlike every
   * other row surface this can't be a `--row-h` calc: PGGraphRow draws lanes
   * in SVG user units, so the row box and the gutter must share one NUMBER.
   */
  rowHeight?: number;
  /**
   * Width of the graph gutter in px, from `graphWidth(maxCol)`. Required for
   * the same reason as PGGraphRow's: a default is what hid #68 G1.
   *
   * `0` drops the graph column entirely — that is Reflog, which renders no
   * lanes. Not the same as `graphWidth(0)`, the 24px a real one-lane log needs.
   */
  graphW: number;
  /** Forwarded to PGGraphRow — fade the gutter's right edge. */
  clamped?: boolean;
}

export const COMMIT_ROW_BASE_H = 26;

export const PGCommitRow = React.memo(function PGCommitRow({
  lanes,
  node,
  sha,
  message,
  author,
  date,
  refs,
  selected,
  oid,
  onRowClick,
  onRowContext,
  tagged,
  rowHeight,
  graphW,
  clamped,
}: PGCommitRowProps) {
  const [hover, setHover] = React.useState(false);
  const step = useDensityStep();
  const h = rowHeight ?? COMMIT_ROW_BASE_H + step;
  return (
    <div
      data-testid="commit-row"
      data-sha={sha}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      onClick={
        onRowClick && oid !== undefined ? (e) => onRowClick(oid, e) : undefined
      }
      onContextMenu={
        onRowContext && oid !== undefined ? (e) => onRowContext(oid, e) : undefined
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: commitRowGrid(graphW),
        alignItems: "center",
        height: h,
        background: !selected && hover ? "var(--bg-2)" : undefined,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        cursor: "pointer",
        position: "relative",
        borderBottom: "1px solid oklch(from var(--border-0) l c h / 0.5)",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--accent)",
          }}
        />
      )}
      {graphW > 0 && (
        <PGGraphRow
          lanes={lanes}
          node={node}
          width={graphW}
          height={h}
          clamped={clamped}
        />
      )}
      <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}>{sha}</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          paddingRight: 10,
        }}
      >
        {refs?.map((r, i) => (
          <PGBranchPill
            key={i}
            name={r.name}
            tone={r.tone}
            icon={r.icon}
            remote={r.remote}
          />
        ))}
        {tagged && (
          <PGBadge tone="warn" icon="tag">
            {tagged}
          </PGBadge>
        )}
        <span
          style={{
            color: "var(--fg-0)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {message}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--fg-2)",
        }}
      >
        <PGAvatar name={author} size={16} />
        <span
          style={{
            fontSize: "var(--fs-11)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {author}
        </span>
      </div>
      <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}>{date}</span>
    </div>
  );
});

export interface PGCommitDetailProps {
  sha: string;
  fullSha?: string;
  subject: string;
  body?: string;
  author: string;
  email?: string;
  date: string;
  parents?: string[];
  branch?: string;
  tags?: string[];
}

export function PGCommitDetail({
  sha,
  fullSha,
  subject,
  body,
  author,
  email,
  date,
  parents = [],
  branch,
  tags = [],
}: PGCommitDetailProps) {
  return (
    <div
      style={{
        padding: 12,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--fs-13)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          // A 40-char sha is wider than a narrow detail column — wrap the row
          // rather than force the whole panel to scroll sideways.
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            color: "var(--fg-3)",
          }}
        >
          commit
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            color: "var(--accent)",
            minWidth: 0,
            wordBreak: "break-all",
          }}
        >
          {fullSha || sha}
        </span>
        {branch && <PGBranchPill name={branch} tone="accent" />}
        {tags.map((t, i) => (
          <PGBadge key={i} tone="warn" icon="tag">
            {t}
          </PGBadge>
        ))}
      </div>
      <div
        style={{
          fontSize: "var(--fs-15)",
          fontWeight: 600,
          color: "var(--fg-0)",
          marginBottom: 6,
          lineHeight: 1.3,
          overflowWrap: "anywhere",
        }}
      >
        {subject}
      </div>
      {body && (
        <div
          style={{
            color: "var(--fg-1)",
            fontSize: "var(--fs-12)",
            whiteSpace: "pre-wrap",
            // Wrap unbreakable runs (URLs, long tokens) instead of forcing a
            // horizontal scrollbar in a narrow column.
            overflowWrap: "anywhere",
            marginBottom: 10,
            fontFamily: "var(--font-mono)",
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <PGAvatar name={author} size={14} />
          {author}
          {email && <span style={{ color: "var(--fg-3)" }}>&lt;{email}&gt;</span>}
        </span>
        <span>
          <PGIcon
            name="clock"
            size={10}
            style={{ verticalAlign: "middle", marginRight: 3 }}
          />
          {date}
        </span>
        {parents.length > 0 && (
          <span>
            parent{parents.length > 1 ? "s" : ""}: {parents.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// CONFLICT ROW
// ═════════════════════════════════════════════════════════

export interface PGConflictRowProps {
  path: string;
  ours: string;
  theirs: string;
  resolved?: boolean;
  onPickOurs?: () => void;
  onPickTheirs?: () => void;
  onEdit?: () => void;
  additions?: number;
  deletions?: number;
  selected?: boolean;
  conflictCount?: number;
  hunkCount?: number;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function PGConflictRow({
  path,
  ours,
  theirs,
  resolved,
  onPickOurs,
  onPickTheirs,
  onEdit,
  additions = 0,
  deletions = 0,
  selected,
  conflictCount = 2,
  hunkCount,
  onClick,
  onDoubleClick,
  onContextMenu,
}: PGConflictRowProps) {
  const parts = path.split("/");
  const filename = parts.pop();
  const dir = parts.join("/");
  const hc = hunkCount ?? (resolved ? 0 : conflictCount);
  const total = Math.max(additions + deletions, 1);
  const addPct = (additions / total) * 100;

  return (
    <div
      data-testid="conflict-row"
      data-path={path}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        padding: 0,
        background: resolved
          ? "oklch(0.72 0.15 155 / 0.06)"
          : selected
            ? "var(--bg-2)"
            : "var(--bg-1)",
        border: `1px solid ${
          selected
            ? "var(--accent)"
            : resolved
              ? "oklch(0.72 0.15 155 / 0.35)"
              : "oklch(0.72 0.15 325 / 0.45)"
        }`,
        borderLeft: `3px solid ${
          resolved ? "var(--git-added)" : "var(--git-conflict)"
        }`,
        borderRadius: "var(--r-3)",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "background var(--t-fast), border-color var(--t-fast)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "calc(8px + var(--row-step) / 2) 10px calc(4px + var(--row-step) / 2)",
        }}
      >
        {resolved ? (
          <PGIcon
            name="check"
            size={13}
            style={{ color: "var(--git-added)" }}
            strokeWidth={2.2}
          />
        ) : (
          <PGIcon
            name="conflict"
            size={13}
            style={{ color: "var(--git-conflict)" }}
            strokeWidth={2}
          />
        )}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
              color: "var(--fg-0)",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {filename}
          </span>
          {dir && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-10)",
                color: "var(--fg-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {dir}/
            </span>
          )}
        </div>
        {resolved ? (
          <PGBadge tone="success" dot>
            RESOLVED
          </PGBadge>
        ) : (
          <PGBadge tone="danger" dot>
            {hc} HUNK{hc !== 1 ? "S" : ""}
          </PGBadge>
        )}
      </div>

      <div
        style={{
          padding: "0 10px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            height: 4,
            borderRadius: 2,
            overflow: "hidden",
            background: "var(--bg-3)",
          }}
        >
          <div style={{ width: `${addPct}%`, background: "var(--git-added)" }} />
          <div style={{ flex: 1, background: "var(--git-removed)" }} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-10)",
            color: "var(--fg-2)",
            display: "flex",
            gap: 4,
          }}
        >
          <span style={{ color: "var(--git-added)" }}>+{additions}</span>
          <span style={{ color: "var(--git-removed)" }}>−{deletions}</span>
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px 6px 10px",
          background: resolved ? "transparent" : "oklch(0.17 0.008 260 / 0.6)",
          borderTop: "1px solid var(--border-0)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-10)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              color: "var(--fg-2)",
            }}
          >
            <span
              style={{
                width: 38,
                color: "var(--accent)",
                letterSpacing: "0.04em",
              }}
            >
              OURS
            </span>
            <PGIcon
              name="branch"
              size={9}
              style={{ color: "var(--accent)" }}
            />
            <span
              style={{
                color: "var(--fg-0)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {ours}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              color: "var(--fg-2)",
            }}
          >
            <span
              style={{
                width: 38,
                color: "var(--accent-2)",
                letterSpacing: "0.04em",
              }}
            >
              THEIRS
            </span>
            <PGIcon
              name="branch"
              size={9}
              style={{ color: "var(--accent-2)" }}
            />
            <span
              style={{
                color: "var(--fg-0)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {theirs}
            </span>
          </div>
        </div>
        {resolved ? (
          <PGButton size="xs" variant="ghost" icon="eye" onClick={onEdit}>
            Review
          </PGButton>
        ) : (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <PGTooltip content="Accept ours" shortcut="⌥O">
              <PGIconButton
                icon="chevronLeft"
                size="sm"
                onClick={onPickOurs}
              />
            </PGTooltip>
            <PGTooltip content="Accept theirs" shortcut="⌥T">
              <PGIconButton
                icon="chevronRight"
                size="sm"
                onClick={onPickTheirs}
              />
            </PGTooltip>
            <PGButton
              size="xs"
              variant="primary"
              icon="edit"
              onClick={onEdit}
            >
              Resolve
            </PGButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// REBASE ROW
// ═════════════════════════════════════════════════════════

export interface PGRebaseRowProps {
  action?: string;
  sha: string;
  subject: string;
  onActionChange?: (v: string) => void;
  index?: number;
  dragging?: boolean;
}

export function PGRebaseRow({
  action = "pick",
  sha,
  subject,
  onActionChange,
  index,
  dragging,
}: PGRebaseRowProps) {
  const actions = [
    { value: "pick", label: "pick", color: "var(--git-added)" },
    { value: "reword", label: "reword", color: "var(--accent)" },
    { value: "edit", label: "edit", color: "var(--git-modified)" },
    { value: "squash", label: "squash", color: "var(--accent-2)" },
    { value: "fixup", label: "fixup", color: "var(--accent-2)" },
    { value: "drop", label: "drop", color: "var(--git-removed)" },
  ];
  const current = actions.find((a) => a.value === action) || actions[0];
  return (
    <div
      data-testid="rebase-row"
      data-sha={sha}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "calc(6px + var(--row-step) / 2) 10px",
        background: dragging ? "var(--bg-3)" : "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderLeft: `3px solid ${current.color}`,
        borderRadius: "var(--r-3)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        marginBottom: 4,
        opacity: action === "drop" ? 0.5 : 1,
        textDecoration: action === "drop" ? "line-through" : "none",
      }}
    >
      <PGIcon
        name="drag"
        size={14}
        style={{ color: "var(--fg-3)", cursor: "grab" }}
      />
      <span
        style={{ fontSize: "var(--fs-10)", color: "var(--fg-3)", width: 20 }}
      >
        {index}
      </span>
      <PGSelect
        value={action}
        onChange={onActionChange}
        size="sm"
        options={actions.map((a) => ({ value: a.value, label: a.label }))}
        style={{ width: 90, borderColor: current.color, color: current.color } as CSSProperties}
      />
      <span style={{ color: "var(--fg-3)" }}>{sha}</span>
      <span
        style={{
          color: "var(--fg-0)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {subject}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// ACTIVITY + REMOTE ROW
// ═════════════════════════════════════════════════════════

export function PGActivity({
  tone = "accent",
  label,
  size = 8,
}: {
  tone?: "accent" | "success" | "warn" | "danger";
  label?: ReactNode;
  size?: number;
}) {
  const tones = {
    accent: "var(--accent)",
    success: "var(--git-added)",
    warn: "var(--git-modified)",
    danger: "var(--git-removed)",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "var(--fs-11)",
        color: "var(--fg-1)",
      }}
    >
      <span style={{ position: "relative", width: size, height: size }}>
        <span
          style={{
            position: "absolute",
            inset: 0,
            background: tones[tone],
            borderRadius: "50%",
            animation: "pg-pulse 1.6s ease-out infinite",
          }}
        />
        <span
          style={{
            position: "absolute",
            inset: size / 4,
            background: tones[tone],
            borderRadius: "50%",
          }}
        />
      </span>
      {label}
    </span>
  );
}

export interface PGRemoteRowProps {
  name: string;
  url: string;
  ahead?: number;
  behind?: number;
  syncing?: boolean;
  onFetch?: () => void;
  onPush?: () => void;
  onPull?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  "data-remote"?: string;
}

export function PGRemoteRow({
  name,
  url,
  ahead = 0,
  behind = 0,
  syncing,
  onFetch,
  onPush,
  onPull,
  onContextMenu,
  "data-remote": dataRemote,
}: PGRemoteRowProps) {
  return (
    <div
      onContextMenu={onContextMenu}
      data-remote={dataRemote}
      style={{
        padding: "calc(10px + var(--row-step) / 2) 10px",
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
      }}
    >
      <PGIcon name="link" size={14} style={{ color: "var(--accent)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>{name}</span>
          {syncing && <PGActivity tone="accent" label="syncing" />}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {ahead > 0 && (
          <PGBadge tone="success" icon="upload">
            ↑{ahead}
          </PGBadge>
        )}
        {behind > 0 && (
          <PGBadge tone="warn" icon="download">
            ↓{behind}
          </PGBadge>
        )}
        <PGButton size="sm" variant="outline" icon="fetch" onClick={onFetch}>
          Fetch
        </PGButton>
        <PGButton size="sm" variant="outline" icon="pull" onClick={onPull}>
          Pull
        </PGButton>
        <PGButton size="sm" variant="primary" icon="push" onClick={onPush}>
          Push
        </PGButton>
      </div>
    </div>
  );
}
