import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// vi.hoisted, because vi.mock's factory is hoisted above the module body: a
// plain `const` above would still be uninitialised when the factory returns it.
const { tokenizeFile } = vi.hoisted(() => ({ tokenizeFile: vi.fn() }));
vi.mock("./tokenize", () => ({ tokenizeFile }));

import { useSyntax } from "./useSyntax";

function Probe({ path, text }: { path: string | null; text: string | null }) {
  const syntax = useSyntax(path, text);
  return <div data-testid="out">{syntax ? `lines:${syntax.length}` : "none"}</div>;
}

describe("useSyntax", () => {
  it("renders plain first, then upgrades when tokens resolve", async () => {
    let resolve: (v: unknown) => void = () => {};
    tokenizeFile.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Probe path="a.ts" text="let" />);
    expect(screen.getByTestId("out")).toHaveTextContent("none");
    resolve([[], []]);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:2"));
  });

  it("does not call the tokenizer without a path or text", () => {
    tokenizeFile.mockReset();
    render(<Probe path={null} text="let" />);
    render(<Probe path="a.ts" text={null} />);
    expect(tokenizeFile).not.toHaveBeenCalled();
  });

  it("ignores a stale resolution after the input changed", async () => {
    tokenizeFile.mockReset();
    let resolveFirst: (v: unknown) => void = () => {};
    tokenizeFile.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    tokenizeFile.mockResolvedValueOnce([[], [], []]);
    const { rerender } = render(<Probe path="a.ts" text="one" />);
    rerender(<Probe path="a.ts" text="two" />);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:3"));
    resolveFirst([[]]); // first request finishes late
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("lines:3"));
  });
});
