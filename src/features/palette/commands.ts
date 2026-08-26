// src/features/palette/commands.ts
import { pgConfirm } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useCreateStore } from "@/features/create/useCreateStore";
import { useLfsStore } from "@/features/lfs/useLfsStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useForgeStore } from "@/features/forge/useForgeStore";
import { prNoun, prNumberLabel } from "@/features/forge/forgeLabels";
import { useSubmodulesStore } from "@/features/submodules/useSubmodulesStore";
import { useWorktreesStore } from "@/features/worktrees/useWorktreesStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { openCompare } from "@/features/compare/useCompareStore";
import { WORKDIR } from "@/features/compare/compareSides";
import { orderBranchesGrouped } from "@/features/branches/orderBranches";
import { openCreateTag } from "@/features/tags/useCreateTagStore";
import { usePaletteStore } from "./usePaletteStore";
import { createBranchInputStep, switchRepoStep } from "./steps";
import { currentBranch, isConflicted, relativeTime } from "@/lib/derive";
import { headUpstream, resolveConflictsOp } from "@/features/repo/ops";
import type { ActionId } from "@/features/keymap";
import type { CancellableOp } from "@/features/repo/useRepoStore";
import type { BranchInfo, CommitInfo, FileStatus } from "@/lib/types";
import type { PaletteItem, PaletteStep } from "./types";

const palette = () => usePaletteStore.getState();
const repoState = () => useRepoStore.getState();

/** Close the palette, then run the op. */
function direct(fn: () => void): () => void {
  return () => {
    palette().closePalette();
    fn();
  };
}

/** Push an inline step (palette stays open). */
function step(make: () => PaletteStep): () => void {
  return () => palette().pushStep(make());
}

// ---- row builders (read live store data) ----------------------------------
//
// One builder per row kind, shared by the palette's ROOT step (CommandPalette's
// candidate set) and by the pick steps below. The only things that vary are the
// id namespace, the icon, and what the row does — so those are the options.
//
// The id namespace matters: `PaletteItem.id` is the frecency key, and a root
// row (`branch:…`) and a pick-step row for the same branch (`pick-branch:…`)
// are different rows the user can invoke, so they must not share a key. The
// default is the pick-step namespace; the root step passes its own.

interface RowOptions {
  /**
   * Id namespace — the row id is `<idPrefix>:<per-kind suffix>`. Defaults to
   * the pick-step namespace.
   */
  idPrefix?: string;
  icon: string;
}

export interface BranchItemsOptions extends RowOptions {
  /** Rows to build from. Defaults to the live branch list. */
  branches?: BranchInfo[];
  /** Keep only matching branches. Defaults to keeping all of them. */
  filter?: (b: BranchInfo) => boolean;
  onPick: (name: string) => void;
}

export function branchItems({
  branches,
  filter,
  idPrefix = "pick-branch",
  icon,
  onPick,
}: BranchItemsOptions): PaletteItem[] {
  const rows = branches ?? repoState().branches;
  // Filter first, order second (#135), locals ahead of remotes — the sections
  // the picker and Branches screen render structurally, flattened for a step
  // that lists one undivided set.
  //
  // This is the order a PICK STEP shows. It is NOT what the root step shows:
  // `CommandPalette` adds `frecencyScore` to every row regardless of query, so
  // as soon as the user has picked any branch from the palette that branch
  // outranks the pinned default there. The pin is honoured in the picker, the
  // Branches screen and the pick steps; the root step is a relevance ranking
  // and deliberately stays one.
  return orderBranchesGrouped(filter ? rows.filter(filter) : rows).map((b) => ({
    type: "branch" as const,
    id: `${idPrefix}:${b.isRemote ? "r" : "l"}:${b.name}`,
    search: b.name,
    label: b.name,
    detail: b.isRemote ? "remote" : (b.upstream ?? undefined),
    icon,
    run: () => {
      palette().closePalette();
      onPick(b.name);
    },
  }));
}

/**
 * A pick step over BRANCH rows — the one way the catalog builds one.
 *
 * It exists so the resting-cursor rule cannot be forgotten at a new call site:
 * #135 pins the default branch at row 0 of every branch list, and the palette
 * resets `activeIndex` to 0 on every `pushStep`, so a step that preselected row
 * 0 put `main` one Enter after the Enter that opened it — which for the Delete
 * step reached an unconfirmed, irreversible `deleteBranch("main")`.
 *
 * `branchItems` stays exported for the ROOT step, which builds candidates
 * rather than a step and has its own cursor rules.
 */
export function branchPickStep({
  title,
  ...rows
}: BranchItemsOptions & { title: string }): PaletteStep {
  return { kind: "pick", title, cursor: "none", items: branchItems(rows) };
}

export interface CommitItemsOptions extends RowOptions {
  /** Rows to build from. Defaults to the live log. */
  commits?: CommitInfo[];
  onPick: (oid: string) => void;
}

export function commitItems({
  commits,
  idPrefix = "pick-commit",
  icon,
  onPick,
}: CommitItemsOptions): PaletteItem[] {
  return (commits ?? repoState().commits).map((c) => ({
    type: "commit" as const,
    id: `${idPrefix}:${c.oid}`,
    search: `${c.summary} ${c.shortOid} ${c.author}`,
    label: c.summary,
    detail: `${c.shortOid} · ${relativeTime(c.timestamp)}`,
    icon,
    run: () => {
      palette().closePalette();
      onPick(c.oid);
    },
  }));
}

export interface FileItemsOptions extends RowOptions {
  /** Rows to build from. Defaults to the live tracked-file list. */
  files?: FileStatus[];
  onPick: (path: string) => void;
}

/**
 * Label is the basename, detail the directory. A file at the repo root has no
 * directory, so its detail stays undefined rather than rendering an empty span.
 */
export function fileItems({
  files,
  idPrefix = "pick-file",
  icon,
  onPick,
}: FileItemsOptions): PaletteItem[] {
  return (files ?? repoState().allFiles).map((f) => {
    const slash = f.path.lastIndexOf("/");
    return {
      type: "file" as const,
      id: `${idPrefix}:${f.path}`,
      search: f.path,
      label: slash >= 0 ? f.path.slice(slash + 1) : f.path,
      detail: slash >= 0 ? f.path.slice(0, slash) : undefined,
      icon,
      run: () => {
        palette().closePalette();
        onPick(f.path);
      },
    };
  });
}

// The remaining builders are pick-step-only (the root step has no tag / stash /
// remote row kind), so they stay on the plain positional signature.

function tagItems(icon: string, onPick: (name: string) => void): PaletteItem[] {
  return repoState().tags.map((t) => ({
    type: "command" as const,
    id: `pick-tag:${t.name}`,
    search: t.name,
    label: t.name,
    detail: t.shortOid,
    icon,
    run: () => {
      palette().closePalette();
      onPick(t.name);
    },
  }));
}

/**
 * `onPick` receives the entry's OID as well as its index (#133). A stash index
 * is a position in the `refs/stash` reflog, so the destructive picks have to
 * name the commit they meant — the backend refuses a mismatch rather than
 * acting on whatever moved into the slot.
 */
function stashItems(
  icon: string,
  onPick: (index: number, oid: string) => void,
): PaletteItem[] {
  return repoState().stashes.map((s) => ({
    type: "command" as const,
    id: `pick-stash:${s.index}`,
    search: `${s.message} ${s.shortOid}`,
    label: s.message || `stash@{${s.index}}`,
    detail: s.shortOid,
    icon,
    run: () => {
      palette().closePalette();
      onPick(s.index, s.oid);
    },
  }));
}

function remoteItems(
  icon: string,
  onPick: (name: string) => void,
): PaletteItem[] {
  return repoState().remotes.map((r) => ({
    type: "command" as const,
    id: `pick-remote:${r.name}`,
    search: r.name,
    label: r.name,
    detail: r.url ?? undefined,
    icon,
    run: () => {
      palette().closePalette();
      onPick(r.name);
    },
  }));
}

// ---- the catalog ----------------------------------------------------------

// Screen id → [label, icon, keymap action]. Shortcut chips come from the
// live keymap via actionId — never hardcode chord strings here.
const SCREENS: [string, string, string, ActionId][] = [
  ["repo", "Files", "folder", "nav.files"],
  ["commit", "Commit", "commit", "nav.commit"],
  ["history", "History", "history", "nav.history"],
  ["branches", "Branches", "branch", "nav.branches"],
  ["rebase", "Rebase", "rebase", "nav.rebase"],
  ["remote", "Remotes", "link", "nav.remote"],
  ["pulls", "Pull requests", "pullRequest", "nav.pulls"],
  ["diff", "Diff viewer", "fileCode", "nav.diff"],
  ["reflog", "Reflog", "clock", "nav.reflog"],
  ["submodules", "Submodules", "submodule", "nav.submodules"],
  ["worktrees", "Worktrees", "worktree", "nav.worktrees"],
  ["settings", "Settings", "settings", "nav.settings"],
];

export function buildCommands(): PaletteItem[] {
  const repo = repoState();
  const nav = useNavStore.getState();
  const head = currentBranch(repo.branches);
  const headName = head?.name ?? null;
  const headTip = head?.tip ?? repo.commits[0]?.oid ?? null;
  // [remote, tracking-branch] parsed from HEAD's upstream ref, or null. Use the
  // tracking branch (not the local name) and honour defaultPullMode so palette
  // push/pull match the keymap runners (ops.ts) they advertise a chord for.
  const upstream = headUpstream(head?.upstream, headName ?? undefined);
  const items: PaletteItem[] = [];

  // -- navigation (launch existing screens) --
  for (const [id, label, icon, actionId] of SCREENS) {
    items.push({
      type: "command",
      id: `screen:${id}`,
      search: `${label} ${id} go to`,
      label: `Go to ${label}`,
      icon,
      actionId,
      run: direct(() => nav.setIntent({ kind: "switch-screen", screen: id })),
    });
  }

  // -- direct actions --
  items.push(
    {
      type: "command", id: "action:fetch-all", search: "Fetch all remotes",
      label: "Fetch all remotes", icon: "fetch", actionId: "repo.fetch",
      run: direct(() => void repo.fetchAll()),
    },
    {
      type: "command", id: "action:refresh", search: "Refresh repository",
      label: "Refresh repository", icon: "sync", actionId: "repo.refresh",
      run: direct(() => void repo.refreshAll()),
    },
    {
      type: "command", id: "action:clone", search: "Clone repository git url",
      label: "Clone repository…", icon: "download", actionId: "repo.clone",
      run: direct(() => useCreateStore.getState().openClone()),
    },
    {
      type: "command", id: "action:init", search: "New repository init create",
      label: "New repository…", icon: "plus", actionId: "repo.init",
      run: direct(() => useCreateStore.getState().openInit()),
    },
  );

  // -- repository tabs (#90) --
  // Always listed: with one repository open it is still how you reach a recent
  // one without the native folder dialog (the only keyboard route to it).
  items.push({
    type: "command", id: "action:switch-repo",
    search: "Switch repository tab open recent",
    label: "Switch repository…", icon: "repo", actionId: "tab.switch",
    run: step(() => switchRepoStep()),
  });
  const tabs = useTabsStore.getState();
  if (tabs.activePath) {
    items.push({
      type: "command", id: "action:close-repo-tab",
      search: "Close repository tab", label: "Close repository tab",
      icon: "x", actionId: "tab.close",
      run: direct(() => {
        const path = useTabsStore.getState().activePath;
        if (path) void useTabsStore.getState().close(path);
      }),
    });
  }
  if (tabs.tabs.length > 1) {
    const keep = tabs.activePath;
    items.push({
      type: "command", id: "action:close-other-repo-tabs",
      search: "Close other repository tabs",
      label: "Close other repository tabs", danger: true, icon: "trash",
      run: direct(() => {
        void (async () => {
          if (
            keep &&
            (await pgConfirm({
              title: `Close ${tabs.tabs.length - 1} other repositor${
                tabs.tabs.length - 1 === 1 ? "y" : "ies"
              }?`,
              body: "Only closes the tabs — nothing on disk changes.",
              confirmLabel: "Close others",
            }))
          ) {
            await useTabsStore.getState().closeOthers(keep);
          }
        })();
      }),
    });
  }

  // -- smart push / pull / force-push (need a current branch) --
  if (headName) {
    const name = headName;
    items.push({
      type: "command", id: "action:push-current",
      search: "Push current branch", label: `Push ${name}`,
      detail: head?.upstream ?? "set upstream", icon: "push",
      actionId: "repo.push",
      run: upstream
        ? direct(() => void repo.push(upstream[0], upstream[1], "None"))
        : step(() => ({
            kind: "pick", title: `Push ${name} to…`,
            items: remoteItems("push", (r) => void repo.push(r, name, "None")),
          })),
    });
    items.push({
      type: "command", id: "action:pull-current",
      search: "Pull current branch", label: `Pull ${name}`,
      detail: head?.upstream ?? undefined, icon: "pull",
      actionId: "repo.pull",
      run: upstream
        ? direct(() =>
            void repo.pull(
              upstream[0],
              upstream[1],
              useSettingsStore.getState().defaultPullMode,
            ),
          )
        : step(() => ({
            kind: "pick", title: `Pull ${name} from…`,
            items: remoteItems("pull", (r) =>
              void repo.pull(r, name, useSettingsStore.getState().defaultPullMode),
            ),
          })),
    });
    const guardedForcePush = (remote: string, branch: string) => {
      void (async () => {
        if (
          useSettingsStore.getState().confirmForcePush &&
          !(await pgConfirm({
            title: `Force-push ${branch} to ${remote}?`,
            body: "Overwrites the remote branch. --force-with-lease still refuses if someone else pushed since your last fetch.",
            danger: true,
            confirmLabel: "Force-push",
          }))
        ) {
          return;
        }
        void repo.push(remote, branch, "WithLease");
      })();
    };
    items.push({
      type: "command", id: "action:force-push-current",
      search: "Force push current branch with lease",
      label: `Force-push ${name} (with lease)`, danger: true,
      detail: head?.upstream ?? undefined, icon: "push",
      run: upstream
        ? direct(() => guardedForcePush(upstream[0], upstream[1]))
        : step(() => ({
            kind: "pick", title: `Force-push ${name} to…`,
            items: remoteItems("push", (r) => guardedForcePush(r, name)),
          })),
    });
    // Push skipping `pre-push` (#232). A SEPARATE command rather than a toggle,
    // for the same reason force-push is one: there is no push dialog to hang a
    // checkbox on, and the escape hatch has to be per-invocation and visible so
    // nobody skips a team's gate without meaning to. Confirmed, and marked
    // danger, because the hook it skips is usually the test suite.
    const guardedNoVerifyPush = (remote: string, branch: string) => {
      void (async () => {
        if (
          !(await pgConfirm({
            title: `Push ${branch} to ${remote} without hooks?`,
            body: "Skips this repository's pre-push hook — whatever it checks (tests, lint, protected branches) will not run for this push.",
            danger: true,
            confirmLabel: "Push without hooks",
          }))
        ) {
          return;
        }
        void repo.push(remote, branch, "None", true);
      })();
    };
    items.push({
      type: "command", id: "action:push-current-no-verify",
      search: "Push current branch without hooks no-verify skip pre-push",
      label: `Push ${name} without hooks`, danger: true,
      detail: head?.upstream ?? undefined, icon: "push",
      run: upstream
        ? direct(() => guardedNoVerifyPush(upstream[0], upstream[1]))
        : step(() => ({
            kind: "pick", title: `Push ${name} without hooks to…`,
            items: remoteItems("push", (r) => guardedNoVerifyPush(r, name)),
          })),
    });
  }

  // -- branch ops --
  items.push({
    type: "command", id: "action:checkout-branch",
    search: "Checkout branch switch", label: "Checkout branch…", icon: "branch",
    run: step(() =>
      branchPickStep({
        title: "Checkout branch",
        filter: (b) => !b.isHead,
        icon: "branch",
        onPick: (n) => void repo.checkoutBranch(n),
      }),
    ),
  });
  items.push({
    type: "command", id: "action:create-branch",
    search: "Create new branch", label: "Create branch…", icon: "plus",
    actionId: "branch.createNew",
    run: step(() => createBranchInputStep()),
  });
  items.push({
    type: "command", id: "action:merge",
    search: "Merge branch into current", label: "Merge branch into current…", icon: "merge",
    run: step(() =>
      branchPickStep({
        title: "Merge into current",
        filter: (b) => !b.isHead,
        icon: "merge",
        onPick: (n) => void repo.mergeBranch(n),
      }),
    ),
  });
  items.push({
    type: "command", id: "action:rebase-onto",
    search: "Rebase current onto branch", label: "Rebase current onto…", icon: "rebase",
    run: step(() =>
      branchPickStep({
        title: "Rebase onto",
        filter: (b) => !b.isHead,
        icon: "rebase",
        onPick: (n) => void repo.rebaseOnto(n),
      }),
    ),
  });
  // -- compare (#131) --
  //
  // No keyboard chord on purpose: the ⌘1–9 row is full, every catalog action
  // must be bound in BOTH presets, and compare is a considered action rather
  // than a hot path.
  items.push({
    type: "command", id: "action:compare-refs",
    search: "Compare branch diff against current branch",
    label: "Compare with current branch…", icon: "diff",
    run: step(() =>
      branchPickStep({
        title: "Compare with current",
        idPrefix: "pick-compare",
        filter: (b) => !b.isHead,
        icon: "diff",
        // Current on the LEFT, so the picked ref's own work reads as additions.
        onPick: (n) =>
          openCompare(
            { kind: "rev", rev: currentBranch(repoState().branches)?.name ?? "HEAD" },
            { kind: "rev", rev: n },
          ),
      }),
    ),
  });
  items.push({
    type: "command", id: "action:compare-workdir",
    search: "Compare branch against working tree uncommitted",
    label: "Compare with working tree…", icon: "diff",
    run: step(() =>
      branchPickStep({
        title: "Compare against the working tree",
        idPrefix: "pick-compare-wt",
        icon: "diff",
        onPick: (n) => openCompare({ kind: "rev", rev: n }, WORKDIR),
      }),
    ),
  });
  items.push({
    type: "command", id: "action:delete-branch",
    search: "Delete branch", label: "Delete branch…", danger: true, icon: "trash",
    run: step(() =>
      branchPickStep({
        title: "Delete branch",
        filter: (b) => !b.isHead && !b.isRemote,
        icon: "trash",
        // The only delete path that did not confirm — the row menu and the
        // Branches screen inspector both already do. Deleting a branch is
        // irreversible short of the reflog, and `delete_branch` refuses only
        // UNMERGED branches, so the default branch (an ancestor of HEAD) goes
        // without a murmur.
        onPick: async (n) => {
          if (
            await pgConfirm({
              title: `Delete branch ${n}?`,
              danger: true,
              confirmLabel: "Delete",
            })
          )
            void repo.deleteBranch(n);
        },
      }),
    ),
  });
  items.push({
    type: "command", id: "action:rename-branch",
    search: "Rename branch", label: "Rename branch…", icon: "branch",
    run: step(() =>
      branchPickStep({
        title: "Rename branch",
        filter: (b) => !b.isRemote,
        icon: "branch",
        onPick: (oldName) =>
          palette().pushStep({
            kind: "input", title: `Rename ${oldName}`, placeholder: "new-name",
            initial: oldName,
            validate: (v) => (v.trim() ? null : "Name required"),
            onSubmit: (v) => {
              palette().closePalette();
              void repo.renameBranch(oldName, v.trim());
            },
          }),
      }),
    ),
  });

  items.push({
    type: "command", id: "action:checkout-ref",
    search: "Checkout tag ref detached", label: "Checkout tag/ref…", icon: "tag",
    run: step(() => ({
      kind: "pick", title: "Checkout tag/ref",
      items: [
        ...tagItems("tag", (name) => { palette().closePalette(); void repo.checkoutRef(name); }),
        ...repo.branches.filter((b) => b.isRemote).map((b) => ({
          type: "command" as const,
          id: `pick-ref:${b.name}`,
          search: b.name,
          label: b.name,
          icon: "branch",
          run: () => { palette().closePalette(); void repo.checkoutRef(b.name); },
        })),
      ],
    })),
  });

  // -- commit ops --
  items.push({
    type: "command", id: "action:cherry-pick",
    search: "Cherry-pick commit", label: "Cherry-pick commit…", icon: "commit",
    run: step(() => ({
      kind: "pick", title: "Cherry-pick",
      items: commitItems({ icon: "commit", onPick: (oid) => void repo.cherryPick(oid) }),
    })),
  });
  items.push({
    type: "command", id: "action:revert",
    search: "Revert commit", label: "Revert commit…", icon: "history",
    run: step(() => ({
      kind: "pick", title: "Revert",
      items: commitItems({ icon: "history", onPick: (oid) => void repo.revert(oid) }),
    })),
  });
  items.push({
    type: "command", id: "action:reset",
    search: "Reset current branch to commit", label: "Reset current branch to…",
    icon: "rebase",
    run: step(() => ({
      kind: "pick", title: "Reset to commit",
      items: commitItems({
        icon: "commit",
        onPick: (oid) =>
          palette().pushStep({
            kind: "pick", title: "Reset mode",
            items: (["Soft", "Mixed", "Hard"] as const).map((mode) => ({
              type: "command" as const, id: `reset-mode:${mode}`,
              search: mode, label: mode, danger: mode === "Hard",
              icon: "rebase",
              run: () => { palette().closePalette(); void repo.reset(oid, mode); },
            })),
          }),
      }),
    })),
  });

  // -- tag ops --
  // Hands off to the create-tag dialog rather than taking a name inline: a tag
  // carries three values now (name, annotation, signing), and a palette input
  // step takes one (#132).
  if (headTip) {
    items.push({
      type: "command", id: "action:create-tag",
      search: "Create tag", label: "Create tag (at HEAD)…", icon: "tag",
      run: () => {
        palette().closePalette();
        void openCreateTag({ oid: headTip });
      },
    });
  }
  if (repo.tags.length) {
    items.push({
      type: "command", id: "action:delete-tag",
      search: "Delete tag", label: "Delete tag…", danger: true, icon: "tag",
      run: step(() => ({
        kind: "pick", title: "Delete tag",
        items: tagItems("tag", (n) => void repo.deleteTag(n)),
      })),
    });
    items.push({
      type: "command", id: "action:push-tag",
      search: "Push tag to remote", label: "Push tag…", icon: "tag",
      run: step(() => ({
        kind: "pick", title: "Push tag",
        items: tagItems("tag", (tagName) =>
          palette().pushStep({
            kind: "pick", title: `Push ${tagName} to…`,
            items: remoteItems("push", (r) => void repo.pushTag(r, tagName)),
          })),
      })),
    });
  }

  // -- stash ops --
  items.push({
    type: "command", id: "action:stash-save",
    search: "Stash changes save", label: "Stash changes…", icon: "stash",
    run: step(() => ({
      kind: "input", title: "Stash changes", placeholder: "message (optional)",
      onSubmit: (v) => {
        palette().closePalette();
        void repo.stashSave({
          message: v.trim() || null, includeUntracked: true, keepIndex: false,
        });
      },
    })),
  });
  if (repo.stashes.length) {
    items.push(
      {
        type: "command", id: "action:stash-pop-latest",
        search: "Pop latest stash", label: "Pop latest stash", icon: "stash",
        run: direct(() => void repo.stashPop(0)),
      },
      {
        type: "command", id: "action:stash-apply",
        search: "Apply stash", label: "Apply stash…", icon: "stash",
        run: step(() => ({
          kind: "pick", title: "Apply stash",
          items: stashItems("stash", (i) => void repo.stashApply(i)),
        })),
      },
      {
        type: "command", id: "action:stash-pop",
        search: "Pop stash", label: "Pop stash…", icon: "stash",
        run: step(() => ({
          kind: "pick", title: "Pop stash",
          items: stashItems("stash", (i) => void repo.stashPop(i)),
        })),
      },
      {
        type: "command", id: "action:stash-drop",
        search: "Drop stash", label: "Drop stash…", danger: true, icon: "trash",
        run: step(() => ({
          kind: "pick", title: "Drop stash",
          items: stashItems("trash", (i, oid) => void repo.stashDrop(i, oid)),
        })),
      },
      {
        type: "command", id: "action:stash-branch",
        search: "Create branch from stash", label: "Stash to branch…", icon: "branch",
        run: step(() => ({
          kind: "pick", title: "Stash → branch",
          items: stashItems("stash", (index) =>
            palette().pushStep({
              kind: "input", title: "New branch from stash", placeholder: "branch-name",
              validate: (v) => (v.trim() ? null : "Branch name required"),
              onSubmit: (v) => {
                palette().closePalette();
                void repo.stashBranch(index, v.trim());
              },
            })),
        })),
      },
    );
  }

  // -- forge (pull / merge requests, #92) --
  // Listed only once a forge is detected AND signed in: rows that could only
  // ever flash "no forge here" would be noise in every other repository.
  {
    const forgeState = useForgeStore.getState();
    if (forgeState.gate() === "ready" && forgeState.forge) {
      const kind = forgeState.forge.kind;
      const noun = prNoun(kind);
      items.push({
        type: "command", id: "action:forge-create",
        search: `Create ${noun} open new pr mr`,
        label: `Create ${noun}…`, icon: "pullRequest",
        actionId: "forge.createPr",
        run: direct(() => {
          useForgeStore.getState().openCreate();
          nav.setIntent({ kind: "switch-screen", screen: "pulls" });
        }),
      });
      items.push({
        type: "command", id: "action:forge-refresh",
        search: `Refresh ${noun}s reload`,
        label: `Refresh ${noun}s`, icon: "sync",
        run: direct(() => void useForgeStore.getState().refresh()),
      });
      if (forgeState.pulls.length) {
        items.push({
          type: "command", id: "action:forge-open",
          search: `Open ${noun} in browser`,
          label: `Open ${noun} in browser…`, icon: "external",
          run: step(() => ({
            kind: "pick", title: `Open ${noun}`,
            items: useForgeStore.getState().pulls.map((pr) => ({
              type: "command" as const,
              id: `pick-pr:${pr.number}`,
              search: `${prNumberLabel(kind, pr.number)} ${pr.title} ${pr.author}`,
              label: `${prNumberLabel(kind, pr.number)} ${pr.title}`,
              detail: `${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch}`,
              icon: "pullRequest",
              run: () => {
                palette().closePalette();
                void useForgeStore.getState().openInBrowser(pr);
              },
            })),
          })),
        });
      }
    }
  }

  // -- stop a running network op (#234) --
  // Listed only while one is running, the same gating `Resolve conflicts…` uses:
  // a row that only ever says "nothing to stop" is noise the rest of the time.
  // This is the KEYBOARD route to the titlebar's Stop button — a hung fetch must
  // not need a mouse.
  {
    const running: CancellableOp | null = repo.netOps.push
      ? "push"
      : repo.netOps.pull
        ? "pull"
        : repo.netOps.fetch
          ? "fetch"
          : null;
    if (running) {
      items.push({
        type: "command",
        id: "action:cancel-net-op",
        search: "Cancel stop abort fetch pull push network operation",
        label: `Stop the running ${running}`,
        icon: "x",
        run: direct(() => {
          repoState().cancelNetOp(running);
        }),
      });
    }
  }

  // -- conflict resolution --
  // Listed only while something is conflicted: with the Conflicts screen gone
  // (#108) this is the palette's route to the resolver window, and a row that
  // only ever flashes "nothing to resolve" would be noise the rest of the time.
  if (repo.status.some(isConflicted)) {
    items.push({
      type: "command", id: "action:resolve-conflicts",
      search: "Resolve conflicts merge rebase", label: "Resolve conflicts…",
      icon: "conflict", actionId: "conflict.openResolver",
      run: direct(() => {
        resolveConflictsOp();
      }),
    });
  }

  // -- submodules (#93) --
  // Listed only for a repository that actually has some — rows that would always
  // flash "no submodules" are noise in every other repository. Both feature stores
  // hydrate on repo open (see their `subscribe` calls), so these gates are accurate
  // without the user having visited the screen first.
  if (useSubmodulesStore.getState().items.length > 0) {
    items.push(
      {
        type: "command", id: "action:submodules-update-all",
        search: "Submodule update all init recursive",
        label: "Update all submodules", icon: "submodule",
        run: direct(() => void useSubmodulesStore.getState().update()),
      },
      {
        type: "command", id: "action:submodules-sync",
        search: "Submodule sync urls gitmodules",
        label: "Sync submodule URLs", icon: "link",
        run: direct(() => void useSubmodulesStore.getState().sync()),
      },
    );
  }

  // -- worktrees (#93) --
  const openableWorktrees = useWorktreesStore
    .getState()
    .items.filter((w) => !w.prunable && !w.isCurrent);
  if (openableWorktrees.length > 0) {
    items.push({
      type: "command", id: "action:worktree-open",
      search: "Open linked worktree switch", label: "Open linked worktree…",
      icon: "worktree",
      run: step(() => ({
        kind: "pick", title: "Open worktree",
        items: openableWorktrees.map((w) => ({
          type: "command" as const,
          id: `pick-worktree:${w.name}`,
          search: `${w.name} ${w.branch ?? ""} ${w.path}`,
          label: w.name,
          detail: w.branch ?? w.path,
          icon: "worktree",
          run: () => {
            palette().closePalette();
            void useWorktreesStore.getState().openAsRepo(w.path);
          },
        })),
      })),
    });
  }

  // -- LFS (#93) --
  // Only once the repository is known to use LFS: the store is populated by the
  // Remote screen's panel, so an untouched repo simply has no rows here.
  if (useLfsStore.getState().status?.inUse) {
    items.push(
      {
        type: "command", id: "action:lfs-pull",
        search: "LFS pull objects large files",
        label: "LFS: pull objects", icon: "lfs",
        run: direct(() => void useLfsStore.getState().pull()),
      },
      {
        type: "command", id: "action:lfs-checkout",
        search: "LFS checkout materialize pointers",
        label: "LFS: checkout (materialize pointers)", icon: "lfs",
        run: direct(() => void useLfsStore.getState().checkout()),
      },
    );
  }

  // -- bisect (#93) --
  // Bisect has no keyboard chords on purpose (see actions.ts), so the palette is
  // its keyboard route. Two different sets, because the same verbs mean different
  // things before and during a search.
  if (repo.bisectStatus.inProgress) {
    const { goodTerm, badTerm } = repo.bisectStatus;
    items.push(
      {
        type: "command", id: "action:bisect-good",
        search: `Bisect mark current ${goodTerm}`,
        label: `Bisect: mark current as ${goodTerm}`, icon: "check",
        run: direct(() => void repo.bisectMark("Good")),
      },
      {
        type: "command", id: "action:bisect-bad",
        search: `Bisect mark current ${badTerm}`,
        label: `Bisect: mark current as ${badTerm}`, icon: "warn",
        run: direct(() => void repo.bisectMark("Bad")),
      },
      {
        type: "command", id: "action:bisect-skip",
        search: "Bisect skip current revision untestable",
        label: "Bisect: skip current revision", icon: "chevronRight",
        run: direct(() => void repo.bisectMark("Skip")),
      },
      {
        type: "command", id: "action:bisect-reset",
        search: "Bisect reset end stop", label: "Bisect: reset", danger: true,
        icon: "undo",
        run: direct(() => void repo.bisectReset()),
      },
    );
  } else {
    items.push({
      type: "command", id: "action:bisect-start",
      search: "Bisect start find first bad commit",
      label: "Start bisect…", icon: "bisect",
      // Bad first, then good: that is the order `git bisect start` takes them, and
      // the order the user thinks in ("it's broken now, it worked then").
      run: step(() => ({
        kind: "pick", title: "Bisect: which commit is BAD?",
        items: commitItems({
          icon: "warn",
          // Distinct id namespaces: the same commit is a different frecency row
          // depending on which end of the range it is being picked for.
          idPrefix: "pick-bisect-bad",
          onPick: (bad: string) =>
            palette().pushStep({
              kind: "pick", title: "Bisect: which commit is GOOD?",
              items: commitItems({
                icon: "check",
                idPrefix: "pick-bisect-good",
                onPick: (good: string) => void repo.bisectStart(bad, [good]),
              }),
            }),
        }),
      })),
    });
  }

  // -- in-progress operation controls --
  if (repo.repoState !== "Clean") {
    items.push(
      {
        type: "command", id: "action:continue-op",
        search: "Continue operation rebase merge", label: "Continue current operation",
        icon: "rebase", run: direct(() => void repo.continueOperation()),
      },
      {
        type: "command", id: "action:abort-op",
        search: "Abort operation rebase merge", label: "Abort current operation",
        danger: true, icon: "trash", run: direct(() => void repo.abortOperation()),
      },
    );
  }

  return items;
}
