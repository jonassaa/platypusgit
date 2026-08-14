import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGHunk } from "./git-components";
import type { DiffLineData } from "./git-components";

const line = (
  o: Partial<DiffLineData> & { kind: DiffLineData["kind"] },
): DiffLineData => ({ text: "", ...o });

describe("syntax spans in diff rows", () => {
  it("wraps scoped ranges in a classed span", () => {
    render(
      <PGHunk
        header="-1 +1"
        lines={[
          line({
            kind: "ctx",
            text: "let x",
            lnL: 1,
            lnR: 1,
            syntax: [{ start: 0, end: 3, cls: "syn-keyword" }],
          }),
        ]}
      />,
    );
    const kw = document.querySelector(".syn-keyword");
    expect(kw).not.toBeNull();
    expect(kw).toHaveTextContent("let");
  });

  it("still renders the full line text when syntax is absent", () => {
    render(
      <PGHunk header="-1 +1" lines={[line({ kind: "ctx", text: "plain text", lnL: 1 })]} />,
    );
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });

  it("combines a syntax class and a word-change mark on one range", () => {
    // A changed range inside a scoped range must carry both.
    render(
      <PGHunk
        header="-1 +1"
        lines={[
          line({ kind: "rem", text: "let a", lnL: 1 }),
          line({ kind: "add", text: "let b", lnR: 1 }),
        ]}
        syntax={{
          old: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
          new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
        }}
      />,
    );
    expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("word-change").length).toBeGreaterThan(0);
  });

  it("maps rem rows to the old side and add/ctx rows to the new side", () => {
    // Old side scopes the whole line as a comment, new side as a keyword. The
    // classes that land prove which array each row read.
    render(
      <PGHunk
        header="-1 +1"
        lines={[
          line({ kind: "rem", text: "aaa", lnL: 1 }),
          line({ kind: "add", text: "bbb", lnR: 1 }),
        ]}
        syntax={{
          old: [[{ start: 0, end: 3, cls: "syn-comment" }]],
          new: [[{ start: 0, end: 3, cls: "syn-keyword" }]],
        }}
      />,
    );
    expect(document.querySelector(".syn-comment")).toHaveTextContent("aaa");
    expect(document.querySelector(".syn-keyword")).toHaveTextContent("bbb");
  });
});
