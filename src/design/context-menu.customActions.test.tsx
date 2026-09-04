// Where a custom action shows up (#225, second half).
//
// The first half put user-defined commands in the command palette and nowhere
// else, which left `$FILE`, `$FILES` and `$SHA` advertised in Settings and
// unfillable in practice — nothing ever populated an `ActionContext` beyond the
// repository and the branch. This pins the other three quarters of that: which
// surface each action is offered on, and that each surface sends the context
// its placeholders are named after.
//
// The argv, the parsing and the substitution are the backend's (`custom_action.rs`
// plus its Rust tests); what only this layer can get wrong is sending the WRONG
// CONTEXT — a commit menu that forgets the sha, or a multi-select that sends one
// file where the user selected five. Both fail silently: the placeholder expands
// to an empty argument and the program fails somewhere far from the cause.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commitMenuItems,
  commitMultiMenuItems,
  fileMenuItems,
  multiFileMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { pgFlashClear } from "./ui-helpers";
import { buildCommands } from "@/features/palette/commands";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { ActionSurface, CustomAction } from "@/features/actions/customActions";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const action = (id: string, surfaces: ActionSurface[]): CustomAction => ({
  id,
  name: `Run ${id}`,
  command: "tool $FILE",
  // Both off so a click is exactly one `run_custom_action` and nothing else:
  // the output dialog and the refresh have their own tests, and neither is what
  // this file is about.
  showOutput: false,
  refreshAfter: false,
  surfaces,
  chord: "",
});

const labels = (items: ContextMenuItem[]) =>
  items.filter((i) => !i.divider && !i.__menuTitle).map((i) => String(i.label));

function click(items: ContextMenuItem[], label: string) {
  const found = items.find((i) => String(i.label) === label);
  expect(found, `no menu item labelled ${label}`).toBeDefined();
  return found!.onClick?.();
}

const actionCalls = () =>
  getInvokeCalls().filter((c) => c.cmd === "run_custom_action");

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useSettingsStore.getState().reset();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    headInfo: { branch: "main", headOid: "deadbeef" },
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    activity: {},
  } as never);
  mockInvoke("run_custom_action", () => ({
    code: 0,
    stdout: "",
    stderr: "",
    argv: ["tool"],
  }));
});

afterEach(() => {
  pgFlashClear();
  vi.restoreAllMocks();
});

const setActions = (list: CustomAction[]) =>
  useSettingsStore.getState().set("customActions", list);

describe("a custom action on the file context menu", () => {
  it("is offered only when the action opted into the file surface", () => {
    setActions([action("f", ["file"]), action("r", ["repo"])]);
    const items = labels(fileMenuItems({ path: "src/a.ts" }));
    expect(items).toContain("Run f");
    expect(items).not.toContain("Run r");
  });

  it("sends the row's path as the file selection", async () => {
    setActions([action("f", ["file"])]);
    await click(fileMenuItems({ path: "src/a.ts" }), "Run f");
    expect(actionCalls()).toEqual([
      {
        cmd: "run_custom_action",
        args: {
          repoId: "r1",
          command: "tool $FILE",
          context: {
            // Never the frontend's to choose — the backend overwrites it with
            // the repository it resolves, which is also the child's cwd.
            repo: "",
            files: ["src/a.ts"],
            sha: null,
            branch: "main",
          },
        },
      },
    ]);
  });

  it("sends every selected path from a multi-select, for the $FILES form", async () => {
    // The failure this catches is silent: one path where five were selected
    // still runs the program, just on the wrong thing.
    setActions([action("f", ["file"])]);
    await click(
      multiFileMenuItems({
        stagedPaths: ["a.ts"],
        unstagedPaths: ["b.ts", "c.ts"],
      }),
      "Run f",
    );
    expect(actionCalls()[0]?.args).toMatchObject({
      context: { files: ["a.ts", "b.ts", "c.ts"], sha: null },
    });
  });

  it("leaves the menu untouched when no action wants the file surface", () => {
    // Specifically: no orphan divider. An empty separated block looks like a
    // menu that failed to render its own entries.
    const before = fileMenuItems({ path: "a.ts" });
    setActions([action("r", ["repo"])]);
    expect(fileMenuItems({ path: "a.ts" })).toHaveLength(before.length);
  });

  it("sits above the danger block on both file menus", () => {
    // The house shape: Discard / Delete stay the LAST thing in a file menu, so
    // a mis-click near the bottom cannot land on a destructive entry that has
    // quietly moved. A user command is not a danger entry and must not push one
    // out of that position, so it goes directly under the other "run something
    // outside the app" entries instead.
    setActions([action("f", ["file"])]);
    const after = (items: ContextMenuItem[], label: string) =>
      labels(items).slice(labels(items).indexOf(label) + 1);

    expect(after(fileMenuItems({ path: "a.ts" }), "Run f")).toEqual([
      "Discard changes",
      "Ignore this file",
    ]);
    expect(
      after(
        multiFileMenuItems({ stagedPaths: [], unstagedPaths: ["b.ts"] }),
        "Run f",
      ),
    ).toEqual(["Discard changes in 1 file…"]);
  });

  it("is absent from the menus that replace the file menu entirely", () => {
    // Same call `externalDiffItem` made: a conflicted row gets the conflict
    // menu and a submodule row gets the submodule menu. Neither is a file menu
    // with extras removed, so neither grows a file-surface action.
    setActions([action("f", ["file"])]);
    for (const items of [
      fileMenuItems({ path: "a.ts", conflicted: true }),
      fileMenuItems({ path: "vendor/lib", submodule: true }),
    ]) {
      expect(labels(items)).not.toContain("Run f");
    }
  });
});

describe("a custom action on the commit context menu", () => {
  it("is offered only when the action opted into the commit surface", () => {
    setActions([action("c", ["commit"]), action("f", ["file"])]);
    const items = labels(commitMenuItems({ sha: "abc1234" }));
    expect(items).toContain("Run c");
    expect(items).not.toContain("Run f");
  });

  it("sends the commit's sha and no files", async () => {
    setActions([action("c", ["commit"])]);
    await click(commitMenuItems({ sha: "abc1234" }), "Run c");
    expect(actionCalls()[0]?.args).toMatchObject({
      context: { repo: "", files: [], sha: "abc1234", branch: "main" },
    });
  });

  it("stays off a multi-commit selection", () => {
    // `$SHA` is singular and the substitution has no list form for it, so the
    // honest answer for a selection of five is not "the first one" — it is that
    // this menu does not offer actions at all.
    setActions([action("c", ["commit"])]);
    expect(labels(commitMultiMenuItems(["abc1234", "def5678"]))).not.toContain(
      "Run c",
    );
  });
});

describe("a custom action in the command palette", () => {
  it("is listed only when the action opted into the repo surface", () => {
    setActions([action("r", ["repo"]), action("f", ["file"])]);
    const ids = buildCommands().map((i) => i.id);
    expect(ids).toContain("custom-action:r");
    expect(ids).not.toContain("custom-action:f");
  });

  it("still lists an action saved before surfaces existed", () => {
    // THE MIGRATION, at the surface it has to hold at: an action persisted by
    // the first half has no `surfaces` key and was a palette action. It stays
    // one, and it does NOT appear in the two new menus.
    const legacy = { ...action("old", ["repo"]) } as Partial<CustomAction>;
    delete legacy.surfaces;
    setActions([legacy as CustomAction]);
    expect(buildCommands().map((i) => i.id)).toContain("custom-action:old");
    expect(labels(fileMenuItems({ path: "a.ts" }))).not.toContain("Run old");
    expect(labels(commitMenuItems({ sha: "abc1234" }))).not.toContain("Run old");
  });
});
