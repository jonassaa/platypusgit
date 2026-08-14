// The resolver window's conflicted-file sidebar (#108) — the list the deleted
// Conflicts screen used to hold, now next to the editor that resolves it.
//
// Every action here goes through the IPC wrappers directly. It cannot use
// `useRepoStore` (and so cannot reuse `conflictMenuItems`): this is a second
// Tauri window with its own store instance, one that never opened a repository,
// so every store git action would hit `if (!repo) return` and silently no-op.

import React from "react";
import {
  PGIcon,
  PGSectionHeader,
  pgConfirm,
  useContextMenu,
  type ContextMenuItem,
} from "@/design";
import {
  acceptOurs,
  acceptTheirs,
  markResolved,
  openInEditor,
  restartConflict,
} from "@/lib/tauri";
import { fileIconSpec } from "@/lib/fileIcon";

export interface MergeFile {
  path: string;
  /** Resolved during this session — kept listed, so the set does not shift
   *  under the user as they work through it. */
  resolved: boolean;
}

export function mergeFileMenuItems(opts: {
  repoId: string;
  path: string;
  /** Called after the file stopped being conflicted. */
  onResolved: (path: string) => void;
  /** Called after the file changed but is still conflicted (a restart). */
  onChanged: (path: string) => void;
}): ContextMenuItem[] {
  const { repoId, path, onResolved, onChanged } = opts;
  return [
    { __menuTitle: path },
    {
      icon: "chevronLeft",
      label: "Accept ours",
      onClick: async () => {
        await acceptOurs(repoId, path);
        onResolved(path);
      },
    },
    {
      icon: "chevronRight",
      label: "Accept theirs",
      onClick: async () => {
        await acceptTheirs(repoId, path);
        onResolved(path);
      },
    },
    {
      icon: "check",
      label: "Mark as resolved",
      onClick: async () => {
        await markResolved(repoId, [path]);
        onResolved(path);
      },
    },
    { divider: true },
    {
      icon: "edit",
      label: "Edit in external editor",
      onClick: () => openInEditor(repoId, path),
    },
    {
      icon: "undo",
      label: "Restart resolution",
      danger: true,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Restart resolution for ${path}?`,
            body: "Current edits to the conflicted file are discarded and the markers come back.",
            danger: true,
            confirmLabel: "Restart",
          })
        ) {
          await restartConflict(repoId, path);
          onChanged(path);
        }
      },
    },
  ];
}

export function MergeFileList({
  files,
  current,
  repoId,
  width,
  onSelect,
  onResolved,
  onChanged,
}: {
  files: MergeFile[];
  current: string;
  repoId: string;
  width: number;
  onSelect: (path: string) => void;
  onResolved: (path: string) => void;
  onChanged: (path: string) => void;
}) {
  const { onContextMenu, menu } = useContextMenu<{ path: string }>((p) =>
    mergeFileMenuItems({
      repoId,
      path: p?.path ?? "",
      onResolved,
      onChanged,
    }),
  );

  const unresolved = files.filter((f) => !f.resolved).length;

  return (
    <div
      data-testid="merge-file-list"
      style={{
        width,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border-0)",
      }}
    >
      <PGSectionHeader>
        CONFLICTS ({unresolved} of {files.length} left)
      </PGSectionHeader>
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            selected={f.path === current}
            onClick={() => onSelect(f.path)}
            onContextMenu={(e) => onContextMenu(e, { path: f.path })}
          />
        ))}
      </div>
      {menu}
    </div>
  );
}

function FileRow({
  file,
  selected,
  onClick,
  onContextMenu,
}: {
  file: MergeFile;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const parts = file.path.split("/");
  const name = parts.pop() ?? file.path;
  const dir = parts.join("/");
  const glyph = fileIconSpec(file.path);

  return (
    <div
      data-testid="merge-file-row"
      data-path={file.path}
      data-resolved={file.resolved ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        // Density-aware like every other list row (#70): `--row-h` already
        // folds in `--row-step`, so it must not be added again here.
        height: "var(--row-h)",
        cursor: "pointer",
        background: selected ? "var(--bg-selection)" : "transparent",
        borderLeft: `2px solid ${
          selected ? "var(--accent)" : "transparent"
        }`,
        opacity: file.resolved ? 0.55 : 1,
        fontSize: "var(--fs-12)",
      }}
    >
      <span style={{ color: glyph.color, display: "flex", flexShrink: 0 }}>
        <PGIcon name={glyph.icon} size={12} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration: file.resolved ? "line-through" : undefined,
        }}
      >
        {name}
        {dir && (
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: "var(--fs-10)",
              marginLeft: 6,
            }}
          >
            {dir}
          </span>
        )}
      </span>
      <span
        style={{
          color: file.resolved ? "var(--git-added)" : "var(--git-conflict)",
          display: "flex",
          flexShrink: 0,
        }}
      >
        <PGIcon name={file.resolved ? "check" : "conflict"} size={11} />
      </span>
    </div>
  );
}
