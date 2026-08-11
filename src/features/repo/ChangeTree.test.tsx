import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeTree } from "./ChangeTree";
import { buildStatusTree } from "@/lib/tree";
import type { FileStatus } from "@/lib/types";

function mod(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 1,
    deletions: 0,
    embedded: false,
  };
}

const files = [mod("src/a.ts"), mod("src/nested/b.ts")].map((s) => ({
  path: s.path,
  status: s,
}));
const nodes = buildStatusTree(files.map((f) => f.status));

function base() {
  return {
    files,
    nodes,
    expanded: { "/src": true, "/src/nested": true },
    onToggleExpand: vi.fn(),
    selectedKeys: new Set<string>(),
    onSelect: vi.fn(),
    keyOf: (k: string) => k,
    checkboxes: "none" as const,
  };
}

describe("ChangeTree", () => {
  it("renders nested rows in tree mode", () => {
    render(<ChangeTree {...base()} viewMode="tree" />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    // Path compaction merges src/nested into one row when it is a single-child
    // chain; with a sibling file under src, "nested" stays its own row.
    expect(screen.getByText("nested")).toBeInTheDocument();
  });

  it("renders full paths and no folder rows in flat mode", () => {
    const { container } = render(<ChangeTree {...base()} viewMode="flat" />);
    expect(container.querySelector("[data-path='src']")).toBeNull();
    expect(container.querySelector("[data-path='src/nested/b.ts']")).not.toBeNull();
    // PGChangeRow splits path into basename + dirname (no trailing slash).
    expect(screen.getByText("src/nested")).toBeInTheDocument();
  });

  it("shows the same file count in both modes", () => {
    const { container: treeC } = render(<ChangeTree {...base()} viewMode="tree" />);
    const { container: flatC } = render(<ChangeTree {...base()} viewMode="flat" />);
    expect(treeC.querySelectorAll("[data-pg-row][data-path$='.ts']")).toHaveLength(2);
    expect(flatC.querySelectorAll("[data-pg-row]")).toHaveLength(2);
  });

  it("emits the screen's key form through keyOf", () => {
    const onSelect = vi.fn();
    render(
      <ChangeTree
        {...base()}
        viewMode="tree"
        onSelect={onSelect}
        keyOf={(k) => `staged:${k.replace(/^\//, "")}`}
      />,
    );
    fireEvent.click(screen.getByText("a.ts"));
    expect(onSelect).toHaveBeenCalledWith("staged:src/a.ts", expect.anything());
  });

  it("renders no checkboxes when checkboxes is 'none'", () => {
    const { container } = render(<ChangeTree {...base()} viewMode="tree" />);
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(0);
  });

  it("renders checkboxes for changed rows when 'changed-only'", () => {
    const { container } = render(
      <ChangeTree
        {...base()}
        viewMode="tree"
        checkboxes="changed-only"
        onCheck={vi.fn()}
      />,
    );
    expect(
      container.querySelectorAll("[data-testid='row-toggle']").length,
    ).toBeGreaterThan(0);
  });

  it("reports the checked key through keyOf", () => {
    const onCheck = vi.fn();
    const { container } = render(
      <ChangeTree
        {...base()}
        viewMode="tree"
        checkboxes="changed-only"
        onCheck={onCheck}
        keyOf={(k) => `u:${k.replace(/^\//, "")}`}
      />,
    );
    const box = container.querySelector("[data-testid='row-toggle'] input")!;
    fireEvent.click(box);
    expect(onCheck).toHaveBeenCalledWith(expect.stringMatching(/^u:/));
  });

  it("applies file-type icons in flat mode too", () => {
    const { container } = render(<ChangeTree {...base()} viewMode="flat" />);
    expect(container.querySelector("[data-icon='fileCode']")).not.toBeNull();
  });

  it("renders no status mark for an unmodified file in flat mode", () => {
    const unmodified: FileStatus = {
      path: "docs/readme.md",
      worktree: { kind: "Unmodified" },
      index: { kind: "Unmodified" },
      additions: 0,
      deletions: 0,
      embedded: false,
    };
    const { container } = render(
      <ChangeTree
        {...base()}
        files={[{ path: unmodified.path, status: unmodified }]}
        viewMode="flat"
      />,
    );
    expect(container.querySelector("[data-pg-status]")).toBeNull();
  });
});
