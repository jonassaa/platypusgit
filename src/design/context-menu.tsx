import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PGIcon, type IconName } from "./icons";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";

export interface ContextMenuItem {
  label?: ReactNode;
  icon?: IconName | string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  __menuTitle?: string;
  submenu?: ContextMenuItem[];
  onClick?: () => void;
}

// Tiny toast
export function pgFlash(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--bg-3); color: var(--fg-0);
    border: 1px solid var(--border-1); border-radius: var(--r-3);
    padding: 6px 12px; font-size: var(--fs-12);
    font-family: var(--font-mono);
    box-shadow: var(--shadow-2); z-index: 999999;
    animation: pg-fade-in 160ms ease-out;
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms";
    el.style.opacity = "0";
  }, 1400);
  setTimeout(() => el.remove(), 1700);
}

function ContextMenuItemView({
  item,
  onClose,
  onOpenSubmenu,
  onCloseSubmenu,
}: {
  item: ContextMenuItem;
  onClose: () => void;
  onOpenSubmenu: (p: { items: ContextMenuItem[]; x: number; y: number }) => void;
  onCloseSubmenu: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const hasSubmenu = Array.isArray(item.submenu);
  const disabled = !!item.disabled;

  React.useEffect(() => {
    if (!hasSubmenu) return;
    if (hover && ref.current) {
      const r = ref.current.getBoundingClientRect();
      onOpenSubmenu({
        items: item.submenu!,
        x: r.right - 2,
        y: r.top - 4,
      });
    }
  }, [hover, hasSubmenu, item.submenu, onOpenSubmenu]);

  const click = (e: MouseEvent) => {
    if (disabled) return;
    if (hasSubmenu) return;
    e.stopPropagation();
    item.onClick?.();
    onClose();
  };

  const color = disabled
    ? "var(--fg-3)"
    : item.danger
      ? "var(--git-removed)"
      : "var(--fg-0)";

  return (
    <div
      ref={ref}
      onMouseEnter={() => {
        setHover(true);
        if (!hasSubmenu) onCloseSubmenu();
      }}
      onMouseLeave={() => setHover(false)}
      onClick={click}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 12px",
        cursor: disabled ? "default" : "pointer",
        background:
          hover && !disabled
            ? "oklch(0.72 0.15 235 / 0.18)"
            : "transparent",
        color,
      }}
    >
      {item.icon ? (
        <span
          style={{
            width: 14,
            height: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.8,
          }}
        >
          <PGIcon name={item.icon} size={13} />
        </span>
      ) : (
        <span style={{ width: 14 }} />
      )}
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {item.label}
      </span>
      {item.shortcut && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            opacity: 0.55,
          }}
        >
          {item.shortcut}
        </span>
      )}
      {hasSubmenu && (
        <span style={{ opacity: 0.6, fontSize: 10 }}>▸</span>
      )}
    </div>
  );
}

export function PGContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = React.useState<{
    items: ContextMenuItem[];
    x: number;
    y: number;
  } | null>(null);

  React.useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("contextmenu", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const [pos, setPos] = React.useState({ x, y });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    let nx = x,
      ny = y;
    if (x + r.width + 4 > vw) nx = Math.max(4, vw - r.width - 4);
    if (y + r.height + 4 > vh) ny = Math.max(4, vh - r.height - 4);
    setPos({ x: nx, y: ny });
  }, [x, y, items]);

  const menuStyle: CSSProperties = {
    position: "fixed",
    left: pos.x,
    top: pos.y,
    background: "var(--bg-3)",
    border: "1px solid var(--border-1)",
    borderRadius: "var(--r-3)",
    boxShadow: "var(--shadow-2)",
    padding: "4px 0",
    minWidth: 220,
    maxWidth: 320,
    fontFamily: "var(--font-sans)",
    fontSize: "var(--fs-12)",
    color: "var(--fg-0)",
    zIndex: 100000,
    userSelect: "none",
    animation: "pgCtxFadeIn 100ms ease-out",
  };

  return createPortal(
    <>
      <div
        ref={ref}
        style={menuStyle}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) => {
          if (it.__menuTitle) {
            return (
              <div
                key={i}
                style={{
                  padding: "4px 12px 6px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--fg-2)",
                  borderBottom: "1px solid var(--border-1)",
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.__menuTitle}
              </div>
            );
          }
          if (it.divider) {
            return (
              <div
                key={i}
                style={{
                  height: 1,
                  background: "var(--border-1)",
                  margin: "4px 0",
                }}
              />
            );
          }
          return (
            <ContextMenuItemView
              key={i}
              item={it}
              onClose={onClose}
              onOpenSubmenu={setSubmenu}
              onCloseSubmenu={() => setSubmenu(null)}
            />
          );
        })}
      </div>
      {submenu && (
        <PGContextMenu
          x={submenu.x}
          y={submenu.y}
          items={submenu.items}
          onClose={onClose}
        />
      )}
    </>,
    document.body,
  );
}

export function useContextMenu<T>(
  builder: ContextMenuItem[] | ((payload: T) => ContextMenuItem[]),
) {
  const [state, setState] = React.useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const onContextMenu = React.useCallback(
    (e: MouseEvent, payload: T) => {
      e.preventDefault();
      e.stopPropagation();
      const items =
        typeof builder === "function"
          ? (builder as (p: T) => ContextMenuItem[])(payload)
          : builder;
      if (!items || !items.length) return;
      setState({ x: e.clientX, y: e.clientY, items });
    },
    [builder],
  );

  const close = React.useCallback(() => setState(null), []);

  const menu = state ? (
    <PGContextMenu
      x={state.x}
      y={state.y}
      items={state.items}
      onClose={close}
    />
  ) : null;

  return { onContextMenu, menu };
}

// ═════════════════════════════════════════════════════════
// CONTEXT MENU CONFIGS
// ═════════════════════════════════════════════════════════

export function commitMenuItems(commit: { sha?: string; subject?: string } | null): ContextMenuItem[] {
  const sha = commit?.sha || "—";
  return [
    { __menuTitle: `commit ${sha}` },
    {
      icon: "check",
      label: "Check out this commit",
      shortcut: "⌘⇧C",
      onClick: () => {
        if (!commit?.sha) return;
        if (window.confirm(`Check out ${sha} in detached HEAD?`))
          useRepoStore.getState().checkoutRef(commit.sha);
      },
    },
    {
      icon: "branch",
      label: "Create branch from here…",
      onClick: async () => {
        if (!commit?.sha) return;
        const name = window.prompt("New branch name");
        if (!name) return;
        await useRepoStore.getState().createBranch(name, commit.sha);
        await useRepoStore.getState().checkoutBranch(name);
      },
    },
    {
      icon: "tag",
      label: "Create tag here…",
      onClick: () => {
        const name = window.prompt("Tag name");
        if (!name || !commit) return;
        useRepoStore.getState().createTag(name, {
          oid: commit.sha ?? "",
          annotation: null,
        });
      },
    },
    { divider: true },
    {
      icon: "rebase",
      label: "Cherry-pick onto current",
      shortcut: "⌘Y",
      onClick: () => {
        if (commit?.sha) useRepoStore.getState().cherryPick(commit.sha);
      },
    },
    {
      icon: "undo",
      label: "Revert commit",
      onClick: () => {
        if (commit?.sha) useRepoStore.getState().revert(commit.sha);
      },
    },
    {
      icon: "rebase",
      label: "Interactive rebase from here",
      onClick: () => pgFlash(`rebase -i ${sha}^`),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Reset current branch to here",
      submenu: [
        {
          icon: "dot",
          label: "Soft (keep changes staged)",
          onClick: () => useRepoStore.getState().reset(sha, "Soft"),
        },
        {
          icon: "dot",
          label: "Mixed (keep changes unstaged)",
          onClick: () => useRepoStore.getState().reset(sha, "Mixed"),
        },
        {
          icon: "trash",
          label: "Hard (discard changes)",
          danger: true,
          onClick: () => useRepoStore.getState().reset(sha, "Hard"),
        },
      ],
    },
    {
      icon: "fix",
      label: "Fixup into this commit…",
      onClick: () => pgFlash(`fixup ${sha}`),
    },
    {
      icon: "squash",
      label: "Squash into this commit…",
      onClick: () => pgFlash(`squash ${sha}`),
    },
    { divider: true },
    {
      icon: "diff",
      label: "Compare with working tree",
      onClick: () => pgFlash(`diff ${sha}..WT`),
    },
    { divider: true },
    {
      icon: "copy",
      label: "Copy SHA",
      shortcut: "⌘C",
      onClick: () => {
        navigator.clipboard?.writeText(sha);
        pgFlash(`copied ${sha}`);
      },
    },
    {
      icon: "copy",
      label: "Copy subject line",
      onClick: () => {
        navigator.clipboard?.writeText(commit?.subject || "");
        pgFlash("copied subject");
      },
    },
  ];
}

export function branchMenuItems(
  branch: { name?: string; current?: boolean; upstream?: string | null } | null,
): ContextMenuItem[] {
  const isCurrent = !!branch?.current;
  const name = branch?.name || "";
  const upstream = branch?.upstream || null;
  // Upstream is typically "origin/feature/foo" — remote is the first segment.
  const remote = upstream ? upstream.split("/")[0] : "origin";
  return [
    { __menuTitle: name || "branch" },
    {
      icon: "check",
      label: "Check out",
      shortcut: "⌘⇧O",
      disabled: isCurrent,
      onClick: () => useRepoStore.getState().checkoutBranch(name),
    },
    {
      icon: "merge",
      label: "Merge into current",
      disabled: isCurrent,
      onClick: () => {
        if (!name) return;
        if (
          window.confirm(
            `Merge ${name} into the current branch?`,
          )
        )
          useRepoStore.getState().mergeBranch(name);
      },
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      disabled: isCurrent,
      onClick: () => {
        if (!name) return;
        if (
          window.confirm(
            `Rebase the current branch onto ${name}?`,
          )
        )
          useRepoStore.getState().rebaseOnto(name);
      },
    },
    { divider: true },
    {
      icon: "sync",
      label: "Pull",
      disabled: !isCurrent || !upstream,
      onClick: () => useRepoStore.getState().pull(remote, name),
    },
    {
      icon: "push",
      label: "Push",
      disabled: !isCurrent,
      onClick: () => useRepoStore.getState().push(remote, name),
    },
    {
      icon: "fetch",
      label: "Fetch",
      onClick: () => useRepoStore.getState().fetch(remote),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Rename…",
      shortcut: "F2",
      onClick: () => {
        const to = window.prompt("New name", name);
        if (to && to !== name) useRepoStore.getState().renameBranch(name, to);
      },
    },
    {
      icon: "copy",
      label: "Copy name",
      onClick: () => {
        navigator.clipboard?.writeText(name);
        pgFlash("copied");
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Delete",
      shortcut: "⌫",
      danger: true,
      disabled: isCurrent,
      onClick: () => {
        if (window.confirm(`Delete ${name}?`))
          useRepoStore.getState().deleteBranch(name);
      },
    },
    {
      icon: "trash",
      label: "Force delete (-D)",
      danger: true,
      disabled: isCurrent,
      onClick: () => {
        if (window.confirm(`Force-delete ${name}? This will discard unmerged commits.`))
          useRepoStore.getState().deleteBranch(name, true);
      },
    },
  ];
}

export function remoteBranchMenuItems(branch: { name?: string } | null): ContextMenuItem[] {
  const name = branch?.name || "";
  // name is like "origin/feature" — parse out the remote prefix
  const slashIdx = name.indexOf("/");
  const remoteName = slashIdx >= 0 ? name.slice(0, slashIdx) : name;
  const shortName = slashIdx >= 0 ? name.slice(slashIdx + 1) : name;
  return [
    { __menuTitle: name || "remote branch" },
    {
      icon: "branch",
      label: "Check out as new local branch…",
      onClick: () => {
        if (!name) return;
        const localName = window.prompt("Local branch name", shortName);
        if (!localName) return;
        (async () => {
          await useRepoStore.getState().createBranch(localName, name);
          await useRepoStore.getState().checkoutBranch(localName);
        })();
      },
    },
    {
      icon: "merge",
      label: "Merge into current",
      onClick: () => {
        if (!name) return;
        if (window.confirm(`Merge ${name} into the current branch?`))
          useRepoStore.getState().mergeBranch(name);
      },
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      onClick: () => {
        if (!name) return;
        if (
          window.confirm(`Rebase the current branch onto ${name}?`)
        )
          useRepoStore.getState().rebaseOnto(name);
      },
    },
    { divider: true },
    {
      icon: "fetch",
      label: "Fetch remote",
      onClick: () =>
        remoteName
          ? useRepoStore.getState().fetch(remoteName)
          : useRepoStore.getState().fetchAll(),
    },
    {
      icon: "diff",
      label: "Compare with current",
      onClick: () => pgFlash(`diff HEAD..${name}`),
    },
    { divider: true },
    {
      icon: "trash",
      label: "Delete on remote",
      danger: true,
      onClick: () => {
        if (!remoteName || !shortName) return;
        if (
          window.confirm(
            `Delete ${shortName} on ${remoteName}? This cannot be undone.`,
          )
        )
          useRepoStore.getState().pushDeleteBranch(remoteName, shortName);
      },
    },
  ];
}

export function remoteMenuItems(remote: { name?: string; url?: string | null } | null): ContextMenuItem[] {
  const name = remote?.name || "";
  const url = remote?.url ?? "";
  return [
    { __menuTitle: name || "remote" },
    {
      icon: "fetch",
      label: "Fetch",
      onClick: () => useRepoStore.getState().fetch(name),
    },
    {
      icon: "pull",
      label: "Prune stale refs",
      onClick: () => useRepoStore.getState().pruneRemote(name),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Edit URL…",
      onClick: () => {
        const newUrl = window.prompt("New URL", url);
        if (newUrl && newUrl !== url)
          useRepoStore.getState().setRemoteUrl(name, newUrl);
      },
    },
    {
      icon: "edit",
      label: "Rename…",
      onClick: () => {
        const to = window.prompt("New name", name);
        if (to && to !== name)
          useRepoStore.getState().renameRemote(name, to);
      },
    },
    {
      icon: "copy",
      label: "Copy URL",
      onClick: () => {
        if (url) navigator.clipboard?.writeText(url);
        pgFlash("copied URL");
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Remove remote",
      danger: true,
      onClick: () => {
        if (window.confirm(`Remove remote "${name}"?`))
          useRepoStore.getState().removeRemote(name);
      },
    },
  ];
}

export function tagMenuItems(
  tag: { name?: string; sha?: string; oid?: string } | null,
): ContextMenuItem[] {
  const name = tag?.name || "";
  const oid = tag?.oid || tag?.sha || "";
  return [
    { __menuTitle: name || "tag" },
    {
      icon: "check",
      label: "Check out (detached)",
      onClick: () => {
        if (!name) return;
        useRepoStore.getState().checkoutRef(`refs/tags/${name}`);
      },
    },
    {
      icon: "branch",
      label: "Create branch from tag…",
      onClick: () => {
        if (!name) return;
        const branchName = window.prompt("New branch name");
        if (!branchName) return;
        useRepoStore.getState().createBranch(branchName, name);
      },
    },
    { divider: true },
    {
      icon: "push",
      label: "Push tag to remote…",
      onClick: () => {
        if (!name) return;
        const remote = window.prompt("Remote name", "origin");
        if (!remote) return;
        useRepoStore.getState().pushTag(remote, name);
      },
    },
    {
      icon: "copy",
      label: "Copy SHA",
      onClick: () => {
        navigator.clipboard?.writeText(oid);
        pgFlash("copied");
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Delete tag",
      danger: true,
      onClick: () => {
        if (name && window.confirm(`Delete tag ${name}?`))
          useRepoStore.getState().deleteTag(name);
      },
    },
  ];
}

export function fileMenuItems(
  file: { path?: string; staged?: boolean } | null,
): ContextMenuItem[] {
  const staged = !!file?.staged;
  const path = file?.path || "";
  return [
    { __menuTitle: path || "file" },
    staged
      ? {
          icon: "minus",
          label: "Unstage",
          shortcut: "⌘⇧U",
          onClick: () => {
            if (path) useRepoStore.getState().unstage([path]);
          },
        }
      : {
          icon: "plus",
          label: "Stage",
          shortcut: "⌘⇧S",
          onClick: () => {
            if (path) useRepoStore.getState().stage([path]);
          },
        },
    {
      icon: "edit",
      label: "Stage hunks…",
      disabled: staged,
      onClick: () => pgFlash("hunk picker"),
    },
    { divider: true },
    {
      icon: "diff",
      label: "View diff",
      shortcut: "⏎",
      onClick: () => {
        if (!path) return;
        useNavStore.getState().setIntent({ kind: "diff-file", path });
      },
    },
    {
      icon: "search",
      label: "Blame",
      onClick: () => {
        if (!path) return;
        useNavStore.getState().setIntent({ kind: "blame", path });
      },
    },
    {
      icon: "history",
      label: "File history",
      onClick: () => {
        if (!path) return;
        useNavStore.getState().setIntent({ kind: "file-history", path });
      },
    },
    {
      icon: "edit",
      label: "Open in editor",
      shortcut: "⌘O",
      onClick: () => {
        if (!path) return;
        useRepoStore.getState().openInEditor(path);
      },
    },
    { divider: true },
    {
      icon: "copy",
      label: "Copy path",
      onClick: () => navigator.clipboard?.writeText(path),
    },
    { divider: true },
    {
      icon: "undo",
      label: "Discard changes",
      danger: true,
      disabled: staged,
      onClick: () => {
        if (path) useRepoStore.getState().discard([path]);
      },
    },
    {
      icon: "trash",
      label: "Ignore this file",
      onClick: () => {
        if (!path) return;
        useRepoStore.getState().appendGitignore(path);
      },
    },
  ];
}

export function stashMenuItems(
  stash: { name?: string; index?: number } | null,
): ContextMenuItem[] {
  const name = stash?.name ?? `stash@{${stash?.index ?? 0}}`;
  return [
    { __menuTitle: name },
    {
      icon: "check",
      label: "Apply (keep stash)",
      onClick: () => {
        if (stash?.index != null) useRepoStore.getState().stashApply(stash.index);
      },
    },
    {
      icon: "check",
      label: "Pop (apply + drop)",
      onClick: () => {
        if (stash?.index != null) useRepoStore.getState().stashPop(stash.index);
      },
    },
    {
      icon: "branch",
      label: "Branch from stash…",
      onClick: async () => {
        if (stash?.index == null) return;
        const branch = window.prompt("Branch name");
        if (!branch) return;
        await useRepoStore.getState().stashBranch(stash.index, branch);
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Drop",
      danger: true,
      onClick: () => {
        if (
          stash?.index != null &&
          window.confirm(`Drop ${name}?`)
        )
          useRepoStore.getState().stashDrop(stash.index);
      },
    },
  ];
}

export function conflictMenuItems(conflict: { path?: string } | null): ContextMenuItem[] {
  return [
    { __menuTitle: conflict?.path || "conflict" },
    {
      icon: "check",
      label: "Accept ours",
      onClick: () => {
        if (conflict?.path) useRepoStore.getState().acceptOurs(conflict.path);
      },
    },
    {
      icon: "check",
      label: "Accept theirs",
      onClick: () => {
        if (conflict?.path) useRepoStore.getState().acceptTheirs(conflict.path);
      },
    },
    {
      icon: "merge",
      label: "Open 3-way merge tool",
      onClick: () => {
        if (!conflict?.path) return;
        useRepoStore.getState().runMergetool(conflict.path);
      },
    },
    { divider: true },
    {
      icon: "edit",
      label: "Edit resolution in editor",
      onClick: () => {
        if (!conflict?.path) return;
        useRepoStore.getState().openInEditor(conflict.path);
      },
    },
    {
      icon: "check",
      label: "Mark as resolved",
      onClick: () => {
        if (conflict?.path) useRepoStore.getState().markResolved([conflict.path]);
      },
    },
    { divider: true },
    {
      icon: "undo",
      label: "Restart resolution",
      danger: true,
      onClick: () => {
        if (!conflict?.path) return;
        if (
          window.confirm(
            `Restart resolution for ${conflict.path}? Current edits are discarded.`,
          )
        )
          useRepoStore.getState().restartConflict(conflict.path);
      },
    },
  ];
}
