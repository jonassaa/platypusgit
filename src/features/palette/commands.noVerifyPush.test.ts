// The ACCEPT path of "Push without hooks" (#232), in its own file.
//
// `pgConfirm` resolves false with no `<PGDialogHost/>` mounted, so the decline
// path is free to assert in `commands.test.ts`. Confirming needs the module
// stubbed — and that stub lives here rather than there so it cannot change the
// module graph of every other palette test.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/design")>();
  return { ...actual, pgConfirm: vi.fn() };
});

import { pgConfirm } from "@/design";
import { buildCommands } from "./commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo } from "@/lib/types";

const mkBranch = (
  name: string,
  isHead = false,
  upstream: string | null = null,
): BranchInfo => ({
  name, isHead, isRemote: false, upstream, ahead: 0, behind: 0, tip: "deadbeef",
  tipTime: 0, isDefault: false,
});

describe("push without hooks — confirmed", () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockClear();
    vi.mocked(pgConfirm).mockReset();
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      status: [], allFiles: [], branches: [mkBranch("main", true, "origin/main")],
      tags: [], stashes: [], remotes: [], commits: [],
      loading: false, error: null, repoState: "Clean",
      rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
      activity: {},
      push,
    } as never);
  });

  const item = () =>
    buildCommands().find((i) => i.id === "action:push-current-no-verify")!;

  it("pushes the UPSTREAM branch with noVerify, and without forcing", async () => {
    vi.mocked(pgConfirm).mockResolvedValue(true);
    item().run();
    // The guard is an async IIFE: let the confirm and the push microtasks land.
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    // "None" matters: skipping hooks must not quietly also force-push.
    expect(push).toHaveBeenCalledWith("origin", "main", "None", true);
  });

  it("says in the confirm what will not run", async () => {
    vi.mocked(pgConfirm).mockResolvedValue(true);
    item().run();
    await vi.waitFor(() => expect(pgConfirm).toHaveBeenCalled());
    const arg = vi.mocked(pgConfirm).mock.calls[0][0] as {
      body?: string;
      danger?: boolean;
    };
    expect(arg.danger).toBe(true);
    expect(arg.body).toContain("pre-push");
  });

  it("pushes nothing when the confirm is declined", async () => {
    vi.mocked(pgConfirm).mockResolvedValue(false);
    item().run();
    await vi.waitFor(() => expect(pgConfirm).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});
