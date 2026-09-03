// src/features/palette/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  branchItems,
  branchPickStep,
  buildCommands,
  commitItems,
  fileItems,
} from "./commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { newTab } from "@/features/repo/tabs";
import { useCreateStore } from "@/features/create/useCreateStore";
import { paletteInitial, usePaletteStore } from "./usePaletteStore";
import { useCompareStore } from "@/features/compare/useCompareStore";
import type { PaletteStep } from "./types";
import type { BranchInfo, CommitInfo, FileStatus, StashInfo } from "@/lib/types";

const mkBranch = (name: string, isHead = false, upstream: string | null = null): BranchInfo => ({
  name, isHead, isRemote: false, upstream, ahead: 0, behind: 0, tip: "deadbeef",
  tipTime: 0, isDefault: false,
});

const mkRemoteBranch = (name: string): BranchInfo => ({
  name, isHead: false, isRemote: true, upstream: null, ahead: 0, behind: 0, tip: "deadbeef",
  tipTime: 0, isDefault: false,
});

const mkCommit = (oid: string, summary: string): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary, body: null, author: "Dev", email: "",
  timestamp: 0, parents: [], refs: [],
});

const mkFile = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

function setRepo(partial: Record<string, unknown>) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [], allFiles: [], branches: [], tags: [], stashes: [],
    remotes: [], commits: [], loading: false, error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
    ...partial,
  } as never);
}

const ids = () => buildCommands().map((i) => i.id);

// Two tests below swap `pushStep` for a collector via setState. That replaces
// the store's real action for good, so capture it once and restore it per test
// — `paletteInitial()` deliberately covers state fields, not actions.
const realPushStep = usePaletteStore.getState().pushStep;
const realClosePalette = usePaletteStore.getState().closePalette;

function resetStores() {
  setRepo({});
  usePaletteStore.setState({
    ...paletteInitial(),
    open: true,
    pushStep: realPushStep,
    closePalette: realClosePalette,
  });
}

describe("buildCommands", () => {
  beforeEach(resetStores);

  it("always includes screen nav + fetch/refresh", () => {
    expect(ids()).toEqual(expect.arrayContaining([
      "screen:branches", "screen:settings", "action:fetch-all", "action:refresh",
    ]));
  });

  it("links rows to keymap actions so chord chips render", () => {
    const byId = new Map(buildCommands().map((i) => [i.id, i]));
    expect(byId.get("screen:repo")?.actionId).toBe("nav.files");
    expect(byId.get("screen:commit")?.actionId).toBe("nav.commit");
    expect(byId.get("screen:settings")?.actionId).toBe("nav.settings");
    expect(byId.get("action:fetch-all")?.actionId).toBe("repo.fetch");
    expect(byId.get("action:refresh")?.actionId).toBe("repo.refresh");
  });

  it("includes clone/init rows wired to the keymap (chip derives live, not hardcoded)", () => {
    const byId = new Map(buildCommands().map((i) => [i.id, i]));
    expect(byId.get("action:clone")?.actionId).toBe("repo.clone");
    expect(byId.get("action:init")?.actionId).toBe("repo.init");
  });

  it("action:clone opens the clone dialog; action:init opens the init dialog", () => {
    useCreateStore.setState({ open: "none", busy: false, progress: null, error: null });
    const byId = new Map(buildCommands().map((i) => [i.id, i]));

    byId.get("action:clone")!.run();
    expect(useCreateStore.getState().open).toBe("clone");

    useCreateStore.setState({ open: "none", busy: false, progress: null, error: null });
    byId.get("action:init")!.run();
    expect(useCreateStore.getState().open).toBe("init");
  });

  it("links push/pull rows to repo actions when a branch is current", () => {
    setRepo({ branches: [mkBranch("main", true, "origin/main")] });
    const byId = new Map(buildCommands().map((i) => [i.id, i]));
    expect(byId.get("action:push-current")?.actionId).toBe("repo.push");
    expect(byId.get("action:pull-current")?.actionId).toBe("repo.pull");
  });

  it("pull/push use the tracking branch and honour defaultPullMode", async () => {
    // Regression: the palette Pull row must pass the upstream tracking branch
    // (not the local head name) and the user's pull mode, matching the keymap
    // runner it advertises — not silently pull `local` in Merge mode.
    const { useSettingsStore } = await import("@/features/settings/useSettingsStore");
    useSettingsStore.setState({ defaultPullMode: "Rebase" });
    const pull = vi.fn();
    const push = vi.fn();
    // Local branch "feature" tracks a differently-named remote branch.
    setRepo({
      branches: [mkBranch("feature", true, "origin/main")],
      pull,
      push,
    });
    const byId = new Map(buildCommands().map((i) => [i.id, i]));

    byId.get("action:pull-current")?.run();
    expect(pull).toHaveBeenCalledWith("origin", "main", "Rebase");

    byId.get("action:push-current")?.run();
    expect(push).toHaveBeenCalledWith("origin", "main", "None");
  });

  it("offers a danger-marked push that skips hooks, and refuses without a confirm", () => {
    // #232: the escape hatch must be per-invocation and VISIBLE. There is no
    // push dialog to hang a checkbox on, so it is its own command — the shape
    // force-push already uses.
    const push = vi.fn();
    setRepo({ branches: [mkBranch("main", true, "origin/main")] });
    useRepoStore.setState({ push } as never);

    const item = buildCommands().find(
      (i) => i.id === "action:push-current-no-verify",
    );
    expect(item).toBeTruthy();
    expect(item!.danger).toBe(true);

    // No <PGDialogHost/> is mounted in this file, so pgConfirm resolves FALSE —
    // which makes this the decline path, and the safety-critical direction:
    // an unconfirmed skip must push nothing at all.
    item!.run();
    expect(push).not.toHaveBeenCalled();
  });

  // Cancelling a stalled network op without a mouse (#263 item 4). The status
  // bar's Cancel button was the only route to `cancelNetworkOps`, so a keyboard
  // user watching a fetch hang had to reach for the pointer.
  describe("cancel the running network op", () => {
    const act = (label: string) => ({ label, startedAt: 1_000 });

    it("is absent while nothing is running", () => {
      expect(ids()).not.toContain("action:cancel-network");
    });

    it("appears while a fetch is running and cancels it", () => {
      const cancelNetworkOps = vi.fn();
      setRepo({ activity: { fetch: act("Fetching origin…") }, cancelNetworkOps });
      const item = buildCommands().find((i) => i.id === "action:cancel-network");
      expect(item).toBeTruthy();
      // Names what it would stop — there can be several ops in flight, and a
      // bare "Cancel" in a palette is a row nobody dares press.
      expect(item!.detail).toBe("Fetching origin…");
      item!.run();
      expect(cancelNetworkOps).toHaveBeenCalled();
    });

    it("stays away from an op the backend cannot stop", () => {
      // Same gate as the status bar's button (`isCancellable`): a rebase replay
      // is libgit2 work inside one blocking call with nothing to signal, so a
      // row offering to cancel it would be a row that does nothing.
      setRepo({ activity: { rebase: act("Rebasing…") } });
      expect(ids()).not.toContain("action:cancel-network");
    });

    it("relabels itself once a cancel has been asked for", () => {
      // The second ask escalates SIGTERM → SIGKILL (#263), so the first one has
      // to have visibly changed something — here as in the status bar.
      setRepo({ activity: { fetch: act("Fetching origin…") } });
      const before = buildCommands().find((i) => i.id === "action:cancel-network");
      expect(before!.label).toBe("Cancel network operation");

      setRepo({ activity: { fetch: act("Fetching origin…") }, cancelRequested: true });
      const after = buildCommands().find((i) => i.id === "action:cancel-network");
      expect(after!.label).toBe("Force stop network operation");
    });
  });

  it("omits stash-pop when there are no stashes", () => {
    expect(ids()).not.toContain("action:stash-pop-latest");
  });

  it("includes stash-pop when stashes exist", () => {
    setRepo({ stashes: [{ index: 0, shortOid: "abc", message: "wip" } as StashInfo] });
    expect(ids()).toContain("action:stash-pop-latest");
  });

  it("omits continue/abort when repo is clean", () => {
    expect(ids()).not.toContain("action:abort-op");
    expect(ids()).not.toContain("action:continue-op");
  });

  it("includes continue/abort mid-operation", () => {
    setRepo({ repoState: "Rebase" });
    expect(ids()).toEqual(expect.arrayContaining(["action:abort-op", "action:continue-op"]));
  });

  it("push current with upstream runs push directly (no step pushed)", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    setRepo({ branches: [mkBranch("main", true, "origin/main")], push });
    const pushStep = vi.spyOn(usePaletteStore.getState(), "pushStep");
    const item = buildCommands().find((i) => i.id === "action:push-current")!;
    item.run();
    expect(push).toHaveBeenCalledWith("origin", "main", "None");
    expect(pushStep).not.toHaveBeenCalled();
  });

  it("merge command pushes a branch-pick step", () => {
    setRepo({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
    const pushed: unknown[] = [];
    usePaletteStore.setState({ pushStep: (s: import("./types").PaletteStep) => pushed.push(s) } as never);
    buildCommands().find((i) => i.id === "action:merge")!.run();
    expect(pushed).toHaveLength(1);
    const step = pushed[0] as { kind: string; items: { label: string }[] };
    expect(step.kind).toBe("pick");
    // only non-head branches offered as merge sources
    expect(step.items.map((i) => i.label)).toEqual(["feat/x"]);
  });

  describe("repository tabs (#90)", () => {
    beforeEach(() => {
      useTabsStore.setState({ tabs: [], activePath: null, activationSeq: 0 });
      useRecentsStore.setState({ recents: [] });
    });

    it("always offers the switcher — it is the only keyboard route to a recent repo", () => {
      const byId = new Map(buildCommands().map((i) => [i.id, i]));
      expect(byId.get("action:switch-repo")?.actionId).toBe("tab.switch");
    });

    it("offers close-tab only with a repository open", () => {
      expect(ids()).not.toContain("action:close-repo-tab");
      useTabsStore.setState({
        tabs: [newTab("/dev/api", { status: "open", repoId: "r1" })],
        activePath: "/dev/api",
      });
      const byId = new Map(buildCommands().map((i) => [i.id, i]));
      expect(byId.get("action:close-repo-tab")?.actionId).toBe("tab.close");
      // A row that only ever says "nothing to close" would be permanent noise.
      expect(ids()).not.toContain("action:close-other-repo-tabs");
    });

    it("offers close-others only with two or more tabs", () => {
      useTabsStore.setState({
        tabs: [
          newTab("/dev/api", { status: "open", repoId: "r1" }),
          newTab("/dev/web", { status: "open", repoId: "r2" }),
        ],
        activePath: "/dev/api",
      });
      expect(ids()).toContain("action:close-other-repo-tabs");
    });

    it("the switcher lists open tabs first, then unopened recents", () => {
      useTabsStore.setState({
        tabs: [newTab("/dev/api", { status: "open", repoId: "r1" })],
        activePath: "/dev/api",
      });
      useRecentsStore.setState({
        recents: [
          { path: "/dev/api", openedAt: 2 },
          { path: "/dev/old", openedAt: 1 },
        ],
      });
      const pushed: unknown[] = [];
      usePaletteStore.setState({ pushStep: (st: import("./types").PaletteStep) => pushed.push(st) } as never);
      buildCommands().find((i) => i.id === "action:switch-repo")!.run();
      const step = pushed[0] as { items: { id: string; label: string; detail?: string }[] };
      // The already-open recent is not listed twice.
      expect(step.items.map((i) => i.id)).toEqual([
        "repo-tab:/dev/api",
        "repo-recent:/dev/old",
      ]);
      expect(step.items[0].detail).toBe("current");
    });
  });

  it("compare commands are in the catalog and open the compare screen (#131)", () => {
    setRepo({ branches: [mkBranch("main", true), mkBranch("feature")] });
    expect(ids()).toEqual(
      expect.arrayContaining(["action:compare-refs", "action:compare-workdir"]),
    );

    // Same narrowing the merge-command test uses: `PaletteStep` is a union and
    // only its "pick" arm has `items`.
    const steps: { items: { label: string; run: () => void }[] }[] = [];
    usePaletteStore.setState({
      pushStep: (s: PaletteStep) =>
        steps.push(s as unknown as { items: { label: string; run: () => void }[] }),
    } as never);

    // Current branch on the LEFT, so the picked ref's own work reads as additions.
    buildCommands().find((i) => i.id === "action:compare-refs")!.run();
    steps[0].items.find((i) => i.label === "feature")!.run();
    expect(useCompareStore.getState().left).toEqual({ kind: "rev", rev: "main" });
    expect(useCompareStore.getState().right).toEqual({ kind: "rev", rev: "feature" });

    // The working-tree command puts the picked ref on the left instead.
    buildCommands().find((i) => i.id === "action:compare-workdir")!.run();
    steps[1].items.find((i) => i.label === "feature")!.run();
    expect(useCompareStore.getState().left).toEqual({ kind: "rev", rev: "feature" });
    expect(useCompareStore.getState().right).toEqual({ kind: "workdir" });
  });

  it("action:checkout-ref is always in the catalog", () => {
    expect(ids()).toContain("action:checkout-ref");
  });

  it("checkout-ref step includes tags and remote branches", () => {
    setRepo({
      tags: [{ name: "v1.0.0", shortOid: "abc1234", oid: "abc1234", annotation: null }],
      branches: [
        mkBranch("main", true),
        { name: "origin/feature", isHead: false, isRemote: true, upstream: null, ahead: 0, behind: 0, tip: "deadbeef" },
      ],
    });
    const pushed: unknown[] = [];
    usePaletteStore.setState({ pushStep: (s: import("./types").PaletteStep) => pushed.push(s) } as never);
    buildCommands().find((i) => i.id === "action:checkout-ref")!.run();
    expect(pushed).toHaveLength(1);
    const step = pushed[0] as { kind: string; items: { label: string }[] };
    expect(step.kind).toBe("pick");
    const labels = step.items.map((i) => i.label);
    expect(labels).toContain("v1.0.0");
    expect(labels).toContain("origin/feature");
  });
});

// The three row builders below are shared: the palette's ROOT step and the
// pick steps both build their branch/file/commit rows through them, so these
// tests pin the row shape (id, search, label, detail, icon) once for both.
describe("branchItems", () => {
  beforeEach(resetStores);

  it("builds a row per branch from the live store, pick-step ids by default", () => {
    setRepo({ branches: [mkBranch("main", true, "origin/main"), mkRemoteBranch("origin/feature")] });
    const items = branchItems({ icon: "branch", onPick: () => {} });
    expect(items.map((i) => i.id)).toEqual([
      "pick-branch:l:main", "pick-branch:r:origin/feature",
    ]);
    expect(items.map((i) => i.type)).toEqual(["branch", "branch"]);
    // search + label are the plain branch name; detail is the upstream, or
    // "remote" for a remote-tracking branch.
    expect(items.map((i) => i.search)).toEqual(["main", "origin/feature"]);
    expect(items.map((i) => i.label)).toEqual(["main", "origin/feature"]);
    expect(items.map((i) => i.detail)).toEqual(["origin/main", "remote"]);
    expect(items.every((i) => i.icon === "branch")).toBe(true);
  });

  it("leaves detail undefined for a local branch with no upstream", () => {
    setRepo({ branches: [mkBranch("wip")] });
    expect(branchItems({ icon: "branch", onPick: () => {} })[0].detail).toBeUndefined();
  });

  it("honours an explicit branch list, filter and id namespace", () => {
    // The root step passes its own list + `branch:` namespace; ids must not
    // collide with the pick-step rows (they are separate frecency keys).
    const items = branchItems({
      branches: [mkBranch("main", true), mkBranch("feat/x")],
      filter: (b) => !b.isHead,
      idPrefix: "branch",
      icon: "merge",
      onPick: () => {},
    });
    expect(items.map((i) => i.id)).toEqual(["branch:l:feat/x"]);
    expect(items[0].icon).toBe("merge");
  });

  // #135. Nothing pinned this before: the old fixture happened to order the
  // same way with and without the comparator, so a broken ordering would have
  // gone unnoticed here. Assert it on `branchItems` itself — it is pure. The
  // RENDERED palette order is deliberately not asserted anywhere: the root step
  // adds `frecencyScore` (Date.now() + localStorage) and caps each group, so
  // pinning that would be fragile by construction.
  it("pins the default branch and orders the rest by recency", () => {
    setRepo({
      branches: [
        { ...mkBranch("chore/old"), tipTime: 50 },
        { ...mkBranch("main"), tipTime: 100, isDefault: true },
        { ...mkBranch("feat/fresh"), tipTime: 900 },
      ],
    });
    const items = branchItems({ icon: "branch", onPick: () => {} });
    expect(items.map((i) => i.label)).toEqual(["main", "feat/fresh", "chore/old"]);
  });

  // The picker renders two labelled sections and the Branches screen splits by
  // view; a pick step renders ONE list, so the grouping has to happen here or
  // `main` and `origin/main` (both `isDefault`) take rows 1-2 and the rest
  // interleave by tip time.
  it("keeps locals ahead of remotes, ordering within each group", () => {
    setRepo({
      branches: [
        { ...mkRemoteBranch("origin/zzz"), tipTime: 950 },
        { ...mkBranch("zzz-local"), tipTime: 900 },
        { ...mkRemoteBranch("origin/main"), tipTime: 100, isDefault: true },
        { ...mkBranch("main"), tipTime: 100, isDefault: true },
      ],
    });
    const items = branchItems({ icon: "branch", onPick: () => {} });
    expect(items.map((i) => i.label)).toEqual([
      "main",
      "zzz-local",
      "origin/main",
      "origin/zzz",
    ]);
  });

  it("run() closes the palette, then calls onPick with the branch name", () => {
    setRepo({ branches: [mkBranch("feat/x")] });
    const order: string[] = [];
    usePaletteStore.setState({
      closePalette: () => { order.push("close"); },
    } as never);
    branchItems({ icon: "branch", onPick: (n) => order.push(`pick:${n}`) })[0].run();
    expect(order).toEqual(["close", "pick:feat/x"]);
  });
});

// The structural half of #135's resting-cursor rule: one constructor sets
// `cursor: "none"`, and every branch step in the catalog is built from it, so a
// new one cannot silently default to preselecting the pinned default branch.
describe("branchPickStep", () => {
  beforeEach(resetStores);

  it("always declines a resting cursor", () => {
    setRepo({ branches: [mkBranch("main"), mkBranch("feat/x")] });
    const s = branchPickStep({
      title: "Do a thing",
      icon: "branch",
      onPick: () => {},
    });
    expect(s).toMatchObject({ kind: "pick", title: "Do a thing", cursor: "none" });
    expect(s.kind === "pick" && s.items.map((i) => i.label)).toEqual([
      "feat/x",
      "main",
    ]);
  });

  it("passes its row options straight through", () => {
    setRepo({ branches: [mkBranch("main", true), mkBranch("feat/x")] });
    const s = branchPickStep({
      title: "T",
      idPrefix: "pick-compare",
      filter: (b) => !b.isHead,
      icon: "diff",
      onPick: () => {},
    });
    expect(s.kind === "pick" && s.items.map((i) => i.id)).toEqual([
      "pick-compare:l:feat/x",
    ]);
  });
});

describe("commitItems", () => {
  beforeEach(resetStores);

  it("builds a row per commit; search covers summary, short oid and author", () => {
    setRepo({ commits: [mkCommit("abcdef1234", "Fix the bug")] });
    const [item] = commitItems({ icon: "commit", onPick: () => {} });
    expect(item.id).toBe("pick-commit:abcdef1234");
    expect(item.type).toBe("commit");
    expect(item.search).toBe("Fix the bug abcdef1 Dev");
    expect(item.label).toBe("Fix the bug");
    // detail is "<shortOid> · <relative time>" — pin the prefix, not the clock.
    expect(item.detail?.startsWith("abcdef1 · ")).toBe(true);
    expect(item.icon).toBe("commit");
  });

  it("honours an explicit commit list and id namespace", () => {
    const items = commitItems({
      commits: [mkCommit("abcdef1234", "Fix the bug")],
      idPrefix: "commit",
      icon: "history",
      onPick: () => {},
    });
    expect(items.map((i) => i.id)).toEqual(["commit:abcdef1234"]);
    expect(items[0].icon).toBe("history");
  });

  it("run() closes the palette, then calls onPick with the full oid", () => {
    setRepo({ commits: [mkCommit("abcdef1234", "Fix the bug")] });
    const order: string[] = [];
    usePaletteStore.setState({ closePalette: () => { order.push("close"); } } as never);
    commitItems({ icon: "commit", onPick: (oid) => order.push(`pick:${oid}`) })[0].run();
    expect(order).toEqual(["close", "pick:abcdef1234"]);
  });
});

describe("fileItems", () => {
  beforeEach(resetStores);

  it("splits the path into basename label + directory detail", () => {
    setRepo({ allFiles: [mkFile("src/features/palette/commands.ts")] });
    const [item] = fileItems({ icon: "file", onPick: () => {} });
    expect(item.id).toBe("pick-file:src/features/palette/commands.ts");
    expect(item.type).toBe("file");
    // The whole path is searchable, not just the basename.
    expect(item.search).toBe("src/features/palette/commands.ts");
    expect(item.label).toBe("commands.ts");
    expect(item.detail).toBe("src/features/palette");
    expect(item.icon).toBe("file");
  });

  it("leaves detail undefined for a repo-root file", () => {
    setRepo({ allFiles: [mkFile("README.md")] });
    const [item] = fileItems({ icon: "file", onPick: () => {} });
    expect(item.label).toBe("README.md");
    expect(item.detail).toBeUndefined();
  });

  it("honours an explicit file list and id namespace", () => {
    const items = fileItems({
      files: [mkFile("a.txt")],
      idPrefix: "file",
      icon: "file",
      onPick: () => {},
    });
    expect(items.map((i) => i.id)).toEqual(["file:a.txt"]);
  });

  it("run() closes the palette, then calls onPick with the full path", () => {
    setRepo({ allFiles: [mkFile("src/a.txt")] });
    const order: string[] = [];
    usePaletteStore.setState({ closePalette: () => { order.push("close"); } } as never);
    fileItems({ icon: "file", onPick: (p) => order.push(`pick:${p}`) })[0].run();
    expect(order).toEqual(["close", "pick:src/a.txt"]);
  });
});
