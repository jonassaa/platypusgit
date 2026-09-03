// Tag push and remote-branch delete take the same credential challenge/retry as
// push/pull/fetch/clone (#61 D5 follow-up).
//
// D5 threaded the four network sites its spec named and left these two on the
// credential-less runner, where an authenticated remote failed with git's stderr
// and no way to answer it. These tests pin that they now raise a challenge, that
// the retry carries the credential into the SAME op, and that "remember" is still
// only honored after the op actually worked and only for HTTPS.

import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useRepoStore } from "./useRepoStore";
import { useAuthStore } from "@/features/auth/useAuthStore";

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

const httpsChallenge = () => {
  throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
};

beforeEach(() => {
  resetInvokeMock();
  useAuthStore.setState({ challenge: null });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    error: null,
  });
  mockRefreshAll();
  mockInvoke("remember_credential", () => null);
});

describe.each([
  ["pushTag", "push_tag", () => useRepoStore.getState().pushTag("origin", "v1.2.0")],
  [
    "pushDeleteBranch",
    "push_delete_branch",
    () => useRepoStore.getState().pushDeleteBranch("origin", "feature/x"),
  ],
] as const)("%s credential retry", (_name, cmd, run) => {
  it("raises a challenge instead of a dead-end error", async () => {
    mockInvoke(cmd, httpsChallenge);

    await run();

    const challenge = useAuthStore.getState().challenge;
    expect(challenge).not.toBeNull();
    expect(challenge?.host).toBe("github.com");
    expect(challenge?.kind).toBe("Https");
    // The banner stays clear: an answerable failure is a prompt, not an error.
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("retries the same op with the credential", async () => {
    let attempts = 0;
    mockInvoke(cmd, () => {
      attempts += 1;
      if (attempts === 1) httpsChallenge();
      return null;
    });

    await run();
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "token" }, false);

    expect(attempts).toBe(2);
    const second = calls(cmd)[1];
    expect(second.args.credentials).toEqual({ username: "ada", secret: "token" });
    // The first attempt is prompt-less by design.
    expect(calls(cmd)[0].args.credentials).toBeUndefined();
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("remembers only after the op actually worked", async () => {
    // Fails on both attempts: storing on submit would persist a typo.
    mockInvoke(cmd, httpsChallenge);

    await run();
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "wrong" }, true);

    expect(calls("remember_credential")).toHaveLength(0);
    // The retry's own failure reaches the banner.
    expect(useRepoStore.getState().error).not.toBeNull();
  });

  it("remembers an HTTPS credential once the retry succeeds", async () => {
    let attempts = 0;
    mockInvoke(cmd, () => {
      attempts += 1;
      if (attempts === 1) httpsChallenge();
      return null;
    });

    await run();
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "token" }, true);

    expect(calls("remember_credential")).toHaveLength(1);
    expect(calls("remember_credential")[0].args.host).toBe("github.com");
  });

  it("never remembers an SSH passphrase with git's credential helper", async () => {
    // `git credential approve` stores an HTTP(S) password; an SSH passphrase
    // filed there would be offered at the next HTTPS prompt for the host.
    let attempts = 0;
    mockInvoke(cmd, () => {
      attempts += 1;
      if (attempts === 1) {
        throw { kind: "Auth", message: { host: "github.com", kind: "SshPassphrase" } };
      }
      return null;
    });

    await run();
    expect(useAuthStore.getState().challenge?.kind).toBe("SshPassphrase");
    await useAuthStore.getState().challenge!.retry({ secret: "key-passphrase" }, true);

    expect(attempts).toBe(2);
    expect(calls("remember_credential")).toHaveLength(0);
  });

  // #212. Cancelling the prompt used to return the app to exactly its prior
  // state: no banner, no spinner, no status line — nothing at all to
  // distinguish "your push did not happen" from "your push worked".
  it("reports the original failure when the prompt is dismissed", async () => {
    mockInvoke(cmd, httpsChallenge);

    await run();
    // Raising the prompt is not yet a failure, so the banner is still clear.
    expect(useRepoStore.getState().error).toBeNull();

    await useAuthStore.getState().dismiss();

    expect(useRepoStore.getState().error).toEqual({
      kind: "Auth",
      message: { host: "github.com", kind: "Https" },
    });
  });

  it("reports nothing when the prompt is answered and the retry works", async () => {
    let attempts = 0;
    mockInvoke(cmd, () => {
      attempts += 1;
      if (attempts === 1) httpsChallenge();
      return null;
    });

    await run();
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "token" }, false);

    expect(useRepoStore.getState().error).toBeNull();
  });

  it("surfaces a non-auth failure without prompting", async () => {
    mockInvoke(cmd, () => {
      throw { kind: "Network", message: "Could not resolve host: github.com" };
    });

    await run();

    expect(useAuthStore.getState().challenge).toBeNull();
    expect(useRepoStore.getState().error).not.toBeNull();
  });
});
