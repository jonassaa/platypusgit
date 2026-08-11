import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { InitDialog } from "./InitDialog";
import { useCreateStore } from "./useCreateStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { mockInvoke } from "@/test/invokeMock";

describe("InitDialog", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useCreateStore.setState({
      open: "init",
      busy: false,
      progress: null,
      error: null,
    });
    mockInvoke("default_init_branch", () => "trunk");
    mockInvoke("init_repo", () => ({
      id: "r1",
      path: "/tmp/dest/fresh",
      head: "refs/heads/trunk",
    }));
    mockInvoke("open_repo", () => ({
      id: "r1",
      path: "/tmp/dest/fresh",
      head: "refs/heads/trunk",
    }));
  });

  it("prefills the branch from the user's init.defaultBranch", async () => {
    render(<InitDialog />);
    await waitFor(() =>
      expect(screen.getByTestId("init-branch")).toHaveValue("trunk"),
    );
  });

  it("shows the resolved destination path", () => {
    render(<InitDialog />);
    fireEvent.change(screen.getByTestId("init-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("init-name"), {
      target: { value: "fresh" },
    });

    expect(screen.getByTestId("init-resolved")).toHaveTextContent(
      "/tmp/dest/fresh",
    );
  });

  it("disables Create until parent and name are present", () => {
    render(<InitDialog />);
    const button = screen.getByTestId("init-submit");
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId("init-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("init-name"), {
      target: { value: "fresh" },
    });

    expect(button).not.toBeDisabled();
  });

  it("renders a failure inside the dialog", () => {
    useCreateStore.setState({
      open: "init",
      error: "/tmp/dest/fresh is already a git repository",
    });
    render(<InitDialog />);

    expect(screen.getByTestId("init-error")).toHaveTextContent(
      "already a git repository",
    );
  });

  it("renders nothing when another dialog is open", () => {
    useCreateStore.setState({ open: "clone" });
    const { container } = render(<InitDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("resets its form on a closed→open transition of a single mounted instance", async () => {
    // AppShell mounts InitDialog permanently; closing it is a `return
    // null`, not an unmount, so useState here survives across opens unless
    // the component resets it itself. Rendering once and toggling the
    // store's `open` field (rather than mounting a fresh component per
    // `it()`) is the only way this bug shows up at all.
    let calls = 0;
    mockInvoke("default_init_branch", () =>
      calls++ === 0 ? "trunk" : "renamed-default",
    );

    render(<InitDialog />);
    await waitFor(() =>
      expect(screen.getByTestId("init-branch")).toHaveValue("trunk"),
    );

    fireEvent.change(screen.getByTestId("init-name"), {
      target: { value: "custom-name" },
    });
    fireEvent.change(screen.getByTestId("init-branch"), {
      target: { value: "custom-branch" },
    });

    // Two separate commits, matching real usage: closing and reopening are
    // always distinct user actions (distinct event-handler invocations), so
    // React never batches them into one render that skips the "none" state.
    act(() => {
      useCreateStore.setState({ open: "none" });
    });
    act(() => {
      useCreateStore.setState({ open: "init" });
    });

    expect(screen.getByTestId("init-name")).toHaveValue("");
    // Branch resets, then re-fetches its default fresh — proving the stale
    // "custom-branch" value isn't silently kept, and that defaultInitBranch
    // actually runs again rather than reusing a leftover fetch result.
    await waitFor(() =>
      expect(screen.getByTestId("init-branch")).toHaveValue(
        "renamed-default",
      ),
    );
  });

  it("re-seeds the parent dir from settings on reopen instead of keeping an edited value", () => {
    useSettingsStore.getState().set("lastCreateDir", "/tmp/dest");
    render(<InitDialog />);
    expect(screen.getByTestId("init-parent")).toHaveValue("/tmp/dest");

    fireEvent.change(screen.getByTestId("init-parent"), {
      target: { value: "/tmp/somewhere-else" },
    });
    expect(screen.getByTestId("init-parent")).toHaveValue(
      "/tmp/somewhere-else",
    );

    // Two separate commits, matching real usage: closing and reopening are
    // always distinct user actions (distinct event-handler invocations), so
    // React never batches them into one render that skips the "none" state.
    act(() => {
      useCreateStore.setState({ open: "none" });
    });
    act(() => {
      useCreateStore.setState({ open: "init" });
    });

    // Not cleared, and not stuck on the edited value either: parentDir is
    // re-read from settings, since persisting lastCreateDir exists so the
    // next init starts where the last one left off.
    expect(screen.getByTestId("init-parent")).toHaveValue("/tmp/dest");
  });
});
