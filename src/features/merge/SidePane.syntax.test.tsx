import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { SidePane } from "./SidePane";

function renderPane(props: Partial<React.ComponentProps<typeof SidePane>> = {}) {
  const ref = React.createRef<HTMLDivElement>();
  return render(
    <SidePane
      side="ours"
      lines={["let a", "let b"]}
      conflicts={[]}
      regionStates={[]}
      currentConflict={null}
      onAccept={() => {}}
      scrollRef={ref}
      onScroll={() => {}}
      {...props}
    />,
  );
}

describe("SidePane syntax", () => {
  it("wraps scoped ranges in classed spans, indexed by line", () => {
    renderPane({
      syntax: [
        [{ start: 0, end: 3, cls: "syn-keyword" }],
        [{ start: 0, end: 3, cls: "syn-comment" }],
      ],
    });
    expect(document.querySelector(".syn-keyword")).toHaveTextContent("let");
    expect(document.querySelector(".syn-comment")).toHaveTextContent("let");
  });

  it("renders plain text when there are no tokens", () => {
    const { container } = renderPane({ lines: ["plain"] });
    expect(container.textContent).toContain("plain");
    expect(document.querySelectorAll(".syn-keyword")).toHaveLength(0);
  });

  it("keeps the placeholder for a blank line, so row heights stay uniform", () => {
    // Uniform row height is what lets the middle pane sync scroll by line index.
    const { container } = renderPane({ lines: [""], syntax: [[]] });
    const rows = container.querySelectorAll("[data-line]");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).not.toBe("");
  });

  it("ignores tokens past the end of the line list", () => {
    renderPane({ lines: ["only"], syntax: [[], [{ start: 0, end: 2, cls: "syn-keyword" }]] });
    expect(document.querySelectorAll(".syn-keyword")).toHaveLength(0);
  });
});
