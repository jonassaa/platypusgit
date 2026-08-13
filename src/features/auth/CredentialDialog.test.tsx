// Credential entry + retry (#61 D5).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialDialog } from "./CredentialDialog";
import { useAuthStore, type AuthChallengeRequest } from "./useAuthStore";

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
  beforeEach(() => useAuthStore.setState({ challenge: null }));

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
