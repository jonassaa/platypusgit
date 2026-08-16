// The stash menu's three new entries (#133): rename, and the two comparisons.
// Plus the selection menu's partial stash, whose `includeUntracked` is DERIVED
// rather than asked — `git stash push -- <untracked>` fails without it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  multiFileMenuItems,
  stashMenuItems,
  type ContextMenuItem,
} from "./context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import {
  WithDialogs,
  acceptDialog,
  dialogBody,
  dismissDialog,
  resetDialogs,
} from "@/test/dialog";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const OID = "a".repeat(40);

const STASH = {
  index: 1,
  name: "stash@{1}",
  oid: OID,
  message: "On main: wip",
  untracked: false,
};

function labeled(items: ContextMenuItem[], match: RegExp): ContextMenuItem {
  const found = items.find((i) => typeof i.label === "string" && match.test(i.label));
  expect(found, `no menu item matching ${match}`).toBeTruthy();
  return found!;
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  resetDialogs();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: [],
    status: [],
    branches: [],
    stashes: [],
    loading: false,
  } as never);
  useNavStore.setState({ intent: null });
  mockInvoke("stash_rename", () => null);
  mockInvoke("stash_save_paths", () => OID);
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("stash comparisons", () => {
  it("compares against the stash's own parent, addressed by full oid", () => {
    labeled(stashMenuItems(STASH), /what it changed/).onClick?.();

    expect(useNavStore.getState().intent).toEqual({
      kind: "stash-diff",
      oid: OID,
      label: "stash@{1}",
      untracked: false,
    });
  });

  it("compares against the working tree as its own target", () => {
    labeled(stashMenuItems(STASH), /Compare with working tree/).onClick?.();

    expect(useNavStore.getState().intent).toEqual({
      kind: "stash-vs-wt",
      oid: OID,
      label: "stash@{1}",
      untracked: false,
    });
  });

  it("carries the untracked flag so the view can say what it left out", () => {
    labeled(
      stashMenuItems({ ...STASH, untracked: true }),
      /what it changed/,
    ).onClick?.();

    expect(useNavStore.getState().intent).toMatchObject({ untracked: true });
  });

  it("disables both comparisons when no oid is known", () => {
    const items = stashMenuItems({ index: 0, name: "stash@{0}" });
    expect(labeled(items, /what it changed/).disabled).toBe(true);
    expect(labeled(items, /Compare with working tree/).disabled).toBe(true);
  });
});

describe("stash rename", () => {
  it("prefills the current message and renames by index", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(stashMenuItems(STASH), /^Rename/).onClick?.();

    const input = (await screen.findByTestId("dialog-input")) as HTMLInputElement;
    expect(input.value).toBe("On main: wip");
    await acceptDialog("a better name");

    await waitFor(() => expect(calls("stash_rename").length).toBe(1));
    // The oid rides along with the index: an index is a reflog POSITION, so the
    // backend needs the commit to prove the entry is still the one picked.
    expect(calls("stash_rename")[0].args).toMatchObject({
      index: 1,
      oid: OID,
      message: "a better name",
    });
  });

  it("is disabled when the entry's oid is unknown", () => {
    const items = stashMenuItems({ index: 0, name: "stash@{0}", message: "x" });
    expect(labeled(items, /^Rename/).disabled).toBe(true);
    expect(labeled(items, /^Drop/).disabled).toBe(true);
  });

  it("does nothing when the prompt is dismissed", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(stashMenuItems(STASH), /^Rename/).onClick?.();
    await screen.findByTestId("dialog-input");
    await dismissDialog();

    expect(calls("stash_rename").length).toBe(0);
  });
});

describe("stash drop", () => {
  it("names the commit as well as the index", async () => {
    mockInvoke("stash_drop", () => null);
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(stashMenuItems(STASH), /^Drop/).onClick?.();
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();

    await waitFor(() => expect(calls("stash_drop").length).toBe(1));
    expect(calls("stash_drop")[0].args).toMatchObject({ index: 1, oid: OID });
  });
});

describe("partial stash from a selection", () => {
  const sel = (over: Partial<Parameters<typeof multiFileMenuItems>[0]> = {}) => ({
    stagedPaths: [],
    unstagedPaths: ["a.txt"],
    paths: ["a.txt"],
    embeddedPaths: [],
    untrackedPaths: [],
    ...over,
  });

  it("stashes the selected paths, without the untracked flag when none are", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(
      multiFileMenuItems(sel({ paths: ["a.txt", "b.txt"], unstagedPaths: ["a.txt", "b.txt"] })),
      /^Stash 2 files/,
    ).onClick?.();

    await screen.findByTestId("dialog-input");
    await acceptDialog("part of it");

    await waitFor(() => expect(calls("stash_save_paths").length).toBe(1));
    expect(calls("stash_save_paths")[0].args).toMatchObject({
      paths: ["a.txt", "b.txt"],
      opts: { message: "part of it", includeUntracked: false, keepIndex: false },
    });
  });

  it("derives the untracked flag from the selection, never from a choice", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(
      multiFileMenuItems(
        sel({
          paths: ["a.txt", "new.txt"],
          unstagedPaths: ["a.txt", "new.txt"],
          untrackedPaths: ["new.txt"],
        }),
      ),
      /^Stash 2 files/,
    ).onClick?.();

    await screen.findByTestId("dialog-input");
    await acceptDialog("with a new file");

    await waitFor(() => expect(calls("stash_save_paths").length).toBe(1));
    expect(calls("stash_save_paths")[0].args).toMatchObject({
      opts: { includeUntracked: true },
    });
  });

  // `git stash push -- <path>` takes the index side too, so a staged file comes
  // back UNSTAGED on pop. The prompt has to say so — a doc comment claiming it
  // while the string omits it is how the next reader inherits the surprise.
  it("warns that staged paths will be unstaged, and only when some are", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(
      multiFileMenuItems(
        sel({
          paths: ["a.txt", "s.txt"],
          unstagedPaths: ["a.txt"],
          stagedPaths: ["s.txt"],
        }),
      ),
      /^Stash 2 files/,
    ).onClick?.();
    await screen.findByTestId("dialog-input");
    expect(dialogBody()).toMatch(/1 staged file will be unstaged/);
    expect(dialogBody()).toMatch(/come back unstaged when you pop/);
    await dismissDialog();

    void labeled(multiFileMenuItems(sel()), /^Stash 1 file/).onClick?.();
    await screen.findByTestId("dialog-input");
    expect(dialogBody()).not.toMatch(/unstaged/);
    await dismissDialog();
  });

  it("keeps an empty message distinct from a dismissal", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(multiFileMenuItems(sel()), /^Stash 1 file/).onClick?.();
    await screen.findByTestId("dialog-input");
    await acceptDialog("");

    await waitFor(() => expect(calls("stash_save_paths").length).toBe(1));
    expect(calls("stash_save_paths")[0].args).toMatchObject({
      opts: { message: null },
    });
  });

  it("leaves embedded repos out of the pathspec", () => {
    const items = multiFileMenuItems(
      sel({
        paths: ["a.txt", "vendor/thing"],
        unstagedPaths: ["a.txt"],
        embeddedPaths: ["vendor/thing"],
      }),
    );
    // One stashable path, so the label counts one — not the two selected.
    labeled(items, /^Stash 1 file…$/);
  });

  // The repo browser's all-files view puts unmodified files in `paths`, and a
  // stash of only those is a click that does nothing at all.
  it("counts only the CHANGED paths, not everything selected", async () => {
    render(
      <WithDialogs>
        <div />
      </WithDialogs>,
    );
    void labeled(
      multiFileMenuItems(
        sel({
          paths: ["a.txt", "clean.txt", "staged.txt"],
          unstagedPaths: ["a.txt"],
          stagedPaths: ["staged.txt"],
        }),
      ),
      /^Stash 2 files/,
    ).onClick?.();

    await screen.findByTestId("dialog-input");
    await acceptDialog("changed only");

    await waitFor(() => expect(calls("stash_save_paths").length).toBe(1));
    expect(calls("stash_save_paths")[0].args.paths).toEqual(["staged.txt", "a.txt"]);
  });

  it("offers no stash entry when nothing in the selection has changed", () => {
    const items = multiFileMenuItems(
      sel({ paths: ["clean.txt"], unstagedPaths: [], stagedPaths: [] }),
    );
    expect(
      items.find((i) => typeof i.label === "string" && /^Stash/.test(i.label)),
    ).toBeUndefined();
  });

  it("offers no stash entry when the selection is embedded repos only", () => {
    const items = multiFileMenuItems(
      sel({ paths: ["vendor/thing"], unstagedPaths: [], embeddedPaths: ["vendor/thing"] }),
    );
    expect(
      items.find((i) => typeof i.label === "string" && /^Stash/.test(i.label)),
    ).toBeUndefined();
  });
});
