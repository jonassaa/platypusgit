// The styled confirm/prompt primitive (#61 C3). The contract these pin is that
// pgConfirm/pgPrompt behave like window.confirm/window.prompt at the call site,
// so ~50 conversions could be mechanical.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PGDialogHost, pgConfirm, pgPrompt, __resetDialogs } from "./dialog";

beforeEach(() => __resetDialogs());
afterEach(() => __resetDialogs());

const clickConfirm = () =>
  act(async () => {
    fireEvent.click(screen.getByTestId("dialog-confirm"));
  });
const clickCancel = () =>
  act(async () => {
    fireEvent.click(screen.getByTestId("dialog-cancel"));
  });

describe("pgConfirm", () => {
  it("resolves true on confirm and false on cancel", async () => {
    render(<PGDialogHost />);

    const yes = pgConfirm("Delete it?");
    await screen.findByTestId("dialog-confirm");
    await clickConfirm();
    expect(await yes).toBe(true);

    const no = pgConfirm("Delete it?");
    await screen.findByTestId("dialog-cancel");
    await clickCancel();
    expect(await no).toBe(false);
  });

  it("resolves false on Escape and on a backdrop click", async () => {
    render(<PGDialogHost />);

    const esc = pgConfirm("Delete it?");
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(await esc).toBe(false);

    const backdrop = pgConfirm("Delete it?");
    const dialog2 = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.mouseDown(dialog2);
    });
    expect(await backdrop).toBe(false);
  });

  it("resolves false rather than hanging when no host is mounted", async () => {
    // A caller awaiting a dialog nobody can see would deadlock its handler;
    // refusing is also the safe answer for a destructive op.
    expect(await pgConfirm("Delete it?")).toBe(false);
    expect(await pgPrompt("Name?")).toBeNull();
  });

  it("gates the primary button behind requireText", async () => {
    render(<PGDialogHost />);
    const p = pgConfirm({
      title: "Delete branch?",
      requireText: "main",
      danger: true,
    });
    await screen.findByTestId("dialog-confirm");
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("dialog-input"), {
      target: { value: "mai" },
    });
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("dialog-input"), {
      target: { value: "main" },
    });
    expect(screen.getByTestId("dialog-confirm")).toBeEnabled();
    await clickConfirm();
    expect(await p).toBe(true);
  });
});

describe("pgPrompt", () => {
  it("resolves the typed value, and null when dismissed", async () => {
    render(<PGDialogHost />);

    const value = pgPrompt({ title: "Branch name" });
    await screen.findByTestId("dialog-input");
    fireEvent.change(screen.getByTestId("dialog-input"), {
      target: { value: "feat/x" },
    });
    await clickConfirm();
    expect(await value).toBe("feat/x");

    const cancelled = pgPrompt({ title: "Branch name" });
    await screen.findByTestId("dialog-input");
    await clickCancel();
    expect(await cancelled).toBeNull();
  });

  it("keeps empty string distinct from null", async () => {
    // window.prompt's contract, and real callers depend on it: an empty stash
    // message means "no message", a dismissal means "don't stash".
    render(<PGDialogHost />);
    const p = pgPrompt({ title: "Stash message (optional)" });
    await screen.findByTestId("dialog-input");
    await clickConfirm();
    expect(await p).toBe("");
  });

  it("prefills initialValue and blocks empty input when requireValue", async () => {
    render(<PGDialogHost />);
    const p = pgPrompt({
      title: "Rename",
      initialValue: "old-name",
      requireValue: true,
    });
    await screen.findByTestId("dialog-input");
    expect(screen.getByTestId<HTMLInputElement>("dialog-input").value).toBe(
      "old-name",
    );

    fireEvent.change(screen.getByTestId("dialog-input"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("dialog-input"), {
      target: { value: "new-name" },
    });
    await clickConfirm();
    expect(await p).toBe("new-name");
  });

  it("submits on Enter", async () => {
    render(<PGDialogHost />);
    const p = pgPrompt({ title: "Branch name" });
    const input = await screen.findByTestId("dialog-input");
    fireEvent.change(input, { target: { value: "feat/enter" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(await p).toBe("feat/enter");
  });
});

describe("queueing", () => {
  it("shows one dialog at a time and settles them in order", async () => {
    // Stacked modals cannot be dismissed predictably — the second request
    // waits rather than covering the first.
    render(<PGDialogHost />);
    const first = pgConfirm({ title: "First?" });
    const second = pgConfirm({ title: "Second?" });

    await waitFor(() =>
      expect(screen.getByTestId("dialog-title").textContent).toBe("First?"),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await clickConfirm();
    expect(await first).toBe(true);

    await waitFor(() =>
      expect(screen.getByTestId("dialog-title").textContent).toBe("Second?"),
    );
    await clickCancel();
    expect(await second).toBe(false);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
