// The three-way choice primitive (#356 follow-up).
//
// `pgConfirm` answers yes/no, and a refusal that offers two different remedies
// ("take the branch from that worktree" vs "go work in that worktree") is not a
// yes/no question. This pins the contract that makes it safe to reach for:
// dismissal is NEVER one of the answers, so a call site can only act on a
// choice the user actually made.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PGDialogHost, pgChoose, __resetDialogs } from "./dialog";

beforeEach(() => __resetDialogs());
afterEach(() => __resetDialogs());

const CHOICES = [
  { id: "open", label: "Open that one" },
  { id: "take", label: "Move it here", primary: true },
];

describe("pgChoose", () => {
  it("resolves the id of the choice that was clicked", async () => {
    render(<PGDialogHost />);

    const picked = pgChoose({ title: "Move it here?", choices: CHOICES });
    await screen.findByTestId("dialog-choice-take");
    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-choice-take"));
    });

    expect(await picked).toBe("take");
  });

  it("resolves the other choice's id, not just the primary one", async () => {
    render(<PGDialogHost />);

    const picked = pgChoose({ title: "Move it here?", choices: CHOICES });
    await screen.findByTestId("dialog-choice-open");
    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-choice-open"));
    });

    expect(await picked).toBe("open");
  });

  it("resolves null on Cancel, on Escape and on a backdrop click", async () => {
    render(<PGDialogHost />);

    const viaCancel = pgChoose({ title: "Move it here?", choices: CHOICES });
    await screen.findByTestId("dialog-cancel");
    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-cancel"));
    });
    expect(await viaCancel).toBeNull();

    const viaEscape = pgChoose({ title: "Move it here?", choices: CHOICES });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(await viaEscape).toBeNull();

    const viaBackdrop = pgChoose({ title: "Move it here?", choices: CHOICES });
    const backdrop = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.mouseDown(backdrop);
    });
    expect(await viaBackdrop).toBeNull();
  });

  it("renders the title, the body and every choice's label", async () => {
    render(<PGDialogHost />);

    void pgChoose({
      title: "Move it here?",
      body: "It is checked out in worktree 'api-fixes'.",
      choices: CHOICES,
    });

    expect(await screen.findByTestId("dialog-title")).toHaveTextContent(
      "Move it here?",
    );
    expect(screen.getByText(/worktree 'api-fixes'/)).toBeTruthy();
    expect(screen.getByTestId("dialog-choice-open")).toHaveTextContent(
      "Open that one",
    );
    expect(screen.getByTestId("dialog-choice-take")).toHaveTextContent(
      "Move it here",
    );
  });

  it("shows no text input — a choice is not a prompt", async () => {
    render(<PGDialogHost />);

    void pgChoose({ title: "Move it here?", choices: CHOICES });
    await screen.findByTestId("dialog-choice-take");

    expect(screen.queryByTestId("dialog-input")).toBeNull();
    expect(document.querySelector("[data-pg-dialog-kind]")).toHaveAttribute(
      "data-pg-dialog-kind",
      "choose",
    );
  });

  it("resolves null rather than hanging when no host is mounted", async () => {
    expect(await pgChoose({ title: "Move it here?", choices: CHOICES })).toBeNull();
  });
});
