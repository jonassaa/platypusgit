import React, { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PGIcon, type IconName } from "./icons";
import { pgConfirm, pgPrompt } from "./dialog";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSubmodulesStore } from "@/features/submodules/useSubmodulesStore";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { buildRebasePlan } from "@/features/commits/buildRebasePlan";
import { planCommitSelection } from "@/features/commits/planCommitSelection";
import { headAncestryOf } from "@/features/commits/headAncestry";
import { runRebasePlanNow } from "@/features/commits/runRebasePlan";
import { combinedSquashMessage } from "@/features/commits/squashMessage";
import type { BranchInfo, CommitInfo, FileDiff } from "@/lib/types";
import { fileDiffToText, selectedLinesToText } from "@/lib/diffCopy";
import { orderBranchesGrouped } from "@/features/branches/orderBranches";
import { openMergeWindow } from "@/features/merge/openMergeWindow";
import {
  markedRefFor,
  openCompare,
  useCompareStore,
} from "@/features/compare/useCompareStore";
import { WORKDIR } from "@/features/compare/compareSides";
import { currentBranch } from "@/lib/derive";
import { openCreateTag } from "@/features/tags/useCreateTagStore";
import { chordFor } from "@/features/keymap";
import { fileManagerLabel, type Platform } from "@/lib/platform";
import { absoluteInWorkdir, relativeToWorkdir } from "@/lib/paths";
// pgFlash lives in ui-helpers.tsx — a toast is not a context-menu concern, and
// keeping it out of this module is what lets features/keymap import it without
// closing a cycle back through this file (which imports chordFor from there).
import { pgFlash } from "./ui-helpers";
import { describeFastForward } from "@/features/branches/fastForward";

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

/** What a diff surface knows about the selections a reader could copy. */
export interface DiffCopyTarget {
  diff: FileDiff | null;
  /**
   * The surface's line selection, hunk index → selected `changedIndex` values.
   * Omitted by the read-only surfaces, which have no line selection to offer.
   */
  lineSel?: Record<number, number[]>;
}

/**
 * The copy entries for a diff's own context menu, shared by all four diff
 * surfaces.
 *
 * Right-click is the discoverable half of `diff.copy` (Mod+C): the diff is
 * windowed, so a mouse selection cannot reach past the rendered rows, and
 * without these entries there is no way at all to copy a range longer than a
 * screenful.
 *
 * Only the selections that EXIST are offered — an entry that copied an empty
 * string would be worse than no entry. The text-selection check reads the live
 * selection, which is correct here because a right-click does not clear one:
 * this builder runs from the `contextmenu` handler, while the drag's selection
 * is still on screen.
 */
export function diffCopyMenuItems(
  target: DiffCopyTarget | null,
): ContextMenuItem[] {
  const diff = target?.diff;
  if (!diff) return [];
  const items: ContextMenuItem[] = [];

  const textSel = window.getSelection();
  const dragged = textSel && !textSel.isCollapsed ? textSel.toString() : "";
  if (dragged) {
    items.push({
      icon: "copy",
      label: "Copy",
      onClick: () => {
        navigator.clipboard?.writeText(dragged);
        pgFlash("copied selection");
      },
    });
  }

  const lineSel = target?.lineSel ?? {};
  const lineCount = Object.values(lineSel).reduce((n, l) => n + l.length, 0);
  if (lineCount > 0) {
    items.push({
      icon: "copy",
      label: `Copy ${lineCount} selected line${lineCount === 1 ? "" : "s"}`,
      onClick: () => {
        navigator.clipboard?.writeText(selectedLinesToText(diff, lineSel));
        pgFlash(`copied ${lineCount} line${lineCount === 1 ? "" : "s"}`);
      },
    });
  }

  items.push({
    icon: "copy",
    label: "Copy file diff as text",
    onClick: () => {
      navigator.clipboard?.writeText(fileDiffToText(diff));
      pgFlash("copied diff");
    },
  });

  return items;
}

export function commitMenuItems(commit: { sha?: string; subject?: string } | null): ContextMenuItem[] {
  const sha = commit?.sha || "—";
  // Ancestry for the rebase entry points, from the full log. The base is the
  // commit's FIRST PARENT — never the next log row, which on a graph is often a
  // side-branch commit (see planCommitSelection). A merge commit is a legal
  // start point (base = its mainline parent), but folding one into its parent
  // is not: "squash a merge into its parent" has no coherent meaning.
  //
  // The lookup runs over HEAD's ANCESTRY, not the raw log: History walks every
  // branch, so a commit in the list may not be on the current branch at all —
  // and a rebase plan built around one replays a foreign branch onto this one
  // (see headAncestry.ts). Not finding it here is what disables these entries.
  const commits = ancestryLog();
  const self = commit?.sha ? (commits.find((c) => c.oid === commit.sha) ?? null) : null;
  const onBranch = !!self;
  const isMerge = (self?.parents.length ?? 0) > 1;
  const baseOid = self?.parents[0] ?? null;
  return [
    { __menuTitle: `commit ${sha.slice(0, 7)}` },
    // ABOVE the detached-HEAD entry (#179): when a branch is here, checking it
    // out is both the safer and the far more common intent, and the detached
    // entry stays for when it genuinely is what you want.
    ...checkoutBranchItems(commit?.sha),
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
      onClick: () => {
        // The dialog carries name + annotation + signing (#132); a single-value
        // prompt could only ever make a lightweight one.
        if (commit?.sha) void openCreateTag({ oid: commit.sha });
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
      label: !onBranch
        ? "Interactive rebase from here — not on this branch"
        : baseOid
          ? "Interactive rebase from here"
          : "Interactive rebase from here — root commit",
      disabled: !onBranch || !baseOid,
      onClick: () => {
        if (!commit?.sha || !baseOid) return;
        // "Rebase -i from here" means: replay everything newer than this
        // commit's parent, this commit included.
        const plan = buildRebasePlan(commits, baseOid, { kind: "edit-from" });
        if (!plan || plan.length === 0) return;
        useNavStore.getState().setIntent({ kind: "rebase-plan", plan });
      },
    },
    {
      icon: "rebase",
      // The OTHER half of interactive rebase (186), and a genuinely different
      // action: "from here" makes the clicked commit the OLDEST REPLAYED commit
      // (base = its parent); this makes it the NEW BASE, which is not in the plan
      // at all. Disabled for a commit already on this branch, mirroring
      // branchMenuItems' `disabled: isCurrent` — replaying onto your own ancestor
      // is a no-op, and the item above is what that flow wants. So the two are
      // never both enabled for one commit.
      label: onBranch
        ? "Rebase current branch onto this — already on this branch"
        : "Rebase current branch onto this…",
      disabled: onBranch || !commit?.sha,
      onClick: () => {
        if (!commit?.sha) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: commit.sha,
          label: `${sha.slice(0, 7)} — ${commit.subject ?? ""}`.trim(),
        });
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
      label: !onBranch
        ? "Fixup into parent — not on this branch"
        : isMerge
          ? "Fixup into parent — merge commit"
          : "Fixup this commit into its parent",
      disabled: !onBranch || isMerge || !baseOid,
      onClick: async () => {
        if (!commit?.sha || isMerge || !baseOid) return;
        const plan = buildRebasePlan(commits, baseOid, {
          kind: "fixup",
          targetOid: commit.sha,
        });
        if (!plan) return;
        const outcome = await runRebasePlanNow(plan);
        if (outcome === "done") pgFlash("fixed up into parent");
        else if (outcome === "paused") pgFlash("fixup paused — see the Conflicts screen");
      },
    },
    {
      icon: "squash",
      label: !onBranch
        ? "Squash into parent — not on this branch"
        : isMerge
          ? "Squash into parent — merge commit"
          : "Squash this commit into its parent",
      disabled: !onBranch || isMerge || !baseOid,
      onClick: async () => {
        if (!commit?.sha || isMerge || !baseOid) return;
        const target = commit.sha;
        const msg = await pgPrompt({
          title: "Squash into parent",
          body: "Message for the combined commit — the parent's, then this one's.",
          // The parent is the older of the two, so its message leads.
          initialValue: combinedSquashMessage([baseOid, target], byOid(commits)),
          confirmLabel: "Squash",
          requireValue: true,
          multiline: 8,
        });
        if (!msg) return;
        const plan = buildRebasePlan(commits, baseOid, {
          kind: "squash",
          targetOid: target,
          message: msg,
        });
        if (!plan) return;
        const outcome = await runRebasePlanNow(plan);
        if (outcome === "done") pgFlash("squashed into parent");
        else if (outcome === "paused") pgFlash("squash paused — see the Conflicts screen");
      },
    },
    { divider: true },
    // The commit's OWN diff (parent..commit) — what Enter on the row and the
    // inline panel already show, and what "View combined diff" shows for a
    // selection of several (#158). Until this existed the menu's only
    // diff-shaped entry was the one below, so right-clicking one commit and
    // right-clicking three offered two different comparisons.
    {
      icon: "diff",
      label: "View diff",
      onClick: () => {
        if (!commit?.sha) return;
        useNavStore.getState().setIntent({ kind: "commit-self", oid: commit.sha });
      },
    },
    // Kept alongside it: a genuinely different question — this commit's tree
    // against the working tree, not against its parent.
    {
      icon: "diff",
      label: "Compare with HEAD",
      onClick: () => {
        if (!commit?.sha) return;
        useNavStore.getState().setIntent({ kind: "commit-vs-wt", oid: commit.sha });
      },
    },
    { divider: true },
    ...bisectSubmenu(commit?.sha ?? null),
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
/** Oid → commit, for the squash prompts' prefilled messages. */
function byOid(commits: CommitInfo[]): Map<string, CommitInfo> {
  return new Map(commits.map((c) => [c.oid, c]));
}

/**
 * The log restricted to HEAD's ancestry — what every rebase op is defined over.
 * History's walk covers all branches, so the raw store list can hold commits
 * HEAD cannot reach; see headAncestry.ts.
 */
function ancestryLog(): CommitInfo[] {
  const { commits, branches } = useRepoStore.getState();
  return headAncestryOf(commits, branches);
}

/**
 * A branch's tip oid, for menu items that must name a fixed commit rather than a
 * moving ref (186). `BranchInfo.tip` is a FULL oid and is used as one — it was
 * once truncated to 7 chars and every comparison against `CommitInfo.oid` then
 * failed silently. Null when the branch is unknown or its tip is unresolvable;
 * the caller then falls back to the NAME, which the backend revparses anyway.
 */
function branchTipOid(name: string): string | null {
  return useRepoStore.getState().branches.find((b) => b.name === name)?.tip ?? null;
}

/**
 * The branch refs pointing exactly AT one commit (#179) — what "check out the
 * branch that is already here" is built from.
 *
 * Read off `useRepoStore.branches`, NOT off `CommitInfo.refs`: the store rows
 * carry `isHead` / `isRemote` / `upstream`, which is what lets the current
 * branch be disabled and a remote-only ref be routed through the
 * tracking-branch flow instead of a silent detach. `mapCommitRefs`' names are
 * display strings and lossy on purpose — HEAD reads `HEAD→main` and a remote
 * ref is split into name + remote — so they are no use for naming an op.
 *
 * `BranchInfo.tip` is a FULL oid and is compared as one. It was once truncated
 * to 7 chars and every comparison against `CommitInfo.oid` then failed
 * silently, so never shorten either side here — `shortSha` belongs at display
 * sites, and a prefix match would put a foreign branch on the menu. Both
 * nullable ends are then stated rather than relied on: an unresolvable `tip` and
 * a commit with no sha are both "no branch here", and writing that out is
 * cheaper than re-deriving that `null === undefined` happens to be false.
 *
 * DELIBERATELY blind to History's `refFilter`. That control hides remote ref
 * PILLS — a display choice about a crowded row — and hiding a pill must not
 * remove an action from a menu; a user who narrowed the pills to "local" has
 * said nothing about which branches they may check out. Deriving from the store
 * rather than from History's filtered pill list makes that structural instead
 * of a promise: the filter is never in scope here.
 */
function branchesAtCommit(oid: string | null | undefined): BranchInfo[] {
  if (!oid) return [];
  const at = useRepoStore.getState().branches.filter((b) => !!b.tip && b.tip === oid);
  // Locals ahead of remotes, each group in the ONE branch ordering (#135).
  // This renders as an undivided list, so the grouping has to happen here.
  const ordered = orderBranchesGrouped(at);
  // A remote ref whose local counterpart is at this very commit adds nothing:
  // the local branch is already offered and checking it out lands on the same
  // tree, while the remote entry would only prompt for a name already taken.
  // Narrow on purpose — same commit AND same short name.
  const locals = new Set(ordered.filter((b) => !b.isRemote).map((b) => b.name));
  return ordered.filter(
    (b) => !b.isRemote || !locals.has(withoutRemotePrefix(b.name)),
  );
}

/**
 * "Check out the branch that is on this commit" for a commit's context menu
 * (#179).
 *
 * One branch → an inline entry; several → a submenu, so a commit carrying five
 * refs does not push the rest of the menu off screen. EMPTY when no branch is
 * here, which is what keeps `commitMenuItems` byte-identical to before for
 * every other commit — and why the payload needed no new field.
 */
function checkoutBranchItems(oid: string | null | undefined): ContextMenuItem[] {
  const entries: ContextMenuItem[] = branchesAtCommit(oid).map((b) =>
    b.isRemote
      ? {
          icon: "branch",
          label: `Check out "${b.name}" as a new local branch…`,
          // Never a bare checkout: `origin/foo` is not a local branch, so
          // checking the ref out would detach HEAD — the very thing the entry
          // above the detached one exists to avoid.
          onClick: () => checkoutRemoteAsLocalBranch(b.name),
        }
      : {
          icon: "check",
          // The current branch is LISTED rather than hidden — matching
          // branchMenuItems' `disabled: isCurrent` — so "you are already here"
          // reads off the menu instead of being an absence to interpret.
          label: b.isHead
            ? `Check out "${b.name}" — current branch`
            : `Check out "${b.name}"`,
          disabled: b.isHead,
          // checkoutBranch owns auto-stash → checkout → pop and its own
          // activity label. There is exactly one checkout path.
          onClick: () => useRepoStore.getState().checkoutBranch(b.name),
        },
  );
  if (entries.length <= 1) return entries;
  return [{ icon: "check", label: "Check out branch", submenu: entries }];
}

/**
 * The Bisect group for one commit's context menu (#93).
 *
 * Two different menus depending on state, because the same words mean different
 * things: with no bisect open, "this commit is bad" STARTS one; with one open it
 * marks a revision inside the search. Collapsed into a submenu so the bisect verbs
 * cannot be mistaken for the ordinary commit ops around them — and because a
 * misfired mark corrupts the search with no undo short of a reset.
 *
 * Deliberately no keyboard chords anywhere in this group: see the design doc.
 */
function bisectSubmenu(sha: string | null): ContextMenuItem[] {
  const bisect = useRepoStore.getState().bisectStatus;
  const short = sha ? sha.slice(0, 7) : "—";
  const items: ContextMenuItem[] = bisect.inProgress
    ? [
        {
          icon: "check",
          label: `Mark ${short} as ${bisect.goodTerm}`,
          onClick: () => {
            if (sha) void useRepoStore.getState().bisectMark("Good", sha);
          },
        },
        {
          icon: "warn",
          label: `Mark ${short} as ${bisect.badTerm}`,
          onClick: () => {
            if (sha) void useRepoStore.getState().bisectMark("Bad", sha);
          },
        },
        {
          icon: "chevronRight",
          label: `Skip ${short}`,
          onClick: () => {
            if (sha) void useRepoStore.getState().bisectMark("Skip", sha);
          },
        },
        { divider: true },
        {
          icon: "undo",
          label: "Reset bisect",
          onClick: () => void useRepoStore.getState().bisectReset(),
        },
      ]
    : [
        {
          icon: "warn",
          // Legal with no good revision yet: `git bisect start <bad>` waits for
          // one, which is exactly "it's broken now, I'll find a working one".
          label: `Start bisect — ${short} is bad`,
          onClick: () => {
            if (sha) void useRepoStore.getState().bisectStart(sha, []);
          },
        },
        {
          icon: "check",
          label: `Start bisect — ${short} is good, HEAD is bad`,
          onClick: () => {
            const head = useRepoStore.getState().branches.find((b) => b.isHead);
            const tip = head?.tip ?? useRepoStore.getState().commits[0]?.oid ?? null;
            if (sha && tip) void useRepoStore.getState().bisectStart(tip, [sha]);
          },
        },
      ];
  return [{ icon: "bisect", label: "Bisect", submenu: items }];
}

// ═════════════════════════════════════════════════════════
// SUBMODULES / WORKTREES (#93)
// ═════════════════════════════════════════════════════════

export function submoduleMenuItems(
  submodule: { path?: string; state?: string; url?: string | null } | null,
): ContextMenuItem[] {
  const path = submodule?.path ?? "";
  const uninitialized = submodule?.state === "Uninitialized";
  const store = () => useSubmodulesStore.getState();
  return [
    { __menuTitle: path || "submodule" },
    {
      icon: "download",
      label: "Initialize",
      disabled: !path || !uninitialized,
      onClick: () => void store().init(path),
    },
    {
      icon: "sync",
      label: "Update to recorded commit",
      disabled: !path,
      onClick: () => void store().update(path),
    },
    {
      icon: "link",
      label: "Sync URL from .gitmodules",
      disabled: !path,
      onClick: () => void store().sync(path),
    },
    { divider: true },
    {
      icon: "external",
      // An uninitialized submodule has no repository on disk to open.
      label: uninitialized
        ? "Open as repository — not initialized"
        : "Open as repository",
      disabled: !path || uninitialized,
      onClick: () => void store().openAsRepo(path),
    },
    {
      icon: "copy",
      label: "Copy URL",
      disabled: !submodule?.url,
      onClick: () => {
        if (!submodule?.url) return;
        navigator.clipboard?.writeText(submodule.url);
        pgFlash("copied submodule url");
      },
    },
  ];
}

/**
 * The "Copy path" / "Copy relative path" pair, for one path or a whole
 * selection (#245).
 *
 * One helper rather than four hand-written pairs because the two entries only
 * make sense together: before this, "Copy path" copied a *relative* path on
 * every file surface (the file row, the embedded-repo row, the multi-select and
 * the diff pane's ⋯ menu) and an absolute one on the worktree menu and the repo
 * tab, so the same label meant two different things depending on where you
 * right-clicked. Now the label is the contract — "Copy path" is always
 * absolute, "Copy relative path" always workdir-relative.
 *
 * `paths` are repository-relative (what git reports and every file list holds);
 * an absolute one is passed through unharmed. Empty strings are dropped, so a
 * row with no path yields two disabled entries instead of copying the workdir.
 * The absolute entry is disabled — not silently downgraded — when no repository
 * is open, since a path is either the real one or not worth pasting.
 *
 * Two surfaces deliberately do NOT call this: the worktree menu and the repo
 * tab menu, whose target IS a repository root. Its path relative to itself is
 * the empty string, so the pair would be one real entry and one that copies
 * nothing.
 */
export function copyPathItems(paths: string[]): ContextMenuItem[] {
  const workdir = useRepoStore.getState().current?.path ?? null;
  const targets = paths.filter((p) => !!p && !!p.trim());
  const plural = targets.length > 1;
  const keep = (v: string | null): v is string => !!v;
  const absolute = targets.map((p) => absoluteInWorkdir(workdir, p)).filter(keep);
  const relative = targets.map((p) => relativeToWorkdir(workdir, p)).filter(keep);

  const copy = (values: string[], what: string) => () => {
    if (!values.length) return;
    navigator.clipboard?.writeText(values.join("\n"));
    pgFlash(`copied ${what}`);
  };

  return [
    {
      icon: "copy",
      label: plural ? "Copy paths" : "Copy path",
      disabled: !absolute.length,
      onClick: copy(absolute, plural ? "paths" : "path"),
    },
    {
      icon: "copy",
      label: plural ? "Copy relative paths" : "Copy relative path",
      disabled: !relative.length,
      onClick: copy(relative, plural ? "relative paths" : "relative path"),
    },
  ];
}

export function worktreeMenuItems(
  worktree: {
    name?: string;
    path?: string;
    locked?: boolean;
    prunable?: boolean;
    isCurrent?: boolean;
  } | null,
): ContextMenuItem[] {
  const name = worktree?.name ?? "";
  const store = () => useWorktreesStore.getState();
  return [
    { __menuTitle: name || "worktree" },
    {
      icon: "folder",
      label: worktree?.isCurrent
        ? "Open as repository — already open"
        : worktree?.prunable
          ? "Open as repository — directory missing"
          : "Open as repository",
      disabled: !worktree?.path || !!worktree?.prunable || !!worktree?.isCurrent,
      onClick: () => {
        if (worktree?.path) void store().openAsRepo(worktree.path);
      },
    },
    {
      icon: "lock",
      label: worktree?.locked ? "Unlock" : "Lock…",
      disabled: !name,
      onClick: () => {
        const wt = store().items.find((w) => w.name === name);
        if (wt) void store().toggleLock(wt);
      },
    },
    {
      icon: "copy",
      label: "Copy path",
      disabled: !worktree?.path,
      onClick: () => {
        if (!worktree?.path) return;
        navigator.clipboard?.writeText(worktree.path);
        pgFlash("copied worktree path");
      },
    },
    { divider: true },
    {
      icon: "trash",
      label: "Remove…",
      danger: true,
      disabled: !name,
      // The store owns both gates (a confirm, then a type-the-name confirm if git
      // refuses on uncommitted work), so this menu and the row's button cannot
      // drift apart on the dangerous half.
      onClick: () => void store().remove(name),
    },
  ];
}


export function commitMultiMenuItems(oids: string[]): ContextMenuItem[] {
  const commits = useRepoStore.getState().commits;
  const plan = planCommitSelection(commits, oids);
  if (!plan) return [{ __menuTitle: "no commits" }];
  const n = plan.oids.length;

  // Combined diff and cherry-pick work on any commit in the log — which, with
  // the all-branches default, includes commits HEAD cannot reach. Squash
  // rewrites the current branch, so it is gated on HEAD's ancestry instead.
  const ancestry = ancestryLog();
  const squashPlan = planCommitSelection(ancestry, oids);

  // Squash needs a contiguous, merge-free run with a loaded parent to rebase
  // onto. Surface the blocking reason in the (disabled) label.
  const squashBlock =
    !squashPlan || squashPlan.oids.length !== n
      ? "not all on this branch"
      : !squashPlan.contiguous
        ? "non-contiguous"
        : squashPlan.hasMerge
          ? "contains a merge"
          : !squashPlan.baseOid
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
        if (squashBlock || !squashPlan?.baseOid) return;
        const msg = await pgPrompt({
          title: `Squash ${n} commits into one`,
          body: "Message for the combined commit — every squashed message, oldest first.",
          confirmLabel: "Squash",
          requireValue: true,
          initialValue: combinedSquashMessage(squashPlan.oids, byOid(ancestry)),
          multiline: 8,
        });
        if (!msg) return;
        const rebasePlan = buildRebasePlan(ancestry, squashPlan.baseOid, {
          kind: "squash-range",
          oids: squashPlan.oids,
          message: msg,
        });
        if (!rebasePlan) return;
        const outcome = await runRebasePlanNow(rebasePlan);
        if (outcome === "done") pgFlash(`squashed ${n} commits`);
        else if (outcome === "paused") pgFlash("squash paused — see the Conflicts screen");
      },
    },
    { divider: true },
    {
      icon: "bisect",
      // Two selected commits ARE a bisect range, so this is the fastest way in:
      // newest is where the bug is, oldest is where it wasn't.
      label:
        n === 2
          ? "Start bisect (newest bad, oldest good)"
          : `Start bisect — needs exactly 2 commits, ${n} selected`,
      disabled: n !== 2 || useRepoStore.getState().bisectStatus.inProgress,
      onClick: () => {
        if (n !== 2) return;
        void useRepoStore
          .getState()
          .bisectStart(plan.newestOid, [plan.oldestOid]);
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

/**
 * Compare entries for a ref's context menu (#131). Shared by the local and
 * remote branch menus so the two cannot drift.
 *
 * The mark pair stands in for a two-row selection on the Branches screen: that
 * screen holds a single `Selection`, not History's multi-select model, so
 * mirroring it would be a selection-model change to a screen this feature does
 * not otherwise touch — and marking works ACROSS the branch/tag lists, which a
 * row range never would.
 */
export function compareMenuItems(opts: {
  name?: string;
  /** The ref is the checked-out branch — "compare with current" is a no-op. */
  isCurrent?: boolean;
}): ContextMenuItem[] {
  const name = opts.name || "";
  // Scoped to the open repository: a mark taken in another one names a ref this
  // one may not have, and the entry would resolve to `InvalidRef` on click.
  const marked = markedRefFor(useRepoStore.getState().current?.id);
  const current = currentBranch(useRepoStore.getState().branches)?.name ?? "HEAD";

  const items: ContextMenuItem[] = [
    {
      icon: "diff",
      label: `Compare with ${current}`,
      disabled: !name || !!opts.isCurrent,
      onClick: () =>
        openCompare({ kind: "rev", rev: current }, { kind: "rev", rev: name }),
    },
    {
      icon: "diff",
      label: "Compare with working tree",
      disabled: !name,
      onClick: () => openCompare({ kind: "rev", rev: name }, WORKDIR),
    },
    {
      icon: "commit",
      label: marked === name ? "Marked for compare" : "Mark for compare",
      disabled: !name || marked === name,
      onClick: () => useCompareStore.getState().mark(name),
    },
  ];
  if (marked && marked !== name) {
    items.push({
      icon: "diff",
      label: `Compare with ${marked}`,
      disabled: !name,
      onClick: () =>
        openCompare({ kind: "rev", rev: marked }, { kind: "rev", rev: name }),
    });
  }
  return items;
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
    {
      icon: "rebase",
      // No confirm, unlike the non-interactive sibling above: this rewrites
      // nothing. It opens a plan, and `Start rebase` is the destructive step.
      label: "Rebase current onto this — interactive…",
      disabled: isCurrent,
      onClick: () => {
        if (!name) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: branchTipOid(name) ?? name,
          label: name,
        });
      },
    },
    { divider: true },
    ...compareMenuItems({ name, isCurrent }),
    { divider: true },
    {
      icon: "sync",
      label: "Pull",
      shortcut: chordFor("repo.pull"),
      disabled: !isCurrent || !upstream,
      onClick: () => useRepoStore.getState().pull(remote, name),
    },
    {
      icon: "pull",
      // Enabled for ANY tracking branch, current included — the row you are on
      // routes to a real pull inside the store, and every other row has its ref
      // moved without a checkout. Deliberately NOT gated on `behind`: that count
      // is only as fresh as the last fetch, and this op fetches, so gating would
      // hide the action exactly when it is most needed.
      label: "Fast-forward to upstream",
      disabled: !name || !upstream,
      onClick: async () => {
        if (!name) return;
        const out = await useRepoStore.getState().fastForwardBranch(name);
        // `null` means it routed to pull (which reports itself) or failed (the
        // banner already says why) — nothing to flash either way.
        if (out) pgFlash(describeFastForward(out));
      },
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

/** `origin/feat/x` → `feat/x`. The remote prefix is the FIRST segment only. */
function withoutRemotePrefix(name: string): string {
  const i = name.indexOf("/");
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * Check a remote-tracking ref out by creating a local branch that tracks it.
 *
 * ONE definition, shared by the remote-branch menu and the commit menu's remote
 * entry (#179): a bare `checkoutRef("origin/foo")` would silently DETACH, which
 * is the whole reason this flow exists, so a second copy is how one of the two
 * call sites would come to detach.
 */
async function checkoutRemoteAsLocalBranch(name: string) {
  if (!name) return;
  const localName = await pgPrompt({
    title: "Check out as new local branch",
    body: `Tracking ${name}.`,
    initialValue: withoutRemotePrefix(name),
    confirmLabel: "Check out",
    requireValue: true,
    mono: true,
  });
  if (!localName) return;
  await useRepoStore.getState().createBranch(localName, name);
  await useRepoStore.getState().checkoutBranch(localName);
}

export function remoteBranchMenuItems(branch: { name?: string } | null): ContextMenuItem[] {
  const name = branch?.name || "";
  // name is like "origin/feature" — parse out the remote prefix
  const slashIdx = name.indexOf("/");
  const remoteName = slashIdx >= 0 ? name.slice(0, slashIdx) : name;
  const shortName = withoutRemotePrefix(name);
  return [
    { __menuTitle: name || "remote branch" },
    {
      icon: "branch",
      label: "Check out as new local branch…",
      onClick: () => checkoutRemoteAsLocalBranch(name),
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
    {
      icon: "rebase",
      // Never disabled — a remote-tracking branch is never the current branch.
      label: "Rebase current onto this — interactive…",
      onClick: () => {
        if (!name) return;
        useNavStore.getState().setIntent({
          kind: "rebase-onto",
          base: branchTipOid(name) ?? name,
          label: name,
        });
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
    { divider: true },
    // Replaces the old oid-pair "Compare with current", which resolved both
    // tips itself and silently did nothing when either was missing. The compare
    // screen takes the REF names, so it also survives a fetch moving the tip.
    ...compareMenuItems({ name }),
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
    ...copyPathItems([path]),
  ];
}

export function fileMenuItems(
  file: {
    path?: string;
    staged?: boolean;
    embedded?: boolean;
    untracked?: boolean;
    conflicted?: boolean;
    submodule?: boolean;
  } | null,
  platform?: Platform,
): ContextMenuItem[] {
  const staged = !!file?.staged;
  const untracked = !!file?.untracked;
  const path = file?.path || "";
  // With the Conflicts screen gone (#108), the row in Files/Commit is where a
  // conflicted file is listed in the main window — so it is where resolving it
  // has to be reachable. Staging a file still carrying markers is not the
  // menu the user wants here, so this replaces it rather than extending it.
  if (file?.conflicted) return conflictMenuItems({ path });
  if (file?.embedded) return embeddedRepoMenuItems(path);
  // A registered submodule (#93). Not a file: it has no diff, no blame and no
  // history, so the ordinary file menu is a list of dead ends. Its own menu can
  // init/update/sync it and open it as a repository. Looked up in the submodule
  // store so state-dependent entries (Initialize) are gated correctly; a path we
  // have not listed yet still gets the menu, with the state-specific rows
  // disabled.
  if (file?.submodule) {
    const key = path.replace(/\/+$/, "");
    const known = useSubmodulesStore
      .getState()
      .items.find((s) => s.path === key);
    return submoduleMenuItems(known ?? { path: key });
  }
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
    // Partial stash of one file (#133). Here as well as in the multi-selection
    // menu because one row IS the common selection — reaching it only by
    // selecting two files first would be a shortcut nobody finds.
    {
      icon: "stash",
      label: "Stash this file…",
      onClick: () => {
        if (!path) return;
        return promptStashPaths([path], {
          untrackedPaths: untracked ? [path] : [],
          stagedPaths: staged ? [path] : [],
        });
      },
    },
    { divider: true },
    ...copyPathItems([path]),
    // This IS "open containing folder", on all three platforms: `open -R` and
    // `explorer /select,` open the parent window with the file selected, and
    // Linux xdg-opens the parent (there is no portable "select this file"
    // verb). A separate "Open containing folder" entry would be a synonym — the
    // only variant that differs is a folder window with NO selection, which
    // needs `reveal(parent, is_dir: true)` and so a backend change. See
    // docs/dev/frontend.md.
    {
      icon: "folder",
      label: fileManagerLabel(platform),
      onClick: () => {
        if (path) useRepoStore.getState().revealInFileManager(path);
      },
    },
    {
      icon: "terminal",
      label: "Open in terminal",
      onClick: () => {
        if (path) useRepoStore.getState().openInTerminal(path);
      },
    },
    { divider: true },
    // An untracked file has no copy in the index or in history, so deleting it
    // is for good — say so, and never do it on a single click the way a
    // recoverable "restore from index" can be.
    //
    // Wired to `deleteUntracked`, not `discard` (#245): discard would RESTORE
    // this path the moment it became tracked between the right-click and the
    // confirm, and an entry labelled "Delete file…" that reverted a file
    // instead is the worst surprise available on a destructive action. The
    // backend refuses a tracked path outright.
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
              useRepoStore.getState().deleteUntracked([path]);
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
   * from the recoverable "restore from index" case. Also the set "Delete N
   * files…" acts on (#245).
   */
  untrackedPaths?: string[];
  /**
   * The DIRECTORY this menu was opened on, when it was opened on exactly one
   * (#245).
   *
   * Both trees hand a folder key straight to `splitFileSelection`, which
   * expands it to the files beneath — so this menu is also the folder row's
   * menu, and until this field existed it had no idea which folder that was.
   * Set only for a single folder row: entries that address one location (reveal,
   * terminal) are meaningless for a multi-row selection, where the honest answer
   * would be five windows.
   */
  directoryPath?: string;
}

/**
 * Context menu for a multi-file selection. Stage/Unstage each act on their
 * own subset so mixed selections work; discard goes through the standard
 * confirm/danger flow before touching the worktree.
 */
/**
 * Stash a selection of paths (#133).
 *
 * `untrackedPaths` is not a preference the user is asked about: `git stash push
 * -- <untracked path>` FAILS outright without `--include-untracked`, so the
 * flag is derived from whether the selection contains one. Both lists come from
 * the same `splitFileSelection` buckets Stage / Unstage / Discard already read.
 *
 * No confirm: the changes go INTO a stash, so nothing is lost — but staged
 * paths in the selection are unstaged as part of the move, and they come back
 * unstaged on pop. The prompt body says both, rather than leaving either to be
 * discovered.
 */
export async function promptStashPaths(
  paths: string[],
  opts: { untrackedPaths?: string[]; stagedPaths?: string[] } = {},
): Promise<void> {
  if (!paths.length) return;
  const n = paths.length;
  const inSelection = (p: string) => paths.includes(p);
  const untracked = (opts.untrackedPaths ?? []).filter(inSelection);
  const staged = (opts.stagedPaths ?? []).filter(inSelection);
  // Both clauses describe a real consequence the user cannot see coming.
  // Staged ones especially: `git stash push -- <path>` takes the index side
  // too, so a file that was staged comes back UNSTAGED on pop. Saying it here
  // is the difference between a surprise and a choice.
  const notes = [
    untracked.length
      ? `${untracked.length} untracked file${
          untracked.length === 1 ? " is" : "s are"
        } included.`
      : null,
    staged.length
      ? `${staged.length} staged file${
          staged.length === 1 ? "" : "s"
        } will be unstaged, and come back unstaged when you pop.`
      : null,
  ].filter(Boolean);
  const message = await pgPrompt({
    title: `Stash ${n} file${n === 1 ? "" : "s"}`,
    body: [
      "The selected paths are reverted to HEAD and kept in a new stash entry.",
      ...notes,
    ].join(" "),
    placeholder: "message (optional)",
    confirmLabel: "Stash",
  });
  // `null` is dismissal; `""` is a deliberate empty message, and git is happy
  // to write an entry without one — the same distinction pgPrompt inherits
  // from window.prompt.
  if (message == null) return;
  const oid = await useRepoStore.getState().stashSavePaths(
    {
      message: message === "" ? null : message,
      includeUntracked: untracked.length > 0,
      keepIndex: false,
    },
    paths,
  );
  // `null` covers two outcomes: git found nothing to save (it exits 0 saying
  // so) and the op failed. The second already has the error banner, so only the
  // first needs a word — otherwise a click on "Stash 3 files" does nothing
  // visible at all.
  if (oid === null && !useRepoStore.getState().error) {
    pgFlash("nothing to stash in those files");
  }
}

export function multiFileMenuItems(
  sel: MultiFileMenuSelection | null,
  platform?: Platform,
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
  // Partial stash (#133).
  //
  // The set is the CHANGED paths, not every selected one: the repo browser's
  // all-files view puts unmodified files in `paths` too, and a stash of only
  // those is a click that does nothing (git exits 0 with "No local changes to
  // save"). Embedded repos are excluded for the same reason they cannot be
  // staged.
  const stashable = Array.from(new Set([...stagedPaths, ...unstagedPaths])).filter(
    (p) => !embeddedPaths.includes(p),
  );
  if (stashable.length) {
    items.push({
      icon: "stash",
      label: `Stash ${files(stashable.length)}…`,
      onClick: () =>
        promptStashPaths(stashable, {
          untrackedPaths: sel?.untrackedPaths ?? [],
          stagedPaths,
        }),
    });
  }
  items.push({ divider: true }, ...copyPathItems(all));
  // The folder row's file-manager entries (#245). `reveal_in_file_manager` reads
  // is-it-a-directory off the filesystem, so this opens a WINDOW on the folder
  // rather than selecting it in its parent — and "Open containing folder" is
  // what the file row's own entry has always been, on every platform, so there
  // is deliberately no such synonym here either.
  const directoryPath = sel?.directoryPath;
  if (directoryPath) {
    items.push(
      { divider: true },
      {
        icon: "folder",
        label: fileManagerLabel(platform),
        onClick: () => {
          useRepoStore.getState().revealInFileManager(directoryPath);
        },
      },
      {
        icon: "terminal",
        label: "Open in terminal",
        onClick: () => {
          useRepoStore.getState().openInTerminal(directoryPath);
        },
      },
    );
  }

  // The untracked half of the selection, which is what Delete acts on. Filtered
  // against the selection for the same reason `promptStashPaths` filters: the
  // caller's bucket can be wider than what is actually selected.
  const untracked = (sel?.untrackedPaths ?? []).filter((p) =>
    unstagedPaths.includes(p),
  );
  // Discard RESTORES from the index; where every unstaged path is untracked
  // there is nothing to restore and the op is a delete, so the Discard entry
  // steps aside for the Delete one — exactly the swap `fileMenuItems` makes on a
  // single untracked row (#67). A MIXED selection keeps both, because they
  // genuinely differ there: Discard restores the tracked ones and deletes the
  // untracked ones, Delete touches only the untracked ones.
  const restorable = unstagedPaths.filter((p) => !untracked.includes(p));
  if (restorable.length || untracked.length) items.push({ divider: true });
  if (restorable.length) {
    items.push({
      icon: "undo",
      label: `Discard changes in ${files(unstagedPaths.length)}…`,
      danger: true,
      onClick: async () => {
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
    });
  }
  if (untracked.length) {
    const n = untracked.length;
    items.push({
      icon: "trash",
      label: `Delete ${files(n)}…`,
      danger: true,
      onClick: async () => {
        if (
          await pgConfirm({
            title: `Delete ${files(n)}?`,
            // The #67 wording, in the plural: an untracked file has no copy
            // anywhere git can reach, and that is the whole reason this confirm
            // exists.
            body:
              n === 1
                ? "It is untracked — there is no copy in the index or in history, so this cannot be undone."
                : "They are untracked — there is no copy in the index or in history, so this cannot be undone.",
            danger: true,
            confirmLabel: n === 1 ? "Delete file" : "Delete files",
          })
        ) {
          useRepoStore.getState().deleteUntracked(untracked);
        }
      },
    });
  }
  return items;
}

/**
 * One stash entry, as the menu and the Branches detail pane both address it
 * (#133). `oid` is the FULL commit oid — the comparisons take it, never the
 * index, because an index is a reflog position that any write to `refs/stash`
 * shifts (a rename included) and a stale one would compare a different entry.
 */
export interface StashMenuTarget {
  name?: string;
  index?: number;
  oid?: string;
  message?: string;
  untracked?: boolean;
}

/** Ask to see what a stash changed — its own first parent against itself. */
export function openStashDiff(stash: StashMenuTarget): void {
  if (!stash.oid) return;
  useNavStore.getState().setIntent({
    kind: "stash-diff",
    oid: stash.oid,
    label: stash.name ?? `stash@{${stash.index ?? 0}}`,
    untracked: !!stash.untracked,
  });
}

/** Ask how a stash stands against what is on disk right now. */
export function openStashVsWorktree(stash: StashMenuTarget): void {
  if (!stash.oid) return;
  useNavStore.getState().setIntent({
    kind: "stash-vs-wt",
    oid: stash.oid,
    label: stash.name ?? `stash@{${stash.index ?? 0}}`,
    untracked: !!stash.untracked,
  });
}

/**
 * Rename a stash entry. Prompts with the current message so the user edits
 * rather than retypes — the whole displayed string is the name, `On main: `
 * prefix included.
 */
export async function promptStashRename(stash: StashMenuTarget): Promise<void> {
  // Both, not either: the index addresses the reflog entry and the oid proves
  // it is still the one that was picked (#133).
  if (stash.index == null || !stash.oid) return;
  const name = stash.name ?? `stash@{${stash.index}}`;
  const message = await pgPrompt({
    title: `Rename ${name}`,
    // Said up front, because it is visible and would otherwise look like a bug:
    // `refs/stash` is a reflog and git can only PREPEND to it, so a renamed
    // entry necessarily ends up first.
    body: "The renamed stash moves to the top of the list — git's stash reflog has no insert-in-place.",
    initialValue: stash.message ?? "",
    confirmLabel: "Rename",
    requireValue: true,
  });
  if (message == null) return;
  await useRepoStore.getState().stashRename(stash.index, stash.oid, message);
}

export function stashMenuItems(stash: StashMenuTarget | null): ContextMenuItem[] {
  const name = stash?.name ?? `stash@{${stash?.index ?? 0}}`;
  const target: StashMenuTarget = { ...stash, name };
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
    { divider: true },
    {
      icon: "diff",
      label: "Show what it changed",
      disabled: !stash?.oid,
      onClick: () => openStashDiff(target),
    },
    {
      icon: "diff",
      label: "Compare with working tree",
      disabled: !stash?.oid,
      onClick: () => openStashVsWorktree(target),
    },
    { divider: true },
    {
      icon: "edit",
      label: "Rename…",
      disabled: stash?.index == null || !stash?.oid,
      onClick: () => promptStashRename(target),
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
      // Both are required, and the entry is disabled without them rather than
      // asserted past: dropping by a bare index deletes whatever has moved into
      // that reflog slot, which is the one unrecoverable mistake here (#133).
      disabled: stash?.index == null || !stash?.oid,
      onClick: async () => {
        const { index, oid } = stash ?? {};
        if (index == null || !oid) return;
        if (
          await pgConfirm({
            title: `Drop ${name}?`,
            body: "The stashed changes are discarded.",
            danger: true,
            confirmLabel: "Drop",
          })
        )
          useRepoStore.getState().stashDrop(index, oid);
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
