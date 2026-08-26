import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CloneDialog } from "./CloneDialog";
import { useCreateStore } from "./useCreateStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { mockInvoke } from "@/test/invokeMock";
import { emitMockEvent } from "@/test/eventMock";

describe("CloneDialog", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useCreateStore.setState({
      open: "clone",
      busy: false,
      progress: null,
      error: null,
    });
    mockInvoke("clone_repo", () => "/tmp/dest/repo");
    mockInvoke("open_repo", () => ({
      id: "r1",
      path: "/tmp/dest/repo",
      head: "refs/heads/main",
    }));
  });

  it("derives the folder name from the URL as you type", async () => {
    render(<CloneDialog />);

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("clone-name")).toHaveValue("my-repo"),
    );
  });

  it("keeps a name the user edited instead of overwriting it", async () => {
    render(<CloneDialog />);
    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/other.git" },
    });

    expect(screen.getByTestId("clone-name")).toHaveValue("custom");
  });

  it("shows the resolved destination path", () => {
    render(<CloneDialog />);
    fireEvent.change(screen.getByTestId("clone-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "repo" },
    });

    expect(screen.getByTestId("clone-resolved")).toHaveTextContent(
      "/tmp/dest/repo",
    );
  });

  it("disables Clone until URL, parent and name are all present", () => {
    render(<CloneDialog />);
    const button = screen.getByTestId("clone-submit");
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-parent"), {
      target: { value: "/tmp/dest" },
    });

    expect(button).not.toBeDisabled();
  });

  // #234 — the Cancel button used to be disabled for exactly as long as the
  // clone ran, which is the only time a user needs it. A clone against a stalled
  // host was then escapable only by force-quitting the app.
  it("offers a live Cancel while the clone runs, and cancels the clone with it", async () => {
    let cancelled = 0;
    mockInvoke("cancel_network_op", () => {
      cancelled += 1;
      return 1;
    });
    useCreateStore.setState({ open: "clone", busy: true, progress: null });
    render(<CloneDialog />);

    const cancel = screen.getByTestId("clone-cancel");
    expect(cancel).not.toBeDisabled();
    // The label carries the difference between the two jobs this button does.
    expect(cancel).toHaveTextContent("Cancel clone");

    fireEvent.click(cancel);

    await waitFor(() => expect(cancelled).toBe(1));
    // And it does NOT close the dialog out from under the clone being reaped.
    expect(useCreateStore.getState().open).toBe("clone");
  });

  it("closes the dialog with the same button when no clone is running", () => {
    render(<CloneDialog />);

    const cancel = screen.getByTestId("clone-cancel");
    expect(cancel).toHaveTextContent("Cancel");
    fireEvent.click(cancel);

    expect(useCreateStore.getState().open).toBe("none");
  });

  it("renders progress delivered by the clone://progress subscription", async () => {
    useCreateStore.setState({
      open: "clone",
      busy: true,
      progress: null,
    });
    render(<CloneDialog />);

    // Drive this through a real emitted event rather than seeding
    // useCreateStore.progress directly — that would pass unchanged even if
    // the listen() effect were deleted, misnamed, or never wired to
    // setProgress.
    emitMockEvent("clone://progress", {
      phase: "Receiving objects",
      percent: 62,
    });

    await waitFor(() =>
      expect(screen.getByTestId("clone-progress")).toHaveTextContent(
        "Receiving objects",
      ),
    );
    expect(screen.getByTestId("clone-progress")).toHaveTextContent("62%");
  });

  it("renders a failure inside the dialog and keeps the form populated", () => {
    render(<CloneDialog />);

    // Type real values first — the only way to prove they *survive* the
    // error, rather than merely that the dialog didn't unmount.
    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "my-repo" },
    });

    act(() => {
      useCreateStore.setState({
        open: "clone",
        busy: false,
        error: "fatal: repository not found",
      });
    });

    expect(screen.getByTestId("clone-error")).toHaveTextContent(
      "repository not found",
    );
    // Still open, and the form the user typed is still there to fix + retry.
    expect(screen.getByTestId("clone-url")).toHaveValue(
      "https://github.com/org/my-repo.git",
    );
    expect(screen.getByTestId("clone-name")).toHaveValue("my-repo");
  });

  it("renders nothing when another dialog is open", () => {
    useCreateStore.setState({ open: "init" });
    const { container } = render(<CloneDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("resets its form on a closed→open transition of a single mounted instance", async () => {
    // AppShell mounts CloneDialog permanently; closing it is a `return
    // null`, not an unmount, so useState here survives across opens unless
    // the component resets it itself. Rendering once and toggling the
    // store's `open` field (rather than mounting a fresh component per
    // `it()`) is the only way this bug shows up at all.
    render(<CloneDialog />);

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "custom-name" },
    });
    expect(screen.getByTestId("clone-name")).toHaveValue("custom-name");

    // Two separate commits, matching real usage: closing and reopening are
    // always distinct user actions (distinct event-handler invocations), so
    // React never batches them into one render that skips the "none" state.
    act(() => {
      useCreateStore.setState({ open: "none" });
    });
    act(() => {
      useCreateStore.setState({ open: "clone" });
    });

    expect(screen.getByTestId("clone-url")).toHaveValue("");
    expect(screen.getByTestId("clone-name")).toHaveValue("");

    // The nameEdited latch must reset too: URL→name derivation must work
    // again for the next clone in this session, not stay silently dead
    // because a previous clone's name was hand-edited.
    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/other-repo.git" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("clone-name")).toHaveValue("other-repo"),
    );
  });

  it("re-seeds the parent dir from settings on reopen instead of keeping an edited value", () => {
    useSettingsStore.getState().set("lastCreateDir", "/tmp/dest");
    render(<CloneDialog />);
    expect(screen.getByTestId("clone-parent")).toHaveValue("/tmp/dest");

    fireEvent.change(screen.getByTestId("clone-parent"), {
      target: { value: "/tmp/somewhere-else" },
    });
    expect(screen.getByTestId("clone-parent")).toHaveValue(
      "/tmp/somewhere-else",
    );

    // Two separate commits, matching real usage: closing and reopening are
    // always distinct user actions (distinct event-handler invocations), so
    // React never batches them into one render that skips the "none" state.
    act(() => {
      useCreateStore.setState({ open: "none" });
    });
    act(() => {
      useCreateStore.setState({ open: "clone" });
    });

    // Not cleared, and not stuck on the edited value either: parentDir is
    // re-read from settings, since persisting lastCreateDir exists so the
    // next clone starts where the last one left off.
    expect(screen.getByTestId("clone-parent")).toHaveValue("/tmp/dest");
  });
});
