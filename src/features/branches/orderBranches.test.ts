// The one branch ordering (#135): default first, then newest tip first, then
// name. Pure, so it is tested here rather than through any of the three
// surfaces that call it.

import { describe, it, expect } from "vitest";
import {
  compareBranches,
  orderBranches,
  orderBranchesGrouped,
} from "./orderBranches";
import type { BranchInfo } from "@/lib/types";

const b = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "0".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...over,
});

const names = (rows: readonly BranchInfo[]) => rows.map((r) => r.name);

describe("orderBranches", () => {
  it("pins the default branch first, however old its tip", () => {
    const rows = orderBranches([
      b({ name: "feature/new", tipTime: 5000 }),
      b({ name: "main", tipTime: 1, isDefault: true }),
      b({ name: "chore/old", tipTime: 3000 }),
    ]);

    expect(names(rows)).toEqual(["main", "feature/new", "chore/old"]);
  });

  it("orders the rest by tip time, newest first", () => {
    const rows = orderBranches([
      b({ name: "stale", tipTime: 100 }),
      b({ name: "fresh", tipTime: 900 }),
      b({ name: "middling", tipTime: 500 }),
    ]);

    expect(names(rows)).toEqual(["fresh", "middling", "stale"]);
  });

  it("breaks ties on name so equal tips order the same way every run", () => {
    // `git branch x` off one commit gives every branch the SAME tip time, which
    // is the common case in a fresh repo — without a tiebreaker the order would
    // be whatever the input happened to be.
    const rows = orderBranches([
      b({ name: "zeta", tipTime: 42 }),
      b({ name: "alpha", tipTime: 42 }),
      b({ name: "mid", tipTime: 42 }),
    ]);

    expect(names(rows)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("is a pure recency sort when no row is the default", () => {
    const rows = orderBranches([
      b({ name: "a", tipTime: 1 }),
      b({ name: "b", tipTime: 2 }),
    ]);

    expect(names(rows)).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [b({ name: "b", tipTime: 1 }), b({ name: "a", tipTime: 2 })];
    const before = names(input);

    orderBranches(input);

    expect(names(input)).toEqual(before);
  });

  // The pin must never resurrect a row search filtered out: every call site
  // filters FIRST and orders SECOND, and ordering only permutes.
  it("returns exactly the rows it was given — never adds the default back", () => {
    const filtered = [
      b({ name: "feature/one", tipTime: 10 }),
      b({ name: "feature/two", tipTime: 20 }),
    ];

    const rows = orderBranches(filtered);

    expect(rows).toHaveLength(2);
    expect(names(rows).sort()).toEqual(["feature/one", "feature/two"]);
  });

  it("keeps extra row fields intact", () => {
    type Row = BranchInfo & { kind: "local" | "remote" };
    const rows: Row[] = orderBranches<Row>([
      { ...b({ name: "b", tipTime: 1 }), kind: "local" },
      { ...b({ name: "a", tipTime: 2 }), kind: "remote" },
    ]);

    expect(rows.map((r) => r.kind)).toEqual(["remote", "local"]);
  });
});

describe("orderBranchesGrouped", () => {
  it("keeps every local ahead of every remote, ordered within each group", () => {
    const rows = orderBranchesGrouped([
      b({ name: "origin/zzz", tipTime: 950, isRemote: true }),
      b({ name: "zzz-local", tipTime: 900 }),
      b({ name: "origin/main", tipTime: 100, isRemote: true, isDefault: true }),
      b({ name: "main", tipTime: 100, isDefault: true }),
    ]);

    // Without the grouping both defaults would take rows 1-2 and the freshest
    // remote would outrank every stale local.
    expect(names(rows)).toEqual([
      "main",
      "zzz-local",
      "origin/main",
      "origin/zzz",
    ]);
  });

  it("is still only a permutation", () => {
    const input = [
      b({ name: "a", tipTime: 1 }),
      b({ name: "origin/b", tipTime: 2, isRemote: true }),
    ];

    expect(names(orderBranchesGrouped(input)).sort()).toEqual(["a", "origin/b"]);
    expect(names(input)).toEqual(["a", "origin/b"]);
  });
});

describe("compareBranches", () => {
  it("reports equality for two rows that differ in nothing it reads", () => {
    expect(compareBranches(b({ name: "x" }), b({ name: "x" }))).toBe(0);
  });

  it("ignores isHead — the current branch is badged, not pinned", () => {
    const head = b({ name: "wip", tipTime: 1, isHead: true });
    const other = b({ name: "other", tipTime: 2 });

    expect(compareBranches(head, other)).toBeGreaterThan(0);
  });
});

describe("user pins (#238)", () => {
  const pins = (...names: string[]) => new Set(names);

  it("lifts a pinned branch above the recency block", () => {
    const rows = orderBranches(
      [
        b({ name: "fresh", tipTime: 9000 }),
        b({ name: "feat/foo", tipTime: 1 }),
        b({ name: "stale", tipTime: 2 }),
      ],
      pins("feat/foo"),
    );
    expect(names(rows)).toEqual(["feat/foo", "fresh", "stale"]);
  });

  it("lifts a pin above the default branch", () => {
    // #135's pin is a DEFAULT — the app guessing. A user pin is an instruction,
    // and an instruction that loses to a guess is not a pin. It also has to
    // rank first for the comparator and the Branches screen (which hoists pins
    // out of the folder tree, above it) to agree about one list.
    const rows = orderBranches(
      [
        b({ name: "feat/foo", tipTime: 1 }),
        b({ name: "main", tipTime: 0, isDefault: true }),
        b({ name: "fresh", tipTime: 9000 }),
      ],
      pins("feat/foo"),
    );
    expect(names(rows)).toEqual(["feat/foo", "main", "fresh"]);
  });

  it("keeps the default branch above everything unpinned", () => {
    const rows = orderBranches(
      [
        b({ name: "feat/foo", tipTime: 1 }),
        b({ name: "main", tipTime: 0, isDefault: true }),
        b({ name: "fresh", tipTime: 9000 }),
      ],
      pins("feat/foo"),
    );
    expect(names(rows).slice(1)).toEqual(["main", "fresh"]);
  });

  it("pinning the default branch changes nothing", () => {
    const rows = orderBranches(
      [b({ name: "fresh", tipTime: 9000 }), b({ name: "main", isDefault: true })],
      pins("main"),
    );
    expect(names(rows)).toEqual(["main", "fresh"]);
  });

  it("orders several pins among themselves by the ordinary rules", () => {
    const rows = orderBranches(
      [
        b({ name: "a", tipTime: 1 }),
        b({ name: "b", tipTime: 500 }),
        b({ name: "loose", tipTime: 9000 }),
      ],
      pins("a", "b"),
    );
    // Newest pin first — pinning is a tier, not a hand-ordered list.
    expect(names(rows)).toEqual(["b", "a", "loose"]);
  });

  it("matches a pin by exact name, so a remote copy is not pinned with it", () => {
    const rows = orderBranches(
      [
        b({ name: "origin/feat/foo", isRemote: true, tipTime: 1 }),
        b({ name: "origin/zzz", isRemote: true, tipTime: 9000 }),
      ],
      pins("feat/foo"),
    );
    expect(names(rows)).toEqual(["origin/zzz", "origin/feat/foo"]);
  });

  it("is still only a permutation — a pin cannot resurrect a filtered-out row", () => {
    const input = [b({ name: "x", tipTime: 3 }), b({ name: "y", tipTime: 4 })];
    const rows = orderBranches(input, pins("gone"));
    expect(names(rows).sort()).toEqual(["x", "y"]);
    expect(rows).toHaveLength(2);
  });

  it("with no pins orders exactly as it did before", () => {
    const input = [
      b({ name: "old", tipTime: 1 }),
      b({ name: "new", tipTime: 9 }),
    ];
    expect(names(orderBranches(input, pins()))).toEqual(names(orderBranches(input)));
  });

  it("carries pins through the grouped ordering", () => {
    const rows = orderBranchesGrouped(
      [
        b({ name: "origin/pinned", isRemote: true, tipTime: 1 }),
        b({ name: "origin/fresh", isRemote: true, tipTime: 9000 }),
        b({ name: "local", tipTime: 5 }),
      ],
      pins("origin/pinned"),
    );
    expect(names(rows)).toEqual(["local", "origin/pinned", "origin/fresh"]);
  });

  it("compareBranches reads the pin set it is given", () => {
    const a = b({ name: "a", tipTime: 1 });
    const z = b({ name: "z", tipTime: 9000 });
    expect(compareBranches(a, z, pins("a"))).toBeLessThan(0);
    expect(compareBranches(a, z)).toBeGreaterThan(0);
  });
});
