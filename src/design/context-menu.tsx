import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PGIcon, type IconName } from "./icons";
import { pgConfirm, pgPrompt } from "./dialog";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { buildRebasePlan } from "@/features/commits/buildRebasePlan";
import { planCommitSelection } from "@/features/commits/planCommitSelection";
import { openMergeWindow } from "@/features/merge/openMergeWindow";
import { chordFor } from "@/features/keymap";

export interface ContextMenuItem {
  label?: ReactNode;
  icon?: IconName | string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  __menuTitle?: string;
  submenu?: ContextMenuItem[];
  /** May be async — the styled confirm/prompt dialogs are promise-based. */
  onClick?: () => void | Promise<void>;
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
    // Fire-and-forget: an async handler awaits a dialog long after the menu
    // has closed, and nothing here consumes its result.
    void item.onClick?.();
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
            ? "oklch(from var(--accent) l c h / 0.18)"
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
        data-pg-menu=""
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

  const openAt = React.useCallback(
    (x: number, y: number, payload: T) => {
      const items =
        typeof builder === "function"
          ? (builder as (p: T) => ContextMenuItem[])(payload)
          : builder;
      if (!items || !items.length) return;
      setState({ x, y, items });
    },
    [builder],
  );

  const menu = state ? (
    <PGContextMenu
      x={state.x}
      y={state.y}
      items={state.items}
      onClose={close}
    />
  ) : null;

  return { onContextMenu, openAt, menu };
}

// ═════════════════════════════════════════════════════════
// CONTEXT MENU CONFIGS
// ═════════════════════════════════════════════════════════

export function commitMenuItems(commit: { sha?: string; subject?: string } | null): ContextMenuItem[] {
  const sha = commit?.sha || "—";
  return [
    { __menuTitle: `commit ${sha.slice(0, 7)}` },
    {
      icon: "check",
      label: "Check out this commit",
      onClick: async () => {
        if (!commit?.sha) return;
        if (
          await pgConfirm({
            title: `Check out ${sha.slice(0, 7)} in detached HEAD?`,
            body: "You won't be on a branch. New commits are easy to lose unless you create one.",
            confirmLabel: "Check out",
          })
        )
          useRepoStore.getState().checkoutRef(commit.sha);
      },
    },
    {
      icon: "branch",
      label: "Create branch from here…",
      onClick: async () => {
        if (!commit?.sha) return;
        const name = await pgPrompt({
          title: "Create branch from here",
          body: `Branching at ${sha.slice(0, 7)}.`,
          placeholder: "feat/my-branch",
          confirmLabel: "Create",
          requireValue: true,
          mono: true,
        });
        if (!name) return;
        await useRepoStore.getState().createBranch(name, commit.sha);
        await useRepoStore.getState().checkoutBranch(name);
      },
    },
    {
      icon: "tag",
      label: "Create tag here…",
      onClick: async () => {
        const name = await pgPrompt({
          title: "Create tag here",
          body: `Tagging ${sha.slice(0, 7)}.`,
          placeholder: "v1.0.0",
          confirmLabel: "Create tag",
          requireValue: true,
          mono: true,
        });
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
      onClick: () => {
        if (!commit?.sha) return;
        const commits = useRepoStore.getState().commits;
        // "Rebase -i from here" means: rebase commits newer than target's parent.
        // The parent of `commit.sha` in our newest-first commits list is the
        // entry at `index + 1`.
        const idx = commits.findIndex((c) => c.oid === commit.sha);
        const base = commits[idx + 1]?.oid;
        if (!base) return;
        const plan = buildRebasePlan(commits, base, { kind: "edit-from" });
        if (!plan || plan.length === 0) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan });
      },
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
      label: "Fixup this commit into its parent",
      onClick: () => {
        if (!commit?.sha) return;
        const commits = useRepoStore.getState().commits;
        const idx = commits.findIndex((c) => c.oid === commit.sha);
        const base = commits[idx + 1]?.oid;
        if (!base) return;
        const plan = buildRebasePlan(commits, base, {
          kind: "fixup",
          targetOid: commit.sha,
        });
        if (!plan) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan });
      },
    },
    {
      icon: "squash",
      label: "Squash this commit into its parent",
      onClick: async () => {
        if (!commit?.sha) return;
        const msg = await pgPrompt({
          title: "Squash into parent",
          body: "Message for the combined commit.",
          initialValue: commit.subject ?? "",
          confirmLabel: "Squash",
          requireValue: true,
        });
        if (!msg) return;
        const commits = useRepoStore.getState().commits;
        const idx = commits.findIndex((c) => c.oid === commit.sha);
        const base = commits[idx + 1]?.oid;
        if (!base) return;
        const plan = buildRebasePlan(commits, base, {
          kind: "squash",
          targetOid: commit.sha,
          message: msg,
        });
        if (!plan) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan });
      },
    },
    { divider: true },
    {
      icon: "diff",
      label: "Compare with HEAD",
      onClick: () => {
        if (!commit?.sha) return;
        useNavStore.getState().setIntent({ kind: "commit-vs-wt", oid: commit.sha });
      },
    },
    { divider: true },
    {
      icon: "copy",
      label: "Copy SHA",
      onClick: () => {
        navigator.clipboard?.writeText(sha);
        pgFlash(`copied ${sha.slice(0, 7)}`);
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

/**
 * Context menu for a multi-commit selection in History. `oids` are the selected
 * commit oids (any order); ancestry facts come from the full log via
 * `planCommitSelection`, so contiguity/base reflect real history rather than
 * the filtered view.
 */
export function commitMultiMenuItems(oids: string[]): ContextMenuItem[] {
  const commits = useRepoStore.getState().commits;
  const plan = planCommitSelection(commits, oids);
  if (!plan) return [{ __menuTitle: "no commits" }];
  const n = plan.oids.length;

  // Squash needs a contiguous, merge-free run with a loaded parent to rebase
  // onto. Surface the blocking reason in the (disabled) label.
  const squashBlock = !plan.contiguous
    ? "non-contiguous"
    : plan.hasMerge
      ? "contains a merge"
      : !plan.baseOid
        ? "oldest is root"
        : null;

  return [
    { __menuTitle: `${n} commits` },
    {
      icon: "diff",
      label: "View combined diff",
      onClick: () => {
        useNavStore.getState().setIntent({
          kind: "commit-vs-commit",
          from: plan.baseOid ?? plan.oldestOid,
          to: plan.newestOid,
        });
      },
    },
    { divider: true },
    {
      icon: "rebase",
      label: `Cherry-pick ${n} onto current`,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Cherry-pick ${n} commits onto the current branch?`,
            body: "They are applied oldest first.",
            confirmLabel: "Cherry-pick",
          })
        )
          useRepoStore.getState().cherryPickMany(plan.oids);
      },
    },
    {
      icon: "squash",
      label: squashBlock ? `Squash ${n} — ${squashBlock}` : `Squash ${n} into one…`,
      disabled: !!squashBlock,
      onClick: async () => {
        if (squashBlock || !plan.baseOid) return;
        const msg = await pgPrompt({
          title: `Squash ${n} commits into one`,
          body: "Message for the combined commit.",
          confirmLabel: "Squash",
          requireValue: true,
        });
        if (!msg) return;
        const rebasePlan = buildRebasePlan(commits, plan.baseOid, {
          kind: "squash-range",
          oids: plan.oids,
          message: msg,
        });
        if (!rebasePlan) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan: rebasePlan });
      },
    },
    { divider: true },
    {
      icon: "copy",
      label: `Copy ${n} SHAs`,
      onClick: () => {
        navigator.clipboard?.writeText(plan.oids.join("\n"));
        pgFlash(`copied ${n} SHAs`);
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
      disabled: isCurrent,
      onClick: () => useRepoStore.getState().checkoutBranch(name),
    },
    {
      icon: "merge",
      label: "Merge into current",
      disabled: isCurrent,
      onClick: async () => {
        if (!name) return;
        if (
          await pgConfirm({
            title: `Merge ${name} into the current branch?`,
            confirmLabel: "Merge",
          })
        )
          useRepoStore.getState().mergeBranch(name);
      },
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      disabled: isCurrent,
      onClick: async () => {
        if (!name) return;
        if (
          await pgConfirm({
            title: `Rebase the current branch onto ${name}?`,
            body: "Your commits are replayed on top — their SHAs change.",
            confirmLabel: "Rebase",
          })
        )
          useRepoStore.getState().rebaseOnto(name);
      },
    },
    { divider: true },
    {
      icon: "sync",
      label: "Pull",
      shortcut: chordFor("repo.pull"),
      disabled: !isCurrent || !upstream,
      onClick: () => useRepoStore.getState().pull(remote, name),
    },
    {
      icon: "push",
      label: "Push",
      shortcut: chordFor("repo.push"),
      disabled: !isCurrent,
      onClick: () => useRepoStore.getState().push(remote, name),
    },
    {
      icon: "fetch",
      label: "Fetch",
      shortcut: chordFor("repo.fetch"),
      onClick: () => useRepoStore.getState().fetch(remote),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Rename…",
      onClick: async () => {
        const to = await pgPrompt({
          title: `Rename ${name}`,
          initialValue: name,
          confirmLabel: "Rename",
          requireValue: true,
          mono: true,
        });
        if (to && to !== name) useRepoStore.getState().renameBranch(name, to);
      },
    },
    {
      icon: "link",
      label: "Set upstream…",
      onClick: async () => {
        if (!name) return;
        // Empty submission clears tracking, dismissal does nothing — so
        // requireValue stays off and null is checked explicitly (#61 D9).
        const next = await pgPrompt({
          title: `Upstream for ${name}`,
          body: "Remote-tracking branch, e.g. origin/main. Leave empty to clear tracking.",
          initialValue: upstream ?? "",
          placeholder: "origin/main",
          confirmLabel: "Set",
          mono: true,
        });
        if (next === null) return;
        const trimmed = next.trim();
        useRepoStore
          .getState()
          .setUpstream(name, trimmed === "" ? null : trimmed);
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
      danger: true,
      disabled: isCurrent,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Delete branch ${name}?`,
            danger: true,
            confirmLabel: "Delete",
          })
        )
          useRepoStore.getState().deleteBranch(name);
      },
    },
    {
      icon: "trash",
      label: "Force delete (-D)",
      danger: true,
      disabled: isCurrent,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Force-delete branch ${name}?`,
            body: "Unmerged commits on it are discarded and are not recoverable from the branch.",
            danger: true,
            confirmLabel: "Force delete",
          })
        )
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
      onClick: async () => {
        if (!name) return;
        const localName = await pgPrompt({
          title: "Check out as new local branch",
          body: `Tracking ${name}.`,
          initialValue: shortName,
          confirmLabel: "Check out",
          requireValue: true,
          mono: true,
        });
        if (!localName) return;
        await useRepoStore.getState().createBranch(localName, name);
        await useRepoStore.getState().checkoutBranch(localName);
      },
    },
    {
      icon: "merge",
      label: "Merge into current",
      onClick: async () => {
        if (!name) return;
        if (
          await pgConfirm({
            title: `Merge ${name} into the current branch?`,
            confirmLabel: "Merge",
          })
        )
          useRepoStore.getState().mergeBranch(name);
      },
    },
    {
      icon: "rebase",
      label: "Rebase current onto this",
      onClick: async () => {
        if (!name) return;
        if (
          await pgConfirm({
            title: `Rebase the current branch onto ${name}?`,
            body: "Your commits are replayed on top — their SHAs change.",
            confirmLabel: "Rebase",
          })
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
      onClick: () => {
        const branches = useRepoStore.getState().branches;
        const head = branches.find((b) => b.isHead);
        const target = branches.find((b) => b.name === name);
        if (!head?.tip || !target?.tip) return;
        useNavStore.getState().setIntent({
          kind: "commit-vs-commit",
          from: head.tip,
          to: target.tip,
        });
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Delete on remote",
      danger: true,
      onClick: async () => {
        if (!remoteName || !shortName) return;
        if (
          await pgConfirm({
            title: `Delete ${shortName} on ${remoteName}?`,
            body: "This deletes the branch for everyone and cannot be undone from here. Type the branch name to confirm.",
            danger: true,
            confirmLabel: "Delete on remote",
            requireText: shortName,
          })
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
      onClick: async () => {
        const newUrl = await pgPrompt({
          title: `URL for remote ${name}`,
          initialValue: url,
          placeholder: "git@github.com:owner/repo.git",
          confirmLabel: "Save",
          requireValue: true,
          mono: true,
        });
        if (newUrl && newUrl !== url)
          useRepoStore.getState().setRemoteUrl(name, newUrl);
      },
    },
    {
      icon: "edit",
      label: "Rename…",
      onClick: async () => {
        const to = await pgPrompt({
          title: `Rename remote ${name}`,
          initialValue: name,
          confirmLabel: "Rename",
          requireValue: true,
          mono: true,
        });
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
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Remove remote "${name}"?`,
            body: "Local branches stay; they just stop tracking it.",
            danger: true,
            confirmLabel: "Remove",
          })
        )
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
      onClick: async () => {
        if (!name) return;
        const branchName = await pgPrompt({
          title: "Create branch from tag",
          body: `Branching at ${name}.`,
          placeholder: "release/1.0",
          confirmLabel: "Create",
          requireValue: true,
          mono: true,
        });
        if (!branchName) return;
        useRepoStore.getState().createBranch(branchName, name);
      },
    },
    { divider: true },
    {
      icon: "push",
      label: "Push tag to remote…",
      onClick: async () => {
        if (!name) return;
        const remote = await pgPrompt({
          title: `Push tag ${name}`,
          initialValue: "origin",
          confirmLabel: "Push",
          requireValue: true,
          mono: true,
        });
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
      onClick: async () => {
        if (!name) return;
        if (
          await pgConfirm({
            title: `Delete tag ${name}?`,
            body: "Only the local tag — a tag already pushed stays on the remote.",
            danger: true,
            confirmLabel: "Delete tag",
          })
        )
          useRepoStore.getState().deleteTag(name);
      },
    },
  ];
}

/**
 * Menu for a row that is an embedded git repository (see FileStatus.embedded).
 *
 * git itself allows `git add vendor/lib` and prints an actionable warning, so a
 * hard block with no way forward would be worse UX than the CLI. Lead with the
 * remedy — "Add to .gitignore" is a one-liner because `appendGitignore` takes
 * the path verbatim and libgit2 reports it with the trailing slash, which is
 * exactly gitignore's directory syntax.
 */
function embeddedRepoMenuItems(path: string): ContextMenuItem[] {
  return [
    { __menuTitle: path || "folder" },
    { icon: "info", label: "Embedded git repository", disabled: true },
    {
      icon: "trash",
      label: "Add to .gitignore",
      onClick: () => {
        if (path) useRepoStore.getState().appendGitignore(path);
      },
    },
    { divider: true },
    {
      icon: "edit",
      label: "Open in editor",
      onClick: () => {
        if (path) useRepoStore.getState().openInEditor(path);
      },
    },
    {
      icon: "copy",
      label: "Copy path",
      onClick: () => navigator.clipboard?.writeText(path),
    },
  ];
}

export function fileMenuItems(
  file: {
    path?: string;
    staged?: boolean;
    embedded?: boolean;
    untracked?: boolean;
  } | null,
): ContextMenuItem[] {
  const staged = !!file?.staged;
  const untracked = !!file?.untracked;
  const path = file?.path || "";
  if (file?.embedded) return embeddedRepoMenuItems(path);
  return [
    { __menuTitle: path || "file" },
    staged
      ? {
          icon: "minus",
          label: "Unstage",
          onClick: () => {
            if (path) useRepoStore.getState().unstage([path]);
          },
        }
      : {
          icon: "plus",
          label: "Stage",
          onClick: () => {
            if (path) useRepoStore.getState().stage([path]);
          },
        },
    {
      icon: "edit",
      label: "Stage hunks…",
      disabled: staged,
      onClick: () => {
        if (!path) return;
        useNavStore.getState().setIntent({ kind: "diff-file", path });
      },
    },
    { divider: true },
    {
      icon: "diff",
      label: "View diff",
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
    // An untracked file has no copy in the index or in history, so discarding
    // it deletes it for good — say so, and never do it on a single click the
    // way a recoverable "restore from index" can be.
    untracked
      ? {
          icon: "trash",
          label: "Delete file…",
          danger: true,
          onClick: async () => {
            if (!path) return;
            if (
              await pgConfirm({
                title: `Delete ${path}?`,
                body: "It is untracked — there is no copy in the index or in history, so this cannot be undone.",
                danger: true,
                confirmLabel: "Delete file",
              })
            ) {
              useRepoStore.getState().discard([path]);
            }
          },
        }
      : {
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

export interface MultiFileMenuSelection {
  /** Selected paths currently staged (index side). */
  stagedPaths: string[];
  /** Selected paths with unstaged (worktree) changes. */
  unstagedPaths: string[];
  /**
   * Every selected file path, including unmodified files (all-files browsing).
   * Drives the count and Copy paths. Defaults to staged ∪ unstaged.
   */
  paths?: string[];
  /**
   * Selected paths that are embedded git repositories. Kept out of
   * staged/unstaged so Stage and Discard act only on real files, and offered
   * their own remedy instead.
   */
  embeddedPaths?: string[];
  /**
   * Subset of `unstagedPaths` that is untracked. Discarding those deletes them
   * outright — git has no copy — so the confirm has to name that separately
   * from the recoverable "restore from index" case.
   */
  untrackedPaths?: string[];
}

/**
 * Context menu for a multi-file selection. Stage/Unstage each act on their
 * own subset so mixed selections work; discard goes through the standard
 * confirm/danger flow before touching the worktree.
 */
export function multiFileMenuItems(
  sel: MultiFileMenuSelection | null,
): ContextMenuItem[] {
  const stagedPaths = sel?.stagedPaths ?? [];
  const unstagedPaths = sel?.unstagedPaths ?? [];
  const embeddedPaths = sel?.embeddedPaths ?? [];
  const all = sel?.paths ?? [...stagedPaths, ...unstagedPaths];
  const n = all.length;
  const files = (c: number) => `${c} file${c === 1 ? "" : "s"}`;
  const items: ContextMenuItem[] = [{ __menuTitle: `${files(n)} selected` }];
  if (embeddedPaths.length) {
    items.push({
      icon: "trash",
      label: `Add ${embeddedPaths.length} embedded repo${
        embeddedPaths.length === 1 ? "" : "s"
      } to .gitignore`,
      onClick: () => {
        const store = useRepoStore.getState();
        for (const p of embeddedPaths) void store.appendGitignore(p);
      },
    });
  }
  if (unstagedPaths.length) {
    items.push({
      icon: "plus",
      label: `Stage ${files(unstagedPaths.length)}`,
      onClick: () => {
        useRepoStore.getState().stage(unstagedPaths);
      },
    });
  }
  if (stagedPaths.length) {
    items.push({
      icon: "minus",
      label: `Unstage ${files(stagedPaths.length)}`,
      onClick: () => {
        useRepoStore.getState().unstage(stagedPaths);
      },
    });
  }
  items.push(
    { divider: true },
    {
      icon: "copy",
      label: "Copy paths",
      onClick: () => {
        navigator.clipboard?.writeText(all.join("\n"));
        pgFlash("copied paths");
      },
    },
  );
  if (unstagedPaths.length) {
    items.push(
      { divider: true },
      {
        icon: "undo",
        label: `Discard changes in ${files(unstagedPaths.length)}…`,
        danger: true,
        onClick: async () => {
          const untracked = sel?.untrackedPaths ?? [];
          const deleted = untracked.length
            ? ` ${files(untracked.length)} ${
                untracked.length === 1 ? "is" : "are"
              } untracked and will be deleted permanently.`
            : "";
          if (
            await pgConfirm({
              title: `Discard changes in ${files(unstagedPaths.length)}?`,
              body: `The changes will be lost.${deleted}`,
              danger: true,
              confirmLabel: "Discard",
            })
          ) {
            useRepoStore.getState().discard(unstagedPaths);
          }
        },
      },
    );
  }
  return items;
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
        const branch = await pgPrompt({
          title: "Branch from stash",
          body: `Creates a branch and applies ${name} onto it.`,
          placeholder: "fix/from-stash",
          confirmLabel: "Create branch",
          requireValue: true,
          mono: true,
        });
        if (!branch) return;
        await useRepoStore.getState().stashBranch(stash.index, branch);
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Drop",
      danger: true,
      onClick: async () => {
        if (stash?.index == null) return;
        if (
          await pgConfirm({
            title: `Drop ${name}?`,
            body: "The stashed changes are discarded.",
            danger: true,
            confirmLabel: "Drop",
          })
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
      label: "Open merge editor",
      onClick: () => {
        const repoId = useRepoStore.getState().current?.id;
        if (repoId && conflict?.path) void openMergeWindow(repoId, conflict.path);
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
      onClick: async () => {
        if (!conflict?.path) return;
        if (
          await pgConfirm({
            title: `Restart resolution for ${conflict.path}?`,
            body: "Current edits to the conflicted file are discarded and the markers come back.",
            danger: true,
            confirmLabel: "Restart",
          })
        )
          useRepoStore.getState().restartConflict(conflict.path);
      },
    },
  ];
}
