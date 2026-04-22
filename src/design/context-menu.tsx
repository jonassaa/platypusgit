import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PGIcon, type IconName } from "./icons";

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
      onClick: () => pgFlash(`checked out ${sha} (detached)`),
    },
    {
      icon: "branch",
      label: "Create branch from here…",
      onClick: () => pgFlash(`new branch from ${sha}`),
    },
    {
      icon: "tag",
      label: "Create tag here…",
      onClick: () => pgFlash(`tag at ${sha}`),
    },
    { divider: true },
    {
      icon: "rebase",
      label: "Cherry-pick onto current",
      shortcut: "⌘Y",
      onClick: () => pgFlash(`cherry-picked ${sha}`),
    },
    {
      icon: "undo",
      label: "Revert commit",
      onClick: () => pgFlash(`revert commit ${sha}`),
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
          onClick: () => pgFlash(`reset --soft ${sha}`),
        },
        {
          icon: "dot",
          label: "Mixed (keep changes unstaged)",
          onClick: () => pgFlash(`reset --mixed ${sha}`),
        },
        {
          icon: "trash",
          label: "Hard (discard changes)",
          danger: true,
          onClick: () => pgFlash(`reset --hard ${sha}`),
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

export function branchMenuItems(branch: { name?: string; current?: boolean } | null): ContextMenuItem[] {
  const isCurrent = !!branch?.current;
  const name = branch?.name || "";
  return [
    { __menuTitle: name || "branch" },
    {
      icon: "check",
      label: "Check out",
      shortcut: "⌘⇧O",
      disabled: isCurrent,
      onClick: () => pgFlash(`checked out ${name}`),
    },
    {
      icon: "merge",
      label: "Merge into current",
      disabled: isCurrent,
      onClick: () => pgFlash(`merge ${name}`),
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      disabled: isCurrent,
      onClick: () => pgFlash(`rebase onto ${name}`),
    },
    { divider: true },
    { icon: "sync", label: "Pull", onClick: () => pgFlash(`pull ${name}`) },
    { icon: "push", label: "Push", onClick: () => pgFlash(`push ${name}`) },
    { icon: "fetch", label: "Fetch", onClick: () => pgFlash(`fetch ${name}`) },
    { divider: true },
    {
      icon: "edit",
      label: "Rename…",
      shortcut: "F2",
      onClick: () => pgFlash(`rename ${name}`),
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
      onClick: () => pgFlash(`deleted ${name}`),
    },
    {
      icon: "trash",
      label: "Force delete (-D)",
      danger: true,
      disabled: isCurrent,
      onClick: () => pgFlash(`force-deleted ${name}`),
    },
  ];
}

export function remoteBranchMenuItems(branch: { name?: string } | null): ContextMenuItem[] {
  const name = branch?.name || "";
  return [
    { __menuTitle: name || "remote branch" },
    {
      icon: "branch",
      label: "Check out as new local branch",
      onClick: () => pgFlash(`checkout -b local ${name}`),
    },
    {
      icon: "merge",
      label: "Merge into current",
      onClick: () => pgFlash(`merge ${name}`),
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      onClick: () => pgFlash(`rebase onto ${name}`),
    },
    { divider: true },
    { icon: "fetch", label: "Fetch", onClick: () => pgFlash(`fetch ${name}`) },
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
      onClick: () => pgFlash(`push --delete ${name}`),
    },
  ];
}

export function tagMenuItems(tag: { name?: string; sha?: string } | null): ContextMenuItem[] {
  const name = tag?.name || "";
  return [
    { __menuTitle: name || "tag" },
    {
      icon: "check",
      label: "Check out",
      onClick: () => pgFlash(`checked out ${name}`),
    },
    {
      icon: "branch",
      label: "Create branch from tag…",
      onClick: () => pgFlash(`branch from ${name}`),
    },
    { divider: true },
    {
      icon: "push",
      label: "Push tag to remote",
      onClick: () => pgFlash(`push ${name}`),
    },
    {
      icon: "copy",
      label: "Copy SHA",
      onClick: () => navigator.clipboard?.writeText(tag?.sha || ""),
    },
    { divider: true },
    {
      icon: "trash",
      label: "Delete tag",
      danger: true,
      onClick: () => pgFlash(`deleted ${name}`),
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
          onClick: () => pgFlash(`unstaged ${path}`),
        }
      : {
          icon: "plus",
          label: "Stage",
          shortcut: "⌘⇧S",
          onClick: () => pgFlash(`staged ${path}`),
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
      onClick: () => pgFlash(`diff ${path}`),
    },
    {
      icon: "search",
      label: "Blame",
      onClick: () => pgFlash(`blame ${path}`),
    },
    {
      icon: "history",
      label: "File history",
      onClick: () => pgFlash(`log -- ${path}`),
    },
    {
      icon: "edit",
      label: "Open in editor",
      shortcut: "⌘O",
      onClick: () => pgFlash(`open ${path}`),
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
      onClick: () => pgFlash(`discarded ${path}`),
    },
    {
      icon: "trash",
      label: "Ignore this file",
      onClick: () => pgFlash(`added to .gitignore`),
    },
  ];
}

export function conflictMenuItems(conflict: { path?: string } | null): ContextMenuItem[] {
  return [
    { __menuTitle: conflict?.path || "conflict" },
    {
      icon: "check",
      label: "Accept ours",
      onClick: () => pgFlash("took ours"),
    },
    {
      icon: "check",
      label: "Accept theirs",
      onClick: () => pgFlash("took theirs"),
    },
    {
      icon: "merge",
      label: "Open 3-way merge tool",
      onClick: () => pgFlash("mergetool"),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Edit resolution in editor",
      onClick: () => pgFlash("open editor"),
    },
    {
      icon: "check",
      label: "Mark as resolved",
      onClick: () => pgFlash("marked resolved"),
    },
    { divider: true },
    {
      icon: "undo",
      label: "Restart resolution",
      danger: true,
      onClick: () => pgFlash("restarted"),
    },
  ];
}
