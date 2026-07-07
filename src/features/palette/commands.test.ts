// src/features/palette/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildCommands } from "./commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { usePaletteStore } from "./usePaletteStore";
import type { BranchInfo, StashInfo } from "@/lib/types";

const mkBranch = (name: string, isHead = false, upstream: string | null = null): BranchInfo => ({
  name, isHead, isRemote: false, upstream, ahead: 0, behind: 0, tip: "deadbeef",
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

describe("buildCommands", () => {
  beforeEach(() => {
    setRepo({});
    usePaletteStore.setState({ open: true, stack: [{ kind: "root" }], query: "", activeChip: "all" });
  });

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
