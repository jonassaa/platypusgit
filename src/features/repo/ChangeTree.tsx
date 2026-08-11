import React from "react";
import { PGFileTree, PGChangeRow, type PGFileTreeNode } from "@/design";
import { statusMark } from "@/lib/derive";
import { fileIcon } from "@/lib/fileIcons";
import { fileStageState } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

export type ChangeTreeViewMode = "tree" | "flat";

/** Minimum a row needs: its path plus the status it renders from. */
export interface ChangeTreeSlot {
  path: string;
  status: FileStatus;
}

export interface ChangeTreeProps {
  /** Flat file list — the source for flat mode, and for row counts. */
  files: readonly ChangeTreeSlot[];
  /** Pre-built tree for tree mode. Callers already memoize this. */
  nodes: PGFileTreeNode[];
  viewMode: ChangeTreeViewMode;
  expanded: Record<string, boolean>;
  onToggleExpand?: (key: string) => void;
  /** Selection is owned by the screen; these are keys in the screen's key form. */
  selectedKeys: ReadonlySet<string>;
  primaryKey?: string;
  onSelect: (key: string, e?: React.MouseEvent) => void;
  onActivate?: (key: string) => void;
  onRowContextMenu?: (
    e: React.MouseEvent,
    key: string,
    node?: PGFileTreeNode,
  ) => void;
  /** Staging toggle. Receives the screen's key form. */
  onCheck?: (key: string) => void;
  checkboxes: "always" | "changed-only" | "none";
  showStatus?: boolean;
  /**
   * Map a raw tree key ("/a/b") to the host screen's key form. RepoBrowser
   * passes identity; CommitPanel prefixes the side ("staged:a/b").
   */
  keyOf: (rawKey: string) => string;
}

/**
 * Renders a set of changed files as a nested tree or a flat list, with optional
 * staging checkboxes and file-type icons.
 *
 * Deliberately presentational: it owns no selection, no keyboard handling and
 * no store access, mirroring `CommitDiffPanel`. Screens keep computing row
 * order from the pure `flattenFileTree`, which is what lets CommitPanel's
 * shift-range selection keep crossing its STAGED/CHANGES boundary while two
 * separate ChangeTrees render the two halves.
 */
export function ChangeTree({
  files,
  nodes,
  viewMode,
  expanded,
  onToggleExpand,
  selectedKeys,
  primaryKey,
  onSelect,
  onActivate,
  onRowContextMenu,
  onCheck,
  checkboxes,
  showStatus = true,
  keyOf,
}: ChangeTreeProps) {
  if (viewMode === "flat") {
    return (
      <>
        {files.map((f) => {
          const key = keyOf(`/${f.path}`);
          const { icon, tint } = fileIcon(f.path);
          // An unmodified file (all-files mode) carries no stage state, so it
          // gets neither a checkbox nor a status mark.
          const stage = fileStageState(f.status);
          return (
            <PGChangeRow
              key={key}
              path={f.path}
              status={showStatus && stage !== undefined ? statusMark(f.status) : undefined}
              icon={icon}
              iconColor={tint}
              additions={f.status.additions}
              deletions={f.status.deletions}
              staged={
                checkboxes === "none" || stage === undefined
                  ? undefined
                  : stage === "all"
              }
              selected={selectedKeys.has(key)}
              onClick={(e) => onSelect(key, e)}
              onContextMenu={
                onRowContextMenu ? (e) => onRowContextMenu(e, key) : undefined
              }
              onToggle={onCheck ? () => onCheck(key) : undefined}
            />
          );
        })}
      </>
    );
  }

  return (
    <PGFileTree
      nodes={nodes}
      expanded={expanded}
      onToggle={onToggleExpand}
      selected={primaryKey}
      selectedKeys={selectedKeys}
      showStatus={showStatus}
      checkboxSlot={checkboxes !== "none"}
      onCheck={onCheck ? (rawKey) => onCheck(keyOf(rawKey)) : undefined}
      onSelect={(rawKey, _node, e) => onSelect(keyOf(rawKey), e)}
      onActivate={onActivate ? (rawKey) => onActivate(keyOf(rawKey)) : undefined}
      onRowContextMenu={
        onRowContextMenu
          ? (e, rawKey, node) => onRowContextMenu(e, keyOf(rawKey), node)
          : undefined
      }
    />
  );
}
