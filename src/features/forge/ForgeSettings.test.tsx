import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ForgeSettings } from "./ForgeSettings";
import { useForgeStore } from "./useForgeStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, dialogTitle, dismissDialog } from "@/test/dialog";
import type { ForgeDetection } from "@/lib/types";

const GH: ForgeDetection = {
  remote: "origin",
  host: "github.com",
  owner: "jonassaa",
  name: "platypusgit",
  kind: "GitHub",
};

const SELF_HOSTED: ForgeDetection = {
  remote: "origin",
  host: "git.example.com",
  owner: "team",
  name: "svc",
  kind: null,
};

beforeEach(() => {
  resetInvokeMock();
  localStorage.clear();
  useForgeStore.getState().reset();
  useForgeStore.setState({ hostKinds: {}, logins: {} });
});

describe("ForgeSettings", () => {
  it("says nothing is detected when no repository points at a forge", () => {
    render(<ForgeSettings />);
    expect(screen.getByText("No forge detected")).toBeInTheDocument();
  });

  it("offers a token field for the detected host", () => {
    useForgeStore.setState({ detection: GH });
    render(<ForgeSettings />);
    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.getByTestId("forge-token-github.com")).toBeInTheDocument();
    // The token field must not render as plain text — a screenshot of Settings
    // would otherwise carry the secret.
    expect(screen.getByTestId("forge-token-github.com")).toHaveAttribute(
      "type",
      "password",
    );
    // github.com's forge is known, so no kind picker.
    expect(screen.queryByTestId("forge-kind-github.com")).not.toBeInTheDocument();
  });

  it("asks which forge a self-hosted host is BEFORE taking a token", () => {
    useForgeStore.setState({ detection: SELF_HOSTED });
    render(<ForgeSettings />);
    // Sending the token to the wrong API is the failure this prevents.
    expect(screen.getByTestId("forge-kind-git.example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot tell a self-hosted GitHub from a GitLab/),
    ).toBeInTheDocument();
  });

  it("signs in and reports who the token belongs to", async () => {
    useForgeStore.setState({ detection: GH, repoId: "r1" });
    mockInvoke("forge_sign_in", () => ({ login: "jonassaa", name: "Jonas" }));
    mockInvoke("forge_detect", () => GH);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: true,
      login: null,
    }));
    mockInvoke("forge_list_pull_requests", () => []);

    render(<ForgeSettings />);
    await userEvent.type(
      screen.getByTestId("forge-token-github.com"),
      "ghp_supersecret",
    );
    await userEvent.click(screen.getByTestId("forge-signin-github.com"));

    expect(
      await screen.findByTestId("forge-signed-in-github.com"),
    ).toHaveTextContent("signed in as jonassaa");
    const call = getInvokeCalls().find((c) => c.cmd === "forge_sign_in");
    expect(call?.args.host).toBe("github.com");
    expect(call?.args.kind).toBe("GitHub");
  });

  it("clears the token field and reports a rejected token", async () => {
    useForgeStore.setState({ detection: GH });
    mockInvoke("forge_sign_in", () => {
      throw { kind: "ForgeAuth", message: "github.com" };
    });
    render(<ForgeSettings />);
    const field = screen.getByTestId("forge-token-github.com");
    await userEvent.type(field, "bad-token");
    await userEvent.click(screen.getByTestId("forge-signin-github.com"));

    await waitFor(() =>
      expect(
        screen.getByText(/token for github.com is missing or was rejected/),
      ).toBeInTheDocument(),
    );
    // A rejected token must not sit in the DOM waiting to be screenshotted.
    expect(field).toHaveValue("");
    expect(
      screen.getByTestId("forge-signed-out-github.com"),
    ).toBeInTheDocument();
  });

  it("surfaces a token-store failure with its remedy", async () => {
    useForgeStore.setState({ detection: GH });
    mockInvoke("forge_sign_in", () => {
      throw {
        kind: "ForgeTokenStore",
        message:
          "git did not keep the token for github.com. Configure a credential helper (for example `git config --global credential.helper osxkeychain`)",
      };
    });
    render(<ForgeSettings />);
    await userEvent.type(screen.getByTestId("forge-token-github.com"), "ghp_x");
    await userEvent.click(screen.getByTestId("forge-signin-github.com"));
    // Silently losing a secret the user typed is the failure this reports.
    expect(await screen.findByText(/credential helper/)).toBeInTheDocument();
  });

  it("re-checks a stored token on demand", async () => {
    useForgeStore.setState({ logins: { "github.com": "jonassaa" }, detection: GH });
    mockInvoke("forge_validate_token", () => ({ login: "somebody-else", name: null }));
    render(<ForgeSettings />);
    await userEvent.click(screen.getByTestId("forge-recheck-github.com"));
    await waitFor(() =>
      expect(
        screen.getByTestId("forge-signed-in-github.com"),
      ).toHaveTextContent("signed in as somebody-else"),
    );
  });

  it("confirms before removing a token, and honours cancel", async () => {
    useForgeStore.setState({ logins: { "github.com": "jonassaa" }, detection: GH });
    mockInvoke("forge_sign_out", () => null);
    render(
      <WithDialogs>
        <ForgeSettings />
      </WithDialogs>,
    );
    await userEvent.click(screen.getByTestId("forge-remove-github.com"));
    await waitFor(() =>
      expect(dialogTitle()).toContain("Remove the GitHub token for github.com?"),
    );
    await dismissDialog();
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("forge_sign_out");
    expect(useForgeStore.getState().logins["github.com"]).toBe("jonassaa");
  });

  it("removes the token once confirmed", async () => {
    useForgeStore.setState({ logins: { "github.com": "jonassaa" }, detection: GH });
    mockInvoke("forge_sign_out", () => null);
    render(
      <WithDialogs>
        <ForgeSettings />
      </WithDialogs>,
    );
    await userEvent.click(screen.getByTestId("forge-remove-github.com"));
    await waitFor(() => expect(dialogTitle()).toContain("Remove"));
    await acceptDialog();
    await waitFor(() => {
      expect(getInvokeCalls().map((c) => c.cmd)).toContain("forge_sign_out");
      expect(useForgeStore.getState().logins["github.com"]).toBeUndefined();
    });
    // Back to offering a token, not stuck claiming to be signed in.
    expect(
      await screen.findByTestId("forge-token-github.com"),
    ).toBeInTheDocument();
  });

  it("lists a host the user configured even with no repository open", () => {
    useForgeStore.setState({
      hostKinds: { "git.example.com": "GitLab" },
      logins: { "git.example.com": "aasberg" },
    });
    render(<ForgeSettings />);
    expect(
      screen.getByTestId("forge-signed-in-git.example.com"),
    ).toHaveTextContent("GitLab — signed in as aasberg");
  });
});
