// The SSH key panel inside the credential dialog (#248).
//
// The assertions that matter are about what the panel HANDS OVER: the public
// key on the clipboard, the backend's own URL to the opener, the typed name and
// comment to the generate command — and the passphrase to that command and to
// nothing else.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SshKeyPanel } from "./SshKeyPanel";
import { useSshKeyStore } from "./useSshKeyStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { SshKeyInfo, SshKeyStatus } from "@/lib/types";

const KEY: SshKeyInfo = {
  path: "/home/ada/.ssh/id_ed25519",
  publicPath: "/home/ada/.ssh/id_ed25519.pub",
  algorithm: "ssh-ed25519",
  comment: "ada@example.com",
  fingerprint: "SHA256:cbltdYGTyWyhcZ7QDKBwALfElUYTPAZZDfwb1Dc08mw",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA ada@example.com",
  isDefaultIdentity: true,
};

function status(over: Partial<SshKeyStatus> = {}): SshKeyStatus {
  return {
    dir: "/home/ada/.ssh",
    dirExists: true,
    keys: [KEY],
    canGenerate: true,
    suggestedName: "id_ed25519_github",
    suggestedComment: "ada@example.com",
    addKeyUrl: "https://github.com/settings/ssh/new",
    host: "github.com",
    ...over,
  };
}

let clipboard: string[];

function mockStatus(over: Partial<SshKeyStatus> = {}) {
  mockInvoke("ssh_key_status", () => status(over));
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  useSshKeyStore.setState({
    status: null,
    loading: false,
    generating: false,
    generated: null,
    error: null,
  });
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn((t: string) => {
        clipboard.push(t);
        return Promise.resolve();
      }),
    },
  });
});

describe("SshKeyPanel", () => {
  it("shows the key ssh would find, with its fingerprint", async () => {
    mockStatus();
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    expect(await screen.findByTestId("ssh-key-primary")).toHaveTextContent(
      "/home/ada/.ssh/id_ed25519",
    );
    // The fingerprint is what makes "is this the one GitHub has?" answerable by
    // eye, so it must be rendered verbatim.
    expect(screen.getByTestId("ssh-key-fingerprint")).toHaveTextContent(
      KEY.fingerprint,
    );
  });

  it("asks the backend about the host the challenge named", async () => {
    mockStatus();
    render(<SshKeyPanel kind="SshKey" host="gitlab.example.com" />);
    await screen.findByTestId("ssh-key-primary");
    expect(calls("ssh_key_status")[0].args.host).toBe("gitlab.example.com");
  });

  it("says a key is missing rather than that authentication failed", async () => {
    mockStatus({ keys: [] });
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    const panel = await screen.findByTestId("ssh-key-panel");
    expect(panel.textContent).toContain("No SSH key found");
    expect(screen.queryByTestId("ssh-key-primary")).toBeNull();
    // And offers the one thing that fixes it.
    expect(screen.getByTestId("ssh-key-generate-open")).toBeTruthy();
  });

  it("copies the public key, and only the public key", async () => {
    mockStatus();
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-copy"));

    await waitFor(() => expect(clipboard).toEqual([KEY.publicKey]));
    expect(clipboard[0]).not.toContain("PRIVATE");
  });

  it("opens the backend's add-key URL rather than one it built itself", async () => {
    // The URL is assembled in Rust from the runtime host, which is what keeps
    // the hostname out of `src/` and off the privacy allow-list. If the panel
    // ever starts composing one, this fails.
    mockStatus();
    mockInvoke("open_url", () => undefined);
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    fireEvent.click(await screen.findByTestId("ssh-key-add-link"));
    await waitFor(() =>
      expect(calls("open_url")[0].args.url).toBe(
        "https://github.com/settings/ssh/new",
      ),
    );
  });

  it("offers no add-key link for a host whose forge we do not know", async () => {
    mockStatus({ addKeyUrl: null, host: "git.corp.example.com" });
    render(<SshKeyPanel kind="SshKey" host="git.corp.example.com" />);
    await screen.findByTestId("ssh-key-primary");
    expect(screen.queryByTestId("ssh-key-add-link")).toBeNull();
  });

  it("prefills the generate form from the backend's free name", async () => {
    // The suggestion is the only value that knows what is NOT already on disk.
    mockStatus();
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));

    expect(screen.getByTestId("ssh-key-name")).toHaveValue("id_ed25519_github");
    expect(screen.getByTestId("ssh-key-comment")).toHaveValue("ada@example.com");
  });

  it("generates with the typed name and comment", async () => {
    mockStatus({ keys: [] });
    mockInvoke("ssh_key_generate", () => KEY);
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));

    fireEvent.change(screen.getByTestId("ssh-key-name"), {
      target: { value: "id_ed25519_work" },
    });
    fireEvent.change(screen.getByTestId("ssh-key-comment"), {
      target: { value: "ada@work.example" },
    });
    fireEvent.click(screen.getByTestId("ssh-key-generate-submit"));

    await waitFor(() => expect(calls("ssh_key_generate")).toHaveLength(1));
    expect(calls("ssh_key_generate")[0].args.request).toEqual({
      name: "id_ed25519_work",
      comment: "ada@work.example",
      passphrase: undefined,
    });
  });

  it("sends a passphrase to the command and puts it nowhere else", async () => {
    mockStatus({ keys: [] });
    mockInvoke("ssh_key_generate", () => KEY);
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));

    fireEvent.change(screen.getByTestId("ssh-key-passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.change(screen.getByTestId("ssh-key-passphrase-confirm"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByTestId("ssh-key-generate-submit"));

    await waitFor(() => expect(calls("ssh_key_generate")).toHaveLength(1));
    expect(calls("ssh_key_generate")[0].args.request.passphrase).toBe("hunter2");
    // The store is where a devtools snapshot or a persistence middleware would
    // find it, so it must never be there — the same rule the credential secret
    // follows.
    expect(JSON.stringify(useSshKeyStore.getState())).not.toContain("hunter2");
  });

  it("refuses to generate when the two passphrases differ", async () => {
    mockStatus({ keys: [] });
    mockInvoke("ssh_key_generate", () => KEY);
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));

    fireEvent.change(screen.getByTestId("ssh-key-passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.change(screen.getByTestId("ssh-key-passphrase-confirm"), {
      target: { value: "hunter3" },
    });
    fireEvent.click(screen.getByTestId("ssh-key-generate-submit"));

    await waitFor(() => expect(calls("ssh_key_generate")).toHaveLength(0));
  });

  it("surfaces a refusal instead of pretending the key was made", async () => {
    mockStatus();
    mockInvoke("ssh_key_generate", () => {
      throw {
        kind: "SshKeyExists",
        message: "/home/ada/.ssh/id_ed25519",
      };
    });
    render(<SshKeyPanel kind="SshKey" host="github.com" />);
    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));
    fireEvent.click(screen.getByTestId("ssh-key-generate-submit"));

    const err = await screen.findByTestId("ssh-key-error");
    expect(err.textContent).toContain("already exists");
    expect(err.textContent).toContain("Nothing was overwritten");
    expect(screen.queryByTestId("ssh-key-generated")).toBeNull();
  });

  it("disables generation and explains when ssh-keygen is missing", async () => {
    // A state, not an error: the panel still lists keys and still links out.
    mockStatus({ canGenerate: false, keys: [] });
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    expect(await screen.findByTestId("ssh-key-generate-open")).toBeDisabled();
    expect(screen.getByTestId("ssh-keygen-unavailable").textContent).toContain(
      "ssh-keygen",
    );
    expect(screen.queryByTestId("ssh-key-error")).toBeNull();
  });

  it("says the status could not be read rather than rendering nothing", async () => {
    mockInvoke("ssh_key_status", () => {
      throw { kind: "Io", message: "cannot resolve your home directory" };
    });
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    expect((await screen.findByTestId("ssh-key-error")).textContent).toContain(
      "home directory",
    );
  });

  it("leads with the key it just generated", async () => {
    mockStatus({ keys: [] });
    const fresh = { ...KEY, path: "/home/ada/.ssh/id_ed25519_github" };
    mockInvoke("ssh_key_generate", () => fresh);
    render(<SshKeyPanel kind="SshKey" host="github.com" />);

    fireEvent.click(await screen.findByTestId("ssh-key-generate-open"));
    fireEvent.click(screen.getByTestId("ssh-key-generate-submit"));

    expect(await screen.findByTestId("ssh-key-generated")).toHaveTextContent(
      "/home/ada/.ssh/id_ed25519_github",
    );
    expect(screen.getByTestId("ssh-key-primary")).toHaveTextContent(
      "/home/ada/.ssh/id_ed25519_github",
    );
    // …and it is what Copy now hands over.
    fireEvent.click(screen.getByTestId("ssh-key-copy"));
    await waitFor(() => expect(clipboard).toEqual([fresh.publicKey]));
  });
});
