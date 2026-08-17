import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { WordSpan } from "@/lib/wordDiff";
import { buildLineSpans } from "@/lib/lineSpans";
import type { SyntaxToken } from "@/lib/syntax";
import { PGIcon, type IconName } from "./icons";
import {
  PGBadge,
  PGAvatar,
  PGBranchPill,
  PGStatusMark,
  PGButton,
  PGCheckbox,
  PGSelect,
} from "./primitives";
import { useDensityStep } from "@/features/settings/useSettingsStore";
import {
  NO_HEAD_DECOR,
  type HeadDecor,
} from "@/features/settings/headMarks";
import { FOLDER_ICON_COLOR, fileIconSpec } from "@/lib/fileIcon";
import { GRAPH_PAD, commitRowGrid, laneX } from "./graph-geometry";
import type { WindowRange } from "@/lib/useWindowedList";
import type {
  RebaseAction,
  SubmoduleInfo,
  SubmoduleState,
  WorktreeInfo,
} from "@/lib/types";

// ═════════════════════════════════════════════════════════
// FILE TREE
// ═════════════════════════════════════════════════════════

export interface PGFileTreeNode {
  name: string;
  status?: string;
  defaultExpanded?: boolean;
  children?: PGFileTreeNode[];
  extra?: ReactNode;
  /**
   * This leaf is a registered submodule (#93), not a file and not a folder.
   * It gets the submodule glyph, because as an extension-less directory name it
   * would otherwise resolve to the generic file icon — the "mystery directory"
   * this flag exists to end.
   */
  submodule?: boolean;
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
  kind?: "file" | "folder" | "submodule";
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
      : kind === "submodule"
        ? // A submodule is a gitlink: not a file (no diff, no blame, no history)
          // and not a folder (git will not recurse into it).
          { icon: "submodule" as IconName, color: "var(--accent)" }
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
          kind={
            f.hasChildren ? "folder" : f.node.submodule ? "submodule" : "file"
          }
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

/**
 * `info` and `empty` belong to the SPLIT view's `SideLine` only — `diffToSplit`
 * pushes an `info` row per hunk and an `empty` row where one side has no line.
 * `flattenDiffRows` emits none of them.
 *
 * There is no `"hunk"` kind: it rendered a literal `@@` in an 80px gutter, had no
 * producer anywhere, and #157 recorded it as noted-not-done while removing the
 * banner. It is gone now, so no live render path in the unified diff contains the
 * string at all (#161).
 */
export type DiffLineKind = "ctx" | "add" | "rem" | "info" | "empty";

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
   * (#61 D7) — assigned by `flattenDiffRows`, not by callers.
   */
  changedIndex?: number;
  /**
   * Line-relative syntax tokens for this row, resolved from the correct side of
   * the diff by `flattenDiffRows`. Undefined renders the line unhighlighted.
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
    info: "var(--bg-2)",
    empty: "var(--bg-2)",
  };
  const marker: Record<DiffLineKind, string> = {
    add: "+",
    rem: "−",
    ctx: " ",
    info: "i",
    empty: "",
  };
  const color: Record<DiffLineKind, string> = {
    ctx: "var(--fg-1)",
    add: "var(--git-added)",
    rem: "var(--git-removed)",
    info: "var(--fg-2)",
    empty: "var(--fg-3)",
  };

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






/**
 * Render one line as spans, combining syntax classes and word-diff emphasis.
 *
 * Both come from buildLineSpans, which tiles the line — so this maps and never
 * reasons about gaps or overlaps. The changed-span tint is its own themeable
 * token, per MODE, so a light theme can go darker where dark goes lighter.
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
    kind === "add" ? "var(--git-added-word)" : "var(--git-removed-word)";
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

/**
 * One diff row, self-contained.
 *
 * The add/rem background and gutter stripe used to live on a wrapper around each
 * run of same-kind lines. They are per-row now because a windowed slice can start
 * in the middle of a run, and there would be no wrapper to inherit from —
 * per-row `border-left` stacks into the same continuous stripe.
 *
 * Exported so the windowed renderer reuses this markup rather than restating it.
 */
export function PGDiffRow({
  line,
  selected,
  focused,
  onLineClick,
}: {
  line: DiffLineData;
  selected?: boolean;
  /**
   * The keyboard line cursor sits here (#61 D7 step 5). Distinct from
   * `selected`: selection is a set the hunk's Stage button acts on, focus is the
   * single line Space acts on, and the two are frequently different rows.
   */
  focused?: boolean;
  onLineClick?: (changedIndex: number, range: boolean) => void;
}) {
  const kind = line.kind;
  const bg: Partial<Record<DiffLineKind, string>> = {
    add: "var(--git-added-bg)",
    rem: "var(--git-removed-bg)",
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
    info: "i",
    empty: "",
  };
  const textColor: Record<DiffLineKind, string> = {
    ctx: "var(--fg-0)",
    add: "var(--git-added)",
    rem: "var(--git-removed)",
    info: "var(--fg-2)",
    empty: "var(--fg-3)",
  };

  // A separator row keeps its own renderer. `flattenDiffRows` produces no `info`
  // rows — the split view does, through PGSideBySideDiff — so this is the total
  // branch for a kind that cannot currently arrive, not a live path.
  if (kind === "info") return <PGDiffLine {...line} />;

  const ln = line;
  const selectable = onLineClick != null && ln.changedIndex != null;
  const isSelected = selected ?? false;
  return (
        <div
          data-testid={selectable ? "diff-line-changed" : undefined}
          data-selected={isSelected || undefined}
          data-focused={focused || undefined}
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
            // Fixed pitch, read from CSS by the window's arithmetic. Was
            // minHeight: an elastic row would put the window out of step.
            height: "var(--diff-row-h)",
            cursor: selectable ? "pointer" : undefined,
            background: isSelected
              ? "oklch(from var(--accent) l c h / 0.18)"
              : (bg[kind] ?? "transparent"),
            borderLeft:
              borderColor[kind] !== undefined
                ? `2px solid ${borderColor[kind]}`
                : "2px solid transparent",
            // outline, not a border or extra padding: this row's height is the
            // window's pitch, and anything that grows it puts the variable-height
            // arithmetic out of step with what is rendered. outlineOffset pulls
            // the ring inside so the neighbours don't clip it.
            outline: focused ? "1px solid var(--accent)" : undefined,
            outlineOffset: focused ? "-1px" : undefined,
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
}

/** Shared button shape for the two hunk-action controls. */
function hunkActionStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    height: 16,
    padding: "0 4px",
    border: "1px solid var(--border-1)",
    borderRadius: "var(--r-3)",
    background: "var(--bg-2)",
    color: "var(--fg-1)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-10)",
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    // The wrapper is pointer-events: none so a click anywhere else on the row
    // still selects the line; the buttons opt back in.
    pointerEvents: "auto",
  };
}

/**
 * A hunk's Stage/Discard cluster, pinned to the right edge of the hunk's ANCHOR
 * row (its first changed line) — Rider's per-change gutter affordance rather than
 * the `@@` banner that used to carry these (#157).
 *
 * Idle at reduced opacity and full on hover; `index.css` owns that, keyed on
 * `[data-pg-hunk-actions]`. NOT hover-only: a windowed diff cannot wrap a hunk in
 * one element (its rows split across the window boundary), so the only cheap hover
 * target is this single ~19px row, and an affordance discoverable solely by
 * hovering the exact row it sits on is not discoverable. The keyboard equivalents
 * are `diff.stageHunk` / `diff.discardHunk`.
 */
export function PGHunkActions({
  staged,
  onStage,
  onDiscard,
  actionsDisabledReason,
  selCount = 0,
}: {
  staged?: boolean;
  onStage?: () => void;
  onDiscard?: () => void;
  actionsDisabledReason?: string;
  selCount?: number;
}) {
  const disabled = !!actionsDisabledReason;
  const verb = staged ? "Unstage" : "Stage";
  const stageTitle =
    actionsDisabledReason ??
    (selCount > 0
      ? `${verb} ${selCount} selected line${selCount === 1 ? "" : "s"}`
      : `${verb} hunk`);
  return (
    <div
      data-pg-hunk-actions=""
      style={{
        position: "absolute",
        right: 6,
        top: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        gap: 3,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        className="focusable"
        onClick={onDiscard}
        disabled={disabled}
        title={actionsDisabledReason ?? (selCount > 0 ? `Discard ${selCount} selected lines` : "Discard hunk")}
        aria-label="Discard hunk"
        style={hunkActionStyle(disabled)}
      >
        <PGIcon name="x" size={9} />
      </button>
      <button
        type="button"
        data-testid="hunk-stage"
        className="focusable"
        onClick={onStage}
        disabled={disabled}
        title={stageTitle}
        aria-label={stageTitle}
        style={{
          ...hunkActionStyle(disabled),
          borderColor: staged ? "var(--border-1)" : "var(--accent)",
          color: staged ? "var(--fg-1)" : "var(--accent)",
        }}
      >
        <PGIcon name={staged ? "check" : "plus"} size={9} />
        {/* Only the selection count is spelled out. With nothing selected this
            button has no text at all, which is what keeps it a quiet gutter
            control — and what CommitPanel.lineStaging asserts. */}
        {selCount > 0 && <span>{selCount} lines</span>}
      </button>
    </div>
  );
}

/**
 * Chunked mode's fold separator: the run of unchanged lines between two rendered
 * regions, named rather than labelled with a `@@` range (#157).
 *
 * Says how much is hidden, where it resumes, and offers to show it. Chrome, not
 * code, so it is density-aware (`--row-step`) — code geometry stays on
 * `--lh-code`. `onExpand` omitted leaves it informational, which is what happens
 * when the file text is not available to expand from.
 */
export function PGFoldSeparator({
  hiddenLines,
  fromR,
  height = "calc(22px + var(--row-step))",
  onExpand,
}: {
  hiddenLines: number;
  /** 1-based first hidden line, new side. */
  fromR: number;
  height?: string;
  onExpand?: () => void;
}) {
  const range = `${fromR}–${fromR + hiddenLines - 1}`;
  const label = `${hiddenLines} unchanged line${hiddenLines === 1 ? "" : "s"}`;
  return (
    <div
      data-pg-fold=""
      title={
        onExpand
          ? `Lines ${range} hidden — click to show them`
          : `Lines ${range} hidden (the file text is not loaded, so they cannot be shown here)`
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height,
        padding: "0 10px",
        background: "var(--bg-1)",
        borderTop: "1px dashed var(--border-0)",
        borderBottom: "1px dashed var(--border-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-10)",
        color: "var(--fg-3)",
        boxSizing: "border-box",
      }}
    >
      <button
        type="button"
        data-testid="fold-expand"
        className="focusable"
        onClick={onExpand}
        disabled={!onExpand}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          height: 16,
          padding: "0 5px",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-3)",
          background: "var(--bg-2)",
          color: onExpand ? "var(--fg-1)" : "var(--fg-3)",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: 1,
          cursor: onExpand ? "pointer" : "default",
          flexShrink: 0,
        }}
      >
        <PGIcon name="expandAll" size={9} />
        <span>{label}</span>
      </button>
      <div style={{ flex: 1, borderTop: "1px dashed var(--border-0)", minWidth: 8 }} />
      <span style={{ flexShrink: 0 }}>{range}</span>
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

/** Radius of the HEAD ring — outside the 4px dot, so dot styles stay readable. */
const HEAD_RING_R = 6.5;

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
  ringStroke = 1,
  ringGlow = 0,
}: {
  lanes?: GraphLane[];
  node?: GraphNode;
  width: number;
  height: number;
  /** Lane count exceeds what the clamped width can show — fade the right edge. */
  clamped?: boolean;
  /**
   * Weight of the HEAD ring, from the user's head marks. `0` drops the ring
   * entirely — the graph ring is opt-out now, not unconditional. The default is
   * the hairline circle the graph has always drawn, so a caller with no notion
   * of the HEAD settings renders exactly as before.
   *
   * Two scalars rather than one object on purpose: this component is memoized,
   * and a `{stroke, glow}` literal built per row would be a fresh reference
   * every render and skip the memo every time.
   */
  ringStroke?: number;
  /** Width of the translucent halo under the ring. `0` for none. */
  ringGlow?: number;
}) {
  // The halo is a wider stroke on the SAME circle, so its outer edge must stay
  // inside the gutter's left pad — otherwise column 0's ring is clipped by the
  // SVG viewport with no overflow and no warning (the #68 G1 failure mode).
  const ringGlowW =
    ringGlow > 0
      ? Math.min(ringStroke + ringGlow * 1.5, (GRAPH_PAD - HEAD_RING_R - 0.5) * 2)
      : 0;
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
              than replacing it, so hollow / solid / merge stay readable. The
              halo is a second, wider, translucent circle — not a CSS filter,
              which is the expensive way to glow one node per row in a
              virtualized list. */}
          {node.head && ringStroke > 0 && (
            <>
              {ringGlowW > 0 && (
                <circle
                  data-graph-head-glow="true"
                  cx={laneX(node.col)}
                  cy={height / 2}
                  r={HEAD_RING_R}
                  fill="none"
                  stroke={node.color}
                  strokeWidth={ringGlowW}
                  opacity={0.25}
                />
              )}
              <circle
                data-graph-head="true"
                cx={laneX(node.col)}
                cy={height / 2}
                r={HEAD_RING_R}
                fill="none"
                stroke={node.color}
                strokeWidth={ringStroke}
              />
            </>
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
  /** The ref as git names it — see PGBranchPill.refName. */
  ref?: string;
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
  /** This row is the commit HEAD points at ("you are here"). */
  isHead?: boolean;
  /**
   * How to mark that row — the user's head marks and weight, already resolved
   * to draw numbers by `resolveHeadDecor`. Resolve it ONCE per list render and
   * hand every row the same object: `React.memo` compares by reference, so a
   * fresh object per row would defeat row memoization (#68 G9).
   *
   * Defaults to no decoration, so surfaces with no notion of HEAD (Reflog,
   * Rebase) stay unchanged.
   */
  headDecor?: HeadDecor;
}

/** Accent at an alpha, carrying whatever hue the active theme set. */
const accentA = (alpha: number) => `oklch(from var(--accent) l c h / ${alpha})`;

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
  isHead,
  headDecor = NO_HEAD_DECOR,
}: PGCommitRowProps) {
  const [hover, setHover] = React.useState(false);
  const step = useDensityStep();
  const h = rowHeight ?? COMMIT_ROW_BASE_H + step;
  // One gate for every mark, so "this row is not HEAD" is checked once.
  const d = isHead && !headDecor.bare ? headDecor : NO_HEAD_DECOR;
  // Selection outranks the HEAD wash — the selected row must stay obvious even
  // when it IS head, and two accent washes stacked read as neither. Leaving
  // `background` undefined is what lets the [data-selected] CSS rule apply.
  const background = selected
    ? undefined
    : d.tintAlpha > 0
      ? accentA(d.tintAlpha)
      : hover
        ? "var(--bg-2)"
        : undefined;
  // The outline is an INSET shadow, not a border: a border would change the
  // row's box and shift every column by its width when HEAD scrolls past.
  const outline =
    d.outlineW > 0
      ? `inset 0 0 0 ${d.outlineW}px ${accentA(d.outlineAlpha)}`
      : undefined;
  return (
    <div
      data-testid="commit-row"
      data-sha={sha}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      data-head={isHead ? "true" : undefined}
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
        background,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        cursor: "pointer",
        position: "relative",
        borderBottom: "1px solid oklch(from var(--border-0) l c h / 0.5)",
        boxShadow: outline,
      }}
    >
      {/* HEAD's bar sits first so a selected HEAD row shows the selection bar
          on top of it — same edge, selection wins its 2px. */}
      {d.barW > 0 && (
        <span
          data-testid="commit-head-bar"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: d.barW,
            background: "var(--accent)",
            boxShadow: `0 0 ${d.barGlow}px ${accentA(0.65)}`,
          }}
        />
      )}
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
          ringStroke={d.ringStroke}
          ringGlow={d.ringGlow}
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
        {/* Ahead of the branch pills: the one mark that says "you are here" in
            words rather than in color, for anyone who can't separate the accent
            wash from a hover. */}
        {d.badge && (
          <PGBadge
            tone="accent"
            style={{
              flexShrink: 0,
              borderColor: accentA(0.7),
              boxShadow:
                d.badgeGlow > 0 ? `0 0 ${d.badgeGlow}px ${accentA(0.5)}` : undefined,
            }}
          >
            <span data-testid="commit-head-badge">HEAD</span>
          </PGBadge>
        )}
        {refs?.map((r, i) => (
          <PGBranchPill
            key={i}
            name={r.name}
            tone={r.tone}
            icon={r.icon}
            remote={r.remote}
            refName={r.ref}
          />
        ))}
        {tagged && (
          <PGBadge tone="warn" icon="tag">
            {tagged}
          </PGBadge>
        )}
        <span
          data-testid="commit-subject"
          style={{
            color: "var(--fg-0)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontWeight: d.subjectWeight || undefined,
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
// REBASE ROW
// ═════════════════════════════════════════════════════════

export interface PGRebaseRowProps {
  /** Exact `RebaseAction` string — the same value the backend consumes. */
  action?: RebaseAction;
  sha: string;
  subject: string;
  onActionChange?: (v: RebaseAction) => void;
  index?: number;
  dragging?: boolean;
  /** Restrict the dropdown — a merge row cannot be reworded, edited, or folded. */
  options?: RebaseAction[];
  /** Short label rendered next to the sha, e.g. "merge". */
  badge?: string;
  /** Keyboard cursor row — what Mod+Shift+↑/↓ moves (#91). */
  selected?: boolean;
  /**
   * False while reordering is disabled (preserve mode — git's own
   * `--rebase-merges` reorder is unreliable). The grip goes dim and loses its
   * grab cursor, so the row does not advertise a gesture that will not run.
   */
  reorderable?: boolean;
}

/// One entry per `RebaseAction`. The row speaks the backend's exact strings: it
/// used to lowercase them and have the caller re-capitalise the first letter on
/// the way back, which cannot express a two-word action like MainlinePick.
const REBASE_ACTION_STYLE: Record<RebaseAction, { label: string; color: string }> = {
  Pick: { label: "pick", color: "var(--git-added)" },
  Reword: { label: "reword", color: "var(--accent)" },
  Edit: { label: "edit", color: "var(--git-modified)" },
  Squash: { label: "squash", color: "var(--accent-2)" },
  Fixup: { label: "fixup", color: "var(--accent-2)" },
  Drop: { label: "drop", color: "var(--git-removed)" },
  MainlinePick: { label: "keep as one", color: "var(--accent-3)" },
  Merge: { label: "merge", color: "var(--accent-4)" },
};

const DEFAULT_REBASE_ACTIONS: RebaseAction[] = [
  "Pick",
  "Reword",
  "Edit",
  "Squash",
  "Fixup",
  "Drop",
];

export function PGRebaseRow({
  action = "Pick",
  sha,
  subject,
  onActionChange,
  index,
  dragging,
  options,
  badge,
  selected,
  reorderable = true,
}: PGRebaseRowProps) {
  const values = options ?? DEFAULT_REBASE_ACTIONS;
  const current = REBASE_ACTION_STYLE[action] ?? REBASE_ACTION_STYLE.Pick;
  return (
    <div
      data-testid="rebase-row"
      data-sha={sha}
      data-action={action}
      data-pg-row=""
      data-selected={selected ? "true" : undefined}
      data-pg-reorderable={reorderable ? "true" : "false"}
      title={reorderable ? undefined : "Reordering is disabled while preserving merges"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "calc(6px + var(--row-step) / 2) 10px",
        // Selection comes from the focus-aware [data-pg-row] CSS, so it must not
        // be overpainted here — only the un-selected row states set a background.
        background: selected ? undefined : dragging ? "var(--bg-3)" : "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderLeft: `3px solid ${current.color}`,
        borderRadius: "var(--r-3)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        marginBottom: 4,
        opacity: action === "Drop" ? 0.5 : 1,
        textDecoration: action === "Drop" ? "line-through" : "none",
      }}
    >
      <PGIcon
        name="drag"
        size={14}
        style={{
          color: "var(--fg-3)",
          cursor: reorderable ? "grab" : "default",
          opacity: reorderable ? 1 : 0.35,
        }}
      />
      <span
        style={{ fontSize: "var(--fs-10)", color: "var(--fg-3)", width: 20 }}
      >
        {index}
      </span>
      <PGSelect
        value={action}
        onChange={(v) => onActionChange?.(v as RebaseAction)}
        size="sm"
        options={values.map((v) => ({
          value: v,
          label: REBASE_ACTION_STYLE[v].label,
        }))}
        style={{ width: 110, borderColor: current.color, color: current.color } as CSSProperties}
      />
      {badge && (
        <span
          data-testid="rebase-row-badge"
          style={{
            fontSize: "var(--fs-10)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "1px 5px",
            borderRadius: "var(--r-1)",
            border: "1px solid var(--border-1)",
            color: "var(--fg-2)",
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
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

// ═════════════════════════════════════════════════════════
// SUBMODULES (#93)
// ═════════════════════════════════════════════════════════

/** State pill copy + tone. Exported so the Submodules screen and its tests
 *  read the same table instead of duplicating the strings. */
export const SUBMODULE_STATE_LABEL: Record<
  SubmoduleState,
  { label: string; tone: "default" | "accent" | "success" | "warn" | "danger" | "violet" | "muted"; hint: string }
> = {
  Uninitialized: {
    label: "not initialized",
    tone: "muted",
    hint: "Declared in .gitmodules but never checked out. Update to fetch it.",
  },
  UpToDate: {
    label: "up to date",
    tone: "success",
    hint: "Checked out at the commit this repository records.",
  },
  Modified: {
    label: "modified",
    tone: "warn",
    hint: "At the recorded commit, but with uncommitted changes inside.",
  },
  OutOfSync: {
    label: "out of sync",
    tone: "danger",
    hint: "Checked out at a different commit than this repository records.",
  },
};

export interface PGSubmoduleRowProps {
  submodule: SubmoduleInfo;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onInit?: () => void;
  onUpdate?: () => void;
  onOpen?: () => void;
  busy?: boolean;
}

export function PGSubmoduleRow({
  submodule,
  onContextMenu,
  onInit,
  onUpdate,
  onOpen,
  busy,
}: PGSubmoduleRowProps) {
  const state = SUBMODULE_STATE_LABEL[submodule.state];
  const recorded = submodule.headOid?.slice(0, 7) ?? "—";
  const checkedOut = submodule.workdirOid?.slice(0, 7) ?? "—";
  const drifted = submodule.state === "OutOfSync";

  return (
    <div
      data-testid="submodule-row"
      data-path={submodule.path}
      data-state={submodule.state}
      onContextMenu={onContextMenu}
      title={state.hint}
      style={{
        // Density-aware (issue #70): padding-sized row, so half the step per side.
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
      <PGIcon name="submodule" size={14} style={{ color: "var(--accent)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>
            {submodule.path}
          </span>
          <PGBadge tone={state.tone}>{state.label}</PGBadge>
          {submodule.branch && (
            <PGBranchPill name={submodule.branch} tone="violet" />
          )}
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
          {submodule.url ?? "(no url)"}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-2)",
            display: "flex",
            gap: 10,
          }}
        >
          <span>recorded {recorded}</span>
          {/* Only worth showing when it differs — otherwise it is the same sha
              twice, which reads as noise. */}
          {drifted && (
            <span data-testid="submodule-drift" style={{ color: "var(--git-modified)" }}>
              checked out {checkedOut}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {submodule.state === "Uninitialized" && (
          <PGButton
            size="sm"
            variant="outline"
            icon="download"
            data-testid="submodule-init"
            onClick={onInit}
            loading={busy}
          >
            Init
          </PGButton>
        )}
        <PGButton
          size="sm"
          variant="outline"
          icon="sync"
          data-testid="submodule-update"
          onClick={onUpdate}
          loading={busy}
        >
          Update
        </PGButton>
        <PGButton
          size="sm"
          variant="ghost"
          icon="external"
          data-testid="submodule-open"
          onClick={onOpen}
          // An uninitialized submodule has no repository on disk to open.
          disabled={submodule.state === "Uninitialized"}
        >
          Open
        </PGButton>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// LINKED WORKTREES (#93)
// ═════════════════════════════════════════════════════════

export interface PGWorktreeRowProps {
  worktree: WorktreeInfo;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onOpen?: () => void;
  onRemove?: () => void;
  onToggleLock?: () => void;
  busy?: boolean;
}

export function PGWorktreeRow({
  worktree,
  onContextMenu,
  onOpen,
  onRemove,
  onToggleLock,
  busy,
}: PGWorktreeRowProps) {
  return (
    <div
      data-testid="worktree-row"
      data-name={worktree.name}
      data-current={worktree.isCurrent ? "1" : undefined}
      onContextMenu={onContextMenu}
      style={{
        padding: "calc(10px + var(--row-step) / 2) 10px",
        background: "var(--bg-1)",
        // The worktree you are standing in gets the accent edge — without it the
        // list is several near-identical paths and "which one am I in" is a guess.
        border: worktree.isCurrent
          ? "1px solid oklch(from var(--accent) l c h / 0.55)"
          : "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
      }}
    >
      <PGIcon
        name="worktree"
        size={14}
        style={{ color: worktree.isCurrent ? "var(--accent)" : "var(--fg-2)" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-13)" }}>
            {worktree.name}
          </span>
          {worktree.branch ? (
            <PGBranchPill name={worktree.branch} tone="accent" />
          ) : (
            <PGBadge tone="muted">detached</PGBadge>
          )}
          {worktree.isCurrent && <PGBadge tone="accent">this window</PGBadge>}
          {worktree.locked && (
            <PGBadge tone="warn" icon="lock">
              {worktree.lockReason ? `locked · ${worktree.lockReason}` : "locked"}
            </PGBadge>
          )}
          {worktree.prunable && (
            <PGBadge tone="danger" icon="warn">
              directory missing
            </PGBadge>
          )}
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
          {worktree.path}
          {worktree.headOid ? ` · ${worktree.headOid.slice(0, 7)}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <PGButton
          size="sm"
          variant="outline"
          icon="folder"
          data-testid="worktree-open"
          onClick={onOpen}
          // Nothing to open once the directory is gone.
          disabled={worktree.prunable}
        >
          Open
        </PGButton>
        <PGButton
          size="sm"
          variant="ghost"
          icon="lock"
          data-testid="worktree-lock"
          onClick={onToggleLock}
        >
          {worktree.locked ? "Unlock" : "Lock"}
        </PGButton>
        <PGButton
          size="sm"
          variant="ghost"
          tone="danger"
          icon="trash"
          data-testid="worktree-remove"
          onClick={onRemove}
          loading={busy}
        >
          Remove
        </PGButton>
      </div>
    </div>
  );
}
