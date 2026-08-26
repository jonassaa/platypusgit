// The Cancel button IS the cancel while a clone runs (#234).
//
// Before this it was `disabled={busy}`, which is what made a stalled clone a
// force-quit: the one control the user reaches for was the one that had been
// switched off.
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CloneDialog } from "./CloneDialog";
import { useCreateStore } from "./useCreateStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

describe("CloneDialog cancel", () => {
  beforeEach(() => {
    resetInvokeMock();
    useSettingsStore.getState().reset();
    mockInvoke("cancel_operation", () => true);
    useCreateStore.setState({
      open: "clone",
      busy: false,
      progress: null,
      error: null,
      cloneOpId: null,
    });
  });

  it("is enabled while a clone is running, unlike everything else in the form", () => {
    useCreateStore.setState({ busy: true, cloneOpId: "clone-1" });
    render(<CloneDialog />);

    expect(screen.getByTestId("clone-cancel")).not.toBeDisabled();
    // The rest of the form stays locked — this button is the exception.
    expect(screen.getByTestId("clone-url")).toBeDisabled();
    expect(screen.getByTestId("clone-submit")).toBeDisabled();
  });

  it("cancels the running clone by id", async () => {
    useCreateStore.setState({ busy: true, cloneOpId: "clone-42" });
    render(<CloneDialog />);

    fireEvent.click(screen.getByTestId("clone-cancel"));

    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(1));
    expect(calls("cancel_operation")[0].args.opId).toBe("clone-42");
  });

  it("says it is stopping, rather than leaving a progress bar creeping along", async () => {
    useCreateStore.setState({
      busy: true,
      cloneOpId: "clone-1",
      progress: { phase: "Receiving objects", percent: 40 },
    });
    render(<CloneDialog />);
    expect(screen.getByTestId("clone-progress")).toHaveTextContent(
      "Receiving objects — 40%",
    );

    fireEvent.click(screen.getByTestId("clone-cancel"));

    await waitFor(() =>
      expect(screen.getByTestId("clone-progress")).toHaveTextContent(
        "Stopping…",
      ),
    );
  });

  it("stays clickable after the first click, so a second one can force it", async () => {
    // The backend escalates SIGTERM → SIGKILL on a repeat cancel; disabling the
    // button after one click would take that escape hatch away.
    useCreateStore.setState({ busy: true, cloneOpId: "clone-1" });
    render(<CloneDialog />);

    fireEvent.click(screen.getByTestId("clone-cancel"));
    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(1));
    expect(screen.getByTestId("clone-cancel")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("clone-cancel"));
    await waitFor(() => expect(calls("cancel_operation")).toHaveLength(2));
  });

  it("closes the dialog when nothing is running, as it always did", () => {
    render(<CloneDialog />);

    fireEvent.click(screen.getByTestId("clone-cancel"));

    expect(useCreateStore.getState().open).toBe("none");
    expect(calls("cancel_operation")).toHaveLength(0);
  });

  it("is disabled for a clone with no op id — nothing could stop it", () => {
    // Belt and braces: a clone started without an id (an older frontend, a
    // dropped id) must not offer a button that does nothing.
    useCreateStore.setState({ busy: true, cloneOpId: null });
    render(<CloneDialog />);

    expect(screen.getByTestId("clone-cancel")).toBeDisabled();
  });
});
