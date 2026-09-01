// The commit body's rendered/raw toggle (#253).
//
// The raw view is the constraint that makes the rendered one safe to ship: a
// commit message is a git object, and there has to be a way to see it
// byte-for-byte. So the assertions here are mostly about the raw side being
// genuinely raw, and about nothing in the rendered side reaching the network.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, resetInvokeMock, mockInvoke } from "@/test/invokeMock";

import { CommitBody } from "./CommitBody";

const BODY = [
  "Rework the thing so it *reads* better.",
  "",
  "- one bullet",
  "- another with `code`",
  "",
  "```sh",
  "git rebase -i main",
  "```",
  "",
  "See https://example.com/docs for more. Fixes #123.",
  "",
  "Co-Authored-By: Ada <ada@example.com>",
].join("\n");

beforeEach(() => {
  resetInvokeMock();
  mockInvoke("open_url", () => null);
  useSettingsStore.getState().reset();
});

describe("the toggle", () => {
  it("renders markdown by default", () => {
    render(<CommitBody text={BODY} />);
    expect(screen.getByTestId("commit-body-rendered")).toBeTruthy();
    expect(screen.queryByTestId("commit-body-raw")).toBeNull();
  });

  it("switches to the raw message and back", () => {
    render(<CommitBody text={BODY} />);
    fireEvent.click(screen.getByTestId("commit-body-toggle"));
    expect(screen.getByTestId("commit-body-raw")).toBeTruthy();
    expect(screen.queryByTestId("commit-body-rendered")).toBeNull();

    fireEvent.click(screen.getByTestId("commit-body-toggle"));
    expect(screen.getByTestId("commit-body-rendered")).toBeTruthy();
  });

  it("shows the message byte for byte in raw mode", () => {
    // Not a re-serialisation of the parse — the original text. If this ever
    // became "render the AST back to markdown", the one guarantee the raw view
    // exists to give would be gone.
    render(<CommitBody text={BODY} />);
    fireEvent.click(screen.getByTestId("commit-body-toggle"));
    expect(screen.getByTestId("commit-body-raw").textContent).toBe(BODY);
  });

  it("remembers the choice as a preference", () => {
    render(<CommitBody text={BODY} />);
    fireEvent.click(screen.getByTestId("commit-body-toggle"));
    expect(useSettingsStore.getState().commitBodyMarkdown).toBe(false);
  });
});

describe("what the rendered view contains", () => {
  it("renders the structure rather than the syntax", () => {
    render(<CommitBody text={BODY} />);
    const el = screen.getByTestId("commit-body-rendered");
    expect(el.querySelectorAll("li")).toHaveLength(2);
    expect(el.querySelector("em")?.textContent).toBe("reads");
    expect(screen.getByTestId("commit-body-code").textContent).toBe(
      "git rebase -i main",
    );
    expect(screen.getByTestId("commit-body-trailers").textContent).toContain(
      "Co-Authored-By",
    );
  });

  it("shows an issue reference as a token, not a link", () => {
    // Linking it means guessing which forge and which repository the number
    // belongs to, and a link to the wrong issue is worse than no link.
    render(<CommitBody text={BODY} />);
    expect(screen.getByTestId("commit-body-issue").textContent).toBe("#123");
    const links = screen.getAllByTestId("commit-body-link");
    expect(links.every((a) => a.textContent !== "#123")).toBe(true);
  });

  it("never emits an img, and never fetches", () => {
    // The hard constraint: no remote content of any kind.
    render(<CommitBody text={"![pic](https://example.com/x.png)"} />);
    const el = screen.getByTestId("commit-body-rendered");
    expect(el.querySelectorAll("img")).toHaveLength(0);
    expect(el.querySelectorAll("script,iframe,object,embed,link")).toHaveLength(0);
    // It survives as a link, which opens only on a click, through the opener.
    expect(screen.getByTestId("commit-body-link").textContent).toBe("pic");
  });

  it("opens a link through the opener instead of navigating the webview", () => {
    // A plain navigation in a webview replaces the APP.
    render(<CommitBody text={"see https://example.com/docs"} />);
    fireEvent.click(screen.getByTestId("commit-body-link"));
    const calls = getInvokeCalls().filter((c) => c.cmd === "open_url");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.url).toBe("https://example.com/docs");
  });

  it("does not turn a javascript: link into anything clickable", () => {
    render(<CommitBody text={"[x](javascript:alert)"} />);
    expect(screen.queryByTestId("commit-body-link")).toBeNull();
    expect(screen.getByTestId("commit-body-rendered").textContent).toContain("x");
  });
});
