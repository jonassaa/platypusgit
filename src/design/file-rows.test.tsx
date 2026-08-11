import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PGFileTree, PGChangeRow, type PGFileTreeNode } from "./git-components";

const nodes: PGFileTreeNode[] = [
  {
    name: "src",
    staged: "some",
    defaultExpanded: true,
    children: [
      { name: "a.ts", status: "M", staged: "all", icon: "fileCode" },
      { name: "b.ts", status: "M", staged: "none", icon: "fileCode" },
      { name: "c.ts", staged: undefined },
    ],
  },
];

describe("PGFileTree checkboxes", () => {
  it("renders no checkbox at all when onCheck is omitted", () => {
    const { container } = render(
      <PGFileTree nodes={nodes} expanded={{ "/src": true }} />,
    );
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(0);
  });

  it("renders a checkbox only for nodes carrying a staged state", () => {
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
      />,
    );
    // src (some), a.ts (all), b.ts (none) — but not c.ts (undefined).
    expect(container.querySelectorAll("[data-testid='row-toggle']")).toHaveLength(3);
  });

  it("reserves the gutter for a row with no checkbox so names stay aligned", () => {
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-testid='row-toggle-slot']")).toHaveLength(4);
  });

  it("reports the node key when a checkbox is clicked", () => {
    const onCheck = vi.fn();
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={onCheck}
      />,
    );
    const boxes = container.querySelectorAll("[data-testid='row-toggle'] input");
    fireEvent.click(boxes[0]);
    expect(onCheck).toHaveBeenCalledWith(
      "/src",
      expect.objectContaining({ name: "src" }),
    );
  });

  it("does not select the row when the checkbox is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PGFileTree
        nodes={nodes}
        expanded={{ "/src": true }}
        checkboxSlot
        onCheck={() => {}}
        onSelect={onSelect}
      />,
    );
    const box = container.querySelector("[data-testid='row-toggle'] input")!;
    fireEvent.click(box);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the node's file-type glyph", () => {
    const { container } = render(
      <PGFileTree nodes={nodes} expanded={{ "/src": true }} />,
    );
    expect(container.querySelector("[data-icon='fileCode']")).not.toBeNull();
  });
});

describe("PGChangeRow", () => {
  it("renders no status mark when status is omitted", () => {
    const { container } = render(<PGChangeRow path="src/a.ts" />);
    expect(container.querySelector("[data-pg-status]")).toBeNull();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("renders the supplied file-type icon", () => {
    const { container } = render(
      <PGChangeRow
        path="src/a.ts"
        status="M"
        icon="fileCode"
        iconColor="var(--accent-2)"
      />,
    );
    expect(container.querySelector("[data-icon='fileCode']")).not.toBeNull();
  });
});
