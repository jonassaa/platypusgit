// The custom-action list and how results are reported (#225).
//
// The parsing and substitution — the security-critical half — live in Rust and
// are tested in `src-tauri/tests/custom_action.rs`. Deliberately not duplicated
// here: a second parser would be a second place for "what actually runs" to
// drift from the one next to the spawn.

import { describe, expect, it } from "vitest";

import {
  actionsFor,
  blankAction,
  commitContext,
  describeResult,
  fileContext,
  isSavableAction,
  newActionId,
  normalizeAction,
  removeAction,
  repoContext,
  shouldShowOutput,
  showsOn,
  upsertAction,
  type CustomAction,
} from "./customActions";

const action = (over: Partial<CustomAction> = {}): CustomAction => ({
  id: "a",
  name: "Open in editor",
  command: "code -g $FILE",
  showOutput: false,
  refreshAfter: true,
  surfaces: ["repo"],
  ...over,
});

describe("what is savable", () => {
  it("needs a name and a command", () => {
    expect(isSavableAction(action())).toBe(true);
    expect(isSavableAction(action({ name: "  " }))).toBe(false);
    expect(isSavableAction(action({ command: "" }))).toBe(false);
  });

  it("does not re-implement the backend's parser", () => {
    // Whether a command PARSES is the backend's question — it owns the parser
    // and its refusal names what is wrong ("unclosed quote"). A second check
    // here would be a second place to drift.
    expect(isSavableAction(action({ command: 'code "unclosed' }))).toBe(true);
  });

  it("trims what it stores", () => {
    expect(normalizeAction(action({ name: " x ", command: " y " }))).toMatchObject(
      { name: "x", command: "y" },
    );
  });
});

describe("editing the list", () => {
  it("adds, replaces in place, and removes", () => {
    const b = action({ id: "b", name: "Second" });
    expect(upsertAction([action()], b).map((a) => a.id)).toEqual(["a", "b"]);

    const renamed = action({ name: "Renamed" });
    const next = upsertAction([action(), b], renamed);
    expect(next.map((a) => a.id)).toEqual(["a", "b"]);
    expect(next[0]?.name).toBe("Renamed");

    expect(removeAction([action(), b], "a").map((a) => a.id)).toEqual(["b"]);
  });

  it("never mutates the input", () => {
    const list = [action()];
    upsertAction(list, action({ id: "b" }));
    removeAction(list, "a");
    expect(list).toHaveLength(1);
  });

  it("mints unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newActionId()));
    expect(ids.size).toBe(50);
  });

  it("a blank action is not savable but is a valid draft", () => {
    const b = blankAction();
    expect(isSavableAction(b)).toBe(false);
    expect(b.showOutput).toBe(true);
    expect(b.refreshAfter).toBe(true);
  });
});

describe("reporting the result", () => {
  it("always shows a failure, whatever the setting says", () => {
    // An action that exits non-zero and says nothing is indistinguishable from
    // one that never ran, and that is the state people file bugs about.
    expect(shouldShowOutput(action({ showOutput: false }), 1)).toBe(true);
    expect(shouldShowOutput(action({ showOutput: false }), null)).toBe(true);
  });

  it("respects the setting on success", () => {
    expect(shouldShowOutput(action({ showOutput: false }), 0)).toBe(false);
    expect(shouldShowOutput(action({ showOutput: true }), 0)).toBe(true);
  });

  it("names the exit code, because 'it failed' is not actionable", () => {
    expect(describeResult(action(), 0)).toBe("Open in editor finished.");
    expect(describeResult(action(), 2)).toBe("Open in editor exited with code 2.");
    expect(describeResult(action(), null)).toBe("Open in editor was terminated.");
  });
});

describe("the context sent for a repo-level invocation", () => {
  it("sends an EMPTY repo path — the backend fills it in", () => {
    // The security property: a custom action's working directory can never be
    // chosen by the caller. The backend resolves it from the repository.
    const ctx = repoContext("main");
    expect(ctx.repo).toBe("");
    expect(ctx.branch).toBe("main");
    expect(ctx.files).toEqual([]);
    expect(ctx.sha).toBeNull();
  });

  it("tolerates a detached HEAD", () => {
    expect(repoContext(null).branch).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WHERE AN ACTION SHOWS UP (#225, second half)
// ═════════════════════════════════════════════════════════════════════════════

describe("surfaces", () => {
  it("defaults a new action to the palette alone", () => {
    expect(blankAction().surfaces).toEqual(["repo"]);
  });

  it("treats an action with no surfaces field as a palette action", () => {
    // THE MIGRATION. Every action persisted before this feature existed has no
    // `surfaces` key, and it was a palette action — so that is what it stays.
    const legacy = { ...action(), surfaces: undefined } as unknown as CustomAction;
    expect(normalizeAction(legacy).surfaces).toEqual(["repo"]);
  });

  it("drops unknown surfaces and duplicates, in a canonical order", () => {
    const messy = {
      ...action(),
      surfaces: ["commit", "file", "commit", "branch"],
    } as unknown as CustomAction;
    expect(normalizeAction(messy).surfaces).toEqual(["file", "commit"]);
  });

  it("reads a surface off an action", () => {
    const a = action({ surfaces: ["file", "commit"] });
    expect(showsOn(a, "file")).toBe(true);
    expect(showsOn(a, "commit")).toBe(true);
    expect(showsOn(a, "repo")).toBe(false);
  });

  it("filters a list to one surface, in list order", () => {
    const list = [
      action({ id: "a", surfaces: ["repo"] }),
      action({ id: "b", surfaces: ["file"] }),
      action({ id: "c", surfaces: ["repo", "file"] }),
    ];
    expect(actionsFor(list, "file").map((a) => a.id)).toEqual(["b", "c"]);
    expect(actionsFor(list, "commit")).toEqual([]);
  });

  it("refuses to save an action that would show up nowhere", () => {
    // An action reachable from no surface is one that can never be run: it
    // exists in Settings and does nothing. Disabling Save says so where the
    // three empty toggles are, rather than silently putting one back.
    expect(isSavableAction(action({ surfaces: [] }))).toBe(false);
    expect(isSavableAction(action({ surfaces: ["commit"] }))).toBe(true);
  });
});

describe("the context sent for a file selection", () => {
  it("carries the selected paths and still leaves repo to the backend", () => {
    const ctx = fileContext("main", ["src/a.ts", "src/b.ts"]);
    expect(ctx.repo).toBe("");
    expect(ctx.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(ctx.branch).toBe("main");
    expect(ctx.sha).toBeNull();
  });

  it("drops blank paths rather than sending an empty $FILE", () => {
    expect(fileContext(null, ["", "  ", "a.ts"]).files).toEqual(["a.ts"]);
  });
});

describe("the context sent for a commit", () => {
  it("carries the sha and no files", () => {
    const ctx = commitContext("main", "abc1234");
    expect(ctx.sha).toBe("abc1234");
    expect(ctx.files).toEqual([]);
    expect(ctx.repo).toBe("");
    expect(ctx.branch).toBe("main");
  });

  it("sends null rather than an empty sha", () => {
    expect(commitContext(null, "").sha).toBeNull();
  });
});
