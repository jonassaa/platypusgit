// Settings → Identity (#212).
//
// The commit panel's prompt is the same form, and its behaviour is pinned in
// `CommitPanel.identity.test.tsx`. What only this screen can get wrong is
// reachability: the identity has to be settable BEFORE a commit fails, and with
// no repository open at all — a user who lands here from Welcome is exactly the
// user who has no identity yet.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";
import type { GitIdentity } from "@/lib/types";

function mockRestOfSettings() {
  mockInvoke("cli_shim_status", () => ({
    installed: true,
    shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit",
    source: "package",
    pathState: "onPath",
  }));
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log",
    logExists: false,
    logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0",
    version: "0.1.0",
  }));
}

const GLOBAL_IDENTITY: GitIdentity = {
  name: { value: "Ada Lovelace", scope: "global" },
  email: { value: "ada@example.com", scope: "global" },
  globalConfigPath: "/home/ada/.gitconfig",
  localConfigPath: null,
};

beforeEach(() => {
  localStorage.clear();
  resetInvokeMock();
  resetDialogs();
  mockRestOfSettings();
  useSettingsStore.getState().reset();
  useRepoStore.setState({ current: null } as never);
});

function renderSettings() {
  render(
    <WithDialogs>
      <SettingsScreen />
    </WithDialogs>,
  );
}

const identityCall = () => getInvokeCalls().find((c) => c.cmd === "get_identity");

describe("Settings → Identity (#212)", () => {
  it("shows the configured identity, and where it comes from", async () => {
    mockInvoke("get_identity", () => GLOBAL_IDENTITY);
    renderSettings();

    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLInputElement>("identity-name").value,
      ).toBe("Ada Lovelace"),
    );
    expect(screen.getByTestId<HTMLInputElement>("identity-email").value).toBe(
      "ada@example.com",
    );
    expect(screen.getByTestId("identity-source").textContent).toContain(
      "your global git config",
    );
  });

  it("asks for the global chain when no repository is open", async () => {
    mockInvoke("get_identity", () => GLOBAL_IDENTITY);
    renderSettings();

    // `repoId: null` is what makes this answerable from Welcome — with a
    // required repoId the screen could not have shown a true answer here.
    await waitFor(() => expect(identityCall()).toBeDefined());
    expect(identityCall()!.args.repoId).toBeNull();
  });

  it("asks for the open repository's effective identity when there is one", async () => {
    useRepoStore.setState({
      current: { id: "repo-7", path: "/repo", head: "refs/heads/main" },
    } as never);
    mockInvoke("get_identity", () => GLOBAL_IDENTITY);
    renderSettings();

    await waitFor(() => expect(identityCall()).toBeDefined());
    expect(identityCall()!.args.repoId).toBe("repo-7");
  });

  it("saves what was typed and confirms it landed", async () => {
    let stored: GitIdentity = {
      name: null,
      email: null,
      globalConfigPath: "/home/ada/.gitconfig",
      localConfigPath: null,
    };
    mockInvoke("get_identity", () => stored);
    mockInvoke("set_identity", (args) => {
      stored = {
        name: { value: String(args.name), scope: "global" },
        email: { value: String(args.email), scope: "global" },
        globalConfigPath: "/home/ada/.gitconfig",
        localConfigPath: null,
      };
      return null;
    });
    renderSettings();

    await waitFor(() => expect(screen.getByTestId("identity-form")).toBeTruthy());
    fireEvent.change(screen.getByTestId("identity-name"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.change(screen.getByTestId("identity-email"), {
      target: { value: "grace@example.com" },
    });
    fireEvent.click(screen.getByTestId("identity-save"));

    await waitFor(() => expect(screen.getByTestId("identity-saved")).toBeTruthy());
    const saves = getInvokeCalls().filter((c) => c.cmd === "set_identity");
    expect(saves).toHaveLength(1);
    expect(saves[0].args).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.com",
    });
  });

  it("reports a config it could not read instead of showing empty fields as the truth", async () => {
    mockInvoke("get_identity", () => {
      throw { kind: "Io", message: "permission denied" };
    });
    renderSettings();

    await waitFor(() =>
      expect(screen.getByTestId("identity-error").textContent).toContain(
        "permission denied",
      ),
    );
  });
});
