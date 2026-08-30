// Credential entry + retry (#61 D5).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialDialog } from "./CredentialDialog";
import { useAuthStore, type AuthChallengeRequest } from "./useAuthStore";
import { useSshKeyStore } from "./useSshKeyStore";
import { mockInvoke } from "@/test/invokeMock";
import type { SshKeyStatus } from "@/lib/types";

/** The panel loads a status as soon as an SSH challenge mounts it (#248). */
function mockSshStatus(over: Partial<SshKeyStatus> = {}) {
  mockInvoke(
    "ssh_key_status",
    (): SshKeyStatus => ({
      dir: "/home/ada/.ssh",
      dirExists: true,
      keys: [],
      canGenerate: true,
      suggestedName: "id_ed25519",
      suggestedComment: "ada@example.com",
      addKeyUrl: "https://github.com/settings/ssh/new",
      host: "github.com",
      ...over,
    }),
  );
}

function raise(
  over: Partial<AuthChallengeRequest> = {},
  retry = vi.fn().mockResolvedValue(undefined),
) {
  useAuthStore.getState().raise({
    host: "github.com",
    kind: "Https",
    retry,
    ...over,
  });
  return retry;
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("CredentialDialog", () => {
  beforeEach(() => {
    useAuthStore.setState({ challenge: null });
    useSshKeyStore.setState({
      status: null,
      loading: false,
      generating: false,
      generated: null,
      error: null,
    });
    mockSshStatus();
  });

  it("renders nothing without a challenge", () => {
    render(<CredentialDialog />);
    expect(screen.queryByTestId("credential-dialog")).toBeNull();
  });

  it("names the host it is authenticating to", () => {
    raise();
    render(<CredentialDialog />);
    expect(screen.getByTestId("credential-dialog").textContent).toContain(
      "github.com",
    );
  });

  it("retries with the entered credentials", async () => {
    const retry = raise();
    render(<CredentialDialog />);
    type("credential-username", "ada");
    type("credential-secret", "ghp_x");
    fireEvent.click(screen.getByTestId("credential-submit"));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(
        { username: "ada", secret: "ghp_x" },
        false,
      ),
    );
  });

  it("passes remember through when checked", async () => {
    const retry = raise();
    render(<CredentialDialog />);
    type("credential-secret", "ghp_x");
    // PGCheckbox does not forward data-testid, so target it by role.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("credential-submit"));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(expect.anything(), true),
    );
  });

  it("asks only for a passphrase on an SSH challenge", () => {
    raise({ kind: "SshPassphrase", host: null });
    render(<CredentialDialog />);
    expect(screen.queryByTestId("credential-username")).toBeNull();
    expect(screen.getByTestId("credential-secret")).toBeTruthy();
  });

  // ─── SSH key setup (#248) ──────────────────────────────────────────────────

  it("offers key setup on an SSH challenge and nothing of the sort on HTTPS", async () => {
    raise({ kind: "SshKey" });
    const { unmount } = render(<CredentialDialog />);
    expect(await screen.findByTestId("ssh-key-panel")).toBeTruthy();
    unmount();

    useSshKeyStore.setState({ status: null });
    raise({ kind: "Https" });
    render(<CredentialDialog />);
    expect(screen.queryByTestId("ssh-key-panel")).toBeNull();
  });

  it("does not lead with a passphrase box for a REJECTED key", async () => {
    // The server refused the public half; a passphrase unlocks the private
    // one. Asking for it first is the behaviour #248 exists to replace.
    raise({ kind: "SshKey" });
    render(<CredentialDialog />);
    await screen.findByTestId("ssh-key-panel");

    expect(screen.queryByTestId("credential-secret")).toBeNull();
    fireEvent.click(screen.getByTestId("credential-reveal-secret"));
    expect(screen.getByTestId("credential-secret")).toBeTruthy();
  });

  it("keeps the passphrase box in front for an ENCRYPTED key", async () => {
    // The opposite challenge: the key is fine and locked, so the box leads and
    // the panel is context.
    raise({ kind: "SshPassphrase" });
    render(<CredentialDialog />);
    await screen.findByTestId("ssh-key-panel");
    expect(screen.getByTestId("credential-secret")).toBeTruthy();
    expect(screen.queryByTestId("credential-reveal-secret")).toBeNull();
  });

  it("retries an SSH challenge with no credential at all", async () => {
    // The whole point of the key panel: generate, register with the host, then
    // run the same operation again. There is no secret to type, and the
    // prompt-less attempt that just failed is the one that now succeeds.
    const retry = raise({ kind: "SshKey" });
    render(<CredentialDialog />);
    await screen.findByTestId("ssh-key-panel");

    expect(screen.getByTestId("credential-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("credential-submit"));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(undefined, false));
  });

  it("still refuses to submit an empty HTTPS credential", async () => {
    // The relaxation above is SSH-only: a blank token would burn an
    // authentication attempt on a credential we already know is empty.
    const retry = raise({ kind: "Https" });
    render(<CredentialDialog />);
    expect(screen.getByTestId("credential-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("credential-submit"));
    expect(retry).not.toHaveBeenCalled();
  });

  it("re-reads the key status for each new challenge", async () => {
    // A stale status from the previous host would name the wrong add-key page.
    raise({ kind: "SshKey", host: "github.com" });
    render(<CredentialDialog />);
    await screen.findByTestId("ssh-key-panel");
    useSshKeyStore.setState({ status: null });

    mockSshStatus({ host: "gitlab.com" });
    raise({ kind: "SshKey", host: "gitlab.com" });
    await waitFor(() =>
      expect(useSshKeyStore.getState().status?.host).toBe("gitlab.com"),
    );
  });

  it("omits the username from an SSH passphrase retry", async () => {
    const retry = raise({ kind: "SshPassphrase", host: null });
    render(<CredentialDialog />);
    type("credential-secret", "phrase");
    fireEvent.click(screen.getByTestId("credential-submit"));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith({ secret: "phrase" }, false),
    );
  });

  it("dismissing clears the challenge without retrying", () => {
    const retry = raise();
    render(<CredentialDialog />);
    fireEvent.click(screen.getByTestId("credential-cancel"));
    expect(retry).not.toHaveBeenCalled();
    expect(useAuthStore.getState().challenge).toBeNull();
  });

  it("cannot submit an empty secret", () => {
    const retry = raise();
    render(<CredentialDialog />);
    expect(screen.getByTestId("credential-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("credential-submit"));
    expect(retry).not.toHaveBeenCalled();
  });

  it("never keeps the secret in the store", async () => {
    raise();
    render(<CredentialDialog />);
    type("credential-secret", "ghp_supersecret");
    // Before submitting: the store must already be free of it.
    expect(JSON.stringify(useAuthStore.getState())).not.toContain(
      "ghp_supersecret",
    );

    fireEvent.click(screen.getByTestId("credential-submit"));
    await waitFor(() =>
      expect(useAuthStore.getState().challenge).toBeNull(),
    );
    expect(JSON.stringify(useAuthStore.getState())).not.toContain(
      "ghp_supersecret",
    );
  });

  it("masks the secret until revealed", () => {
    raise();
    render(<CredentialDialog />);
    expect(screen.getByTestId("credential-secret")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByTitle("Show"));
    expect(screen.getByTestId("credential-secret")).toHaveAttribute(
      "type",
      "text",
    );
  });
});
