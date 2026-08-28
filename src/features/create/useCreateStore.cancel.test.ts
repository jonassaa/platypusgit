// Cancelling a running clone (#234).
//
// A clone against a host that accepts the connection and then stalls used to be
// escapable only by force-quitting the app — the Clone dialog's own Cancel
// button was disabled for exactly as long as the clone ran. These pin the store
// half of the fix: the cancel is addressed at the clone (not at a repository),
// the dialog is NOT unlocked until the clone has actually unwound, and a
// cancelled clone returns to an editable form with no error banner.

import { beforeEach, describe, expect, it } from "vitest";

import { useCreateStore } from "./useCreateStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  resetInvokeMock();
  useCreateStore.setState({
    open: "clone",
    busy: false,
    cancelRequested: false,
    progress: null,
    error: null,
  });
});

describe("cancelClone", () => {
  it("cancels the CLONE, not some repository's ops", async () => {
    useCreateStore.setState({ busy: true });
    mockInvoke("cancel_network_op", () => 1);

    await useCreateStore.getState().cancelClone();

    expect(calls("cancel_network_op")).toHaveLength(1);
    // A clone has no repository yet, and the backend reads a null repoId as
    // "the clone". Sending an id here would cancel a fetch somewhere instead
    // and leave the clone running.
    expect(calls("cancel_network_op")[0].args).toMatchObject({ repoId: null });
  });

  it("is a no-op when no clone is running", async () => {
    mockInvoke("cancel_network_op", () => 1);

    await useCreateStore.getState().cancelClone();

    expect(calls("cancel_network_op")).toHaveLength(0);
  });

  it("leaves the dialog locked until the clone itself unwinds", async () => {
    useCreateStore.setState({ busy: true });
    mockInvoke("cancel_network_op", () => 1);

    await useCreateStore.getState().cancelClone();

    // Unlocking here would let a second Clone start into the directory the
    // first one's cleanup is still deleting. `runClone`'s catch owns this.
    expect(useCreateStore.getState().busy).toBe(true);
  });

  it("says so when the cancel could not be signalled", async () => {
    useCreateStore.setState({ busy: true });
    mockInvoke("cancel_network_op", () => {
      throw { kind: "Internal", message: "boom" };
    });

    await useCreateStore.getState().cancelClone();

    // Staying silent would read as "cancelled" while the user was still stuck
    // behind an undismissable dialog — the exact dead end being fixed.
    expect(useCreateStore.getState().error).toBe("boom");
  });
});

describe("a cancelled clone", () => {
  const runCancelledClone = () =>
    useCreateStore.getState().runClone({
      url: "https://example.com/repo.git",
      parentDir: "/tmp",
      name: "repo",
      recurseSubmodules: false,
    });

  beforeEach(() => {
    mockInvoke("clone_repo", () => {
      throw { kind: "Cancelled" };
    });
  });

  it("returns the dialog to an editable, dismissable state", async () => {
    await runCancelledClone();

    const s = useCreateStore.getState();
    expect(s.busy).toBe(false);
    expect(s.progress).toBeNull();
    // Still open: the user cancelled the clone, not the dialog. The form keeps
    // its values so a retry — or a fix to the URL — costs nothing.
    expect(s.open).toBe("clone");
  });

  it("raises no error banner", async () => {
    await runCancelledClone();

    // A cancelled clone's git is SIGKILLed mid-sentence, so its stderr says
    // things like "early EOF". Reporting that answers the user's own Cancel
    // click with a failure they did not cause.
    expect(useCreateStore.getState().error).toBeNull();
  });

  it("does not open a tab for the clone it threw away", async () => {
    await runCancelledClone();

    expect(calls("open_repo")).toHaveLength(0);
  });
});

it("still reports a clone that genuinely failed", async () => {
  // The suppression is `kind`-specific, not "clone failures are quiet".
  mockInvoke("clone_repo", () => {
    throw { kind: "Network", message: "repository not found" };
  });

  await useCreateStore.getState().runClone({
    url: "https://example.com/nope.git",
    parentDir: "/tmp",
    name: "nope",
    recurseSubmodules: false,
  });

  expect(useCreateStore.getState().error).toBe("repository not found");
});

// Same two-click escalation as the status bar (#263): only the first cancel
// gives git the chance to remove its own lock files and partial destination.
describe("the cancel is visible after the first click", () => {
  it("marks the clone as cancelling", async () => {
    useCreateStore.setState({ busy: true });
    mockInvoke("cancel_network_op", () => 1);

    await useCreateStore.getState().cancelClone();

    expect(useCreateStore.getState().cancelRequested).toBe(true);
  });

  it("does not mark it when no clone is running", async () => {
    mockInvoke("cancel_network_op", () => 1);

    await useCreateStore.getState().cancelClone();

    expect(useCreateStore.getState().cancelRequested).toBe(false);
  });

  it("starts every run un-cancelled", async () => {
    // A retry after a cancelled clone must ask politely again rather than
    // inheriting the previous run's second-click state and going straight to
    // SIGKILL.
    useCreateStore.setState({ cancelRequested: true });
    mockInvoke("clone_repo", () => {
      expect(useCreateStore.getState().cancelRequested).toBe(false);
      throw { kind: "Cancelled" };
    });

    await useCreateStore.getState().runClone({
      url: "https://example.com/repo.git",
      parentDir: "/tmp",
      name: "repo",
      recurseSubmodules: false,
    });
  });
});
