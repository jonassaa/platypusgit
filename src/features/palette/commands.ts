// src/features/palette/commands.ts
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { usePaletteStore } from "./usePaletteStore";
import { currentBranch, relativeTime } from "@/lib/derive";
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

// ---- pick-step item builders (read live store data) -----------------------

function branchItems(
  predicate: (b: import("@/lib/types").BranchInfo) => boolean,
  icon: string,
  onPick: (name: string) => void,
): PaletteItem[] {
  return repoState()
    .branches.filter(predicate)
    .map((b) => ({
      type: "branch" as const,
      id: `pick-branch:${b.isRemote ? "r" : "l"}:${b.name}`,
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

function commitItems(
  icon: string,
  onPick: (oid: string) => void,
): PaletteItem[] {
  return repoState().commits.map((c) => ({
    type: "commit" as const,
    id: `pick-commit:${c.oid}`,
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

function stashItems(
  icon: string,
  onPick: (index: number) => void,
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
      onPick(s.index);
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

const SCREENS: [string, string, string, string?][] = [
  ["repo", "Files", "folder", "⌘1"],
  ["commit", "Commit", "commit", "⌘2"],
  ["history", "History", "history", "⌘3"],
  ["branches", "Branches", "branch", "⌘4"],
  ["conflict", "Conflicts", "conflict", "⌘5"],
  ["rebase", "Rebase", "rebase", "⌘6"],
  ["remote", "Remotes", "link", "⌘7"],
  ["diff", "Diff viewer", "fileCode", "⌘8"],
  ["reflog", "Reflog", "clock", "⌘9"],
  ["settings", "Settings", "settings"],
];

export function buildCommands(): PaletteItem[] {
  const repo = repoState();
  const nav = useNavStore.getState();
  const head = currentBranch(repo.branches);
  const headName = head?.name ?? null;
  const headTip = head?.tip ?? repo.commits[0]?.oid ?? null;
  const upstreamRemote = head?.upstream?.split("/")[0] ?? null;
  const items: PaletteItem[] = [];

  // -- navigation (launch existing screens) --
  for (const [id, label, icon, shortcut] of SCREENS) {
    items.push({
      type: "command",
      id: `screen:${id}`,
      search: `${label} ${id} go to`,
      label: `Go to ${label}`,
      detail: shortcut,
      icon,
      run: direct(() => nav.setIntent({ kind: "switch-screen", screen: id })),
    });
  }

  // -- direct actions --
  items.push(
    {
      type: "command", id: "action:fetch-all", search: "Fetch all remotes",
      label: "Fetch all remotes", icon: "fetch",
      run: direct(() => void repo.fetchAll()),
    },
    {
      type: "command", id: "action:refresh", search: "Refresh repository",
      label: "Refresh repository", icon: "sync",
      run: direct(() => void repo.refreshAll()),
    },
  );

  // -- smart push / pull / force-push (need a current branch) --
  if (headName) {
    const name = headName;
    items.push({
      type: "command", id: "action:push-current",
      search: "Push current branch", label: `Push ${name}`,
      detail: head?.upstream ?? "set upstream", icon: "push",
      run: upstreamRemote
        ? direct(() => void repo.push(upstreamRemote, name, "None"))
        : step(() => ({
            kind: "pick", title: `Push ${name} to…`,
            items: remoteItems("push", (r) => void repo.push(r, name, "None")),
          })),
    });
    items.push({
      type: "command", id: "action:pull-current",
      search: "Pull current branch", label: `Pull ${name}`,
      detail: head?.upstream ?? undefined, icon: "pull",
      run: upstreamRemote
        ? direct(() => void repo.pull(upstreamRemote, name))
        : step(() => ({
            kind: "pick", title: `Pull ${name} from…`,
            items: remoteItems("pull", (r) => void repo.pull(r, name)),
          })),
    });
    const guardedForcePush = (remote: string) => {
      if (
        useSettingsStore.getState().confirmForcePush &&
        !window.confirm(
          `Force-push ${name} to ${remote} (with lease)? This overwrites the remote branch.`,
        )
      ) {
        return;
      }
      void repo.push(remote, name, "WithLease");
    };
    items.push({
      type: "command", id: "action:force-push-current",
      search: "Force push current branch with lease",
      label: `Force-push ${name} (with lease)`, danger: true,
      detail: head?.upstream ?? undefined, icon: "push",
      run: upstreamRemote
        ? direct(() => guardedForcePush(upstreamRemote))
        : step(() => ({
            kind: "pick", title: `Force-push ${name} to…`,
            items: remoteItems("push", (r) => guardedForcePush(r)),
          })),
    });
  }

  // -- branch ops --
  items.push({
    type: "command", id: "action:checkout-branch",
    search: "Checkout branch switch", label: "Checkout branch…", icon: "branch",
    run: step(() => ({
      kind: "pick", title: "Checkout branch",
      items: branchItems((b) => !b.isHead, "branch", (n) => void repo.checkoutBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:create-branch",
    search: "Create new branch", label: "Create branch…", icon: "plus",
    run: step(() => ({
      kind: "input", title: "Create branch", placeholder: "new-branch-name",
      validate: (v) => (v.trim() ? null : "Branch name required"),
      onSubmit: (v) => {
        palette().closePalette();
        void repo.createAndSwitchBranch(v.trim(), { autoStash: true });
      },
    })),
  });
  items.push({
    type: "command", id: "action:merge",
    search: "Merge branch into current", label: "Merge branch into current…", icon: "merge",
    run: step(() => ({
      kind: "pick", title: "Merge into current",
      items: branchItems((b) => !b.isHead, "merge", (n) => void repo.mergeBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:rebase-onto",
    search: "Rebase current onto branch", label: "Rebase current onto…", icon: "rebase",
    run: step(() => ({
      kind: "pick", title: "Rebase onto",
      items: branchItems((b) => !b.isHead, "rebase", (n) => void repo.rebaseOnto(n)),
    })),
  });
  items.push({
    type: "command", id: "action:delete-branch",
    search: "Delete branch", label: "Delete branch…", danger: true, icon: "trash",
    run: step(() => ({
      kind: "pick", title: "Delete branch",
      items: branchItems((b) => !b.isHead && !b.isRemote, "trash", (n) =>
        void repo.deleteBranch(n)),
    })),
  });
  items.push({
    type: "command", id: "action:rename-branch",
    search: "Rename branch", label: "Rename branch…", icon: "branch",
    run: step(() => ({
      kind: "pick", title: "Rename branch",
      items: branchItems((b) => !b.isRemote, "branch", (oldName) =>
        palette().pushStep({
          kind: "input", title: `Rename ${oldName}`, placeholder: "new-name",
          initial: oldName,
          validate: (v) => (v.trim() ? null : "Name required"),
          onSubmit: (v) => {
            palette().closePalette();
            void repo.renameBranch(oldName, v.trim());
          },
        })),
    })),
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
      items: commitItems("commit", (oid) => void repo.cherryPick(oid)),
    })),
  });
  items.push({
    type: "command", id: "action:revert",
    search: "Revert commit", label: "Revert commit…", icon: "history",
    run: step(() => ({
      kind: "pick", title: "Revert",
      items: commitItems("history", (oid) => void repo.revert(oid)),
    })),
  });
  items.push({
    type: "command", id: "action:reset",
    search: "Reset current branch to commit", label: "Reset current branch to…",
    icon: "rebase",
    run: step(() => ({
      kind: "pick", title: "Reset to commit",
      items: commitItems("commit", (oid) =>
        palette().pushStep({
          kind: "pick", title: "Reset mode",
          items: (["Soft", "Mixed", "Hard"] as const).map((mode) => ({
            type: "command" as const, id: `reset-mode:${mode}`,
            search: mode, label: mode, danger: mode === "Hard",
            icon: "rebase",
            run: () => { palette().closePalette(); void repo.reset(oid, mode); },
          })),
        })),
    })),
  });

  // -- tag ops --
  items.push({
    type: "command", id: "action:create-tag",
    search: "Create tag", label: "Create tag…", icon: "tag",
    run: step(() => ({
      kind: "input", title: "Create tag (at HEAD)", placeholder: "v1.2.3",
      validate: (v) => (!v.trim() ? "Tag name required" : headTip ? null : "No commit to tag"),
      onSubmit: (v) => {
        palette().closePalette();
        if (headTip) void repo.createTag(v.trim(), { oid: headTip, annotation: null });
      },
    })),
  });
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
          items: stashItems("trash", (i) => void repo.stashDrop(i)),
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
