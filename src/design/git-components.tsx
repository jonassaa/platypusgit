import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
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
}: PGFileTreeProps) {
  const flat = flattenFileTree(nodes, expanded);
  const rowStage = flat.map((f) => stageState?.(f.key, f.node));
  // Reserve the checkbox column for the whole tree as soon as one row uses it,
  // so a mixed tree (changed + unmodified files) keeps its names aligned.
  const stageSlot = rowStage.some((s) => s !== undefined);

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
      {flat.map((f, i) => (
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
      ))}
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
}

export function PGDiffLine({ kind = "ctx", lnL, lnR, text }: DiffLineData) {
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
        {text}
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

function PGDiffChunk({ chunk }: { chunk: DiffChunk }) {
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
      {lines.map((ln, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
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
            {ln.text}
          </span>
        </div>
      ))}
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
   * don't address the hunks git would apply (#61 D2).
   */
  actionsDisabledReason?: string;
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
}: PGHunkProps) {
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
          {staged ? "Staged" : "Stage hunk"}
        </PGButton>
      </div>
      {expanded && (
        <div>
          {chunkDiffLines(lines).map((c, i) => (
            <PGDiffChunk key={i} chunk={c} />
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
              {ln.text}
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

export interface GraphLane {
  col: number;
  color: string;
  kind: "line" | "diag" | "half-top" | "half-bot" | "fork-bot" | "merge-top";
  to?: number;
}

export interface GraphNode {
  col: number;
  color: string;
  solid?: boolean;
  merge?: boolean;
}

/**
 * `height` is REQUIRED and must be the caller's actual row pitch in px.
 *
 * The lane geometry below is in SVG user units (`y2={height}`, bezier control
 * points at `height / 2`), so it cannot read `--row-step` — a default here
 * would silently draw at one pitch while density moved the rows to another,
 * leaving lanes that don't meet between rows. Callers derive the number from
 * `useDensityStep()`; see `PGCommitRow`.
 */
export function PGGraphRow({
  lanes = [],
  node,
  width = 140,
  height,
}: {
  lanes?: GraphLane[];
  node?: GraphNode;
  width?: number;
  height: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      style={{ flexShrink: 0, display: "block" }}
    >
      {lanes.map((ln, i) => {
        const x = 12 + ln.col * 16;
        if (ln.kind === "line") {
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke={ln.color}
              strokeWidth="1.5"
            />
          );
        }
        if (ln.kind === "diag") {
          const x2 = 12 + (ln.to ?? ln.col + 1) * 16;
          return (
            <path
              key={i}
              d={`M ${x} 0 C ${x} ${height / 2}, ${x2} ${height / 2}, ${x2} ${height}`}
              stroke={ln.color}
              strokeWidth="1.5"
              fill="none"
            />
          );
        }
        if (ln.kind === "half-top") {
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={0}
              y2={height / 2}
              stroke={ln.color}
              strokeWidth="1.5"
            />
          );
        }
        if (ln.kind === "half-bot") {
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={height / 2}
              y2={height}
              stroke={ln.color}
              strokeWidth="1.5"
            />
          );
        }
        if (ln.kind === "fork-bot") {
          const x2 = 12 + (ln.to ?? ln.col + 1) * 16;
          return (
            <path
              key={i}
              d={`M ${x} ${height / 2} C ${x} ${height * 0.75}, ${x2} ${height * 0.75}, ${x2} ${height}`}
              stroke={ln.color}
              strokeWidth="1.5"
              fill="none"
            />
          );
        }
        if (ln.kind === "merge-top") {
          const x2 = 12 + (ln.to ?? ln.col + 1) * 16;
          return (
            <path
              key={i}
              d={`M ${x} 0 C ${x} ${height * 0.25}, ${x2} ${height * 0.25}, ${x2} ${height / 2}`}
              stroke={ln.color}
              strokeWidth="1.5"
              fill="none"
            />
          );
        }
        return null;
      })}
      {node && (
        <>
          <circle
            cx={12 + node.col * 16}
            cy={height / 2}
            r="4"
            fill="var(--bg-0)"
            stroke={node.color}
            strokeWidth="1.5"
          />
          {node.solid && (
            <circle
              cx={12 + node.col * 16}
              cy={height / 2}
              r="2.5"
              fill={node.color}
            />
          )}
          {node.merge && (
            <circle
              cx={12 + node.col * 16}
              cy={height / 2}
              r="4"
              fill={node.color}
              stroke="var(--bg-0)"
              strokeWidth="1.5"
            />
          )}
        </>
      )}
    </svg>
  );
}

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
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  tagged?: string;
  /**
   * Row height in px. Defaults to the density-derived height. Unlike every
   * other row surface this can't be a `--row-h` calc: PGGraphRow draws lanes
   * in SVG user units, so the row box and the gutter must share one NUMBER.
   */
  rowHeight?: number;
}

export const COMMIT_ROW_BASE_H = 26;

export function PGCommitRow({
  lanes,
  node,
  sha,
  message,
  author,
  date,
  refs,
  selected,
  onClick,
  onContextMenu,
  tagged,
  rowHeight,
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
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "140px 70px 1fr 150px 90px",
        alignItems: "center",
        height: h,
        background: !selected && hover ? "var(--bg-2)" : undefined,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        cursor: "pointer",
        position: "relative",
        borderBottom: "1px solid oklch(0.22 0.008 260 / 0.5)",
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
      <PGGraphRow lanes={lanes} node={node} height={h} />
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
}

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
