// Cloning a private remote must be able to ask for a credential (#61 D5).
//
// The backend already classifies a clone failure as AppError::Auth and
// clone_repo already accepts credentials, but runClone neither passed them nor
// raised the challenge — so the Clone dialog printed "Authentication required"
// with nothing to answer it, a dead end for exactly the case the credential
// feature was built for.
import { beforeEach, describe, expect, it } from "vitest";

import { useCreateStore } from "@/features/create/useCreateStore";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

const AUTH = {
  kind: "Auth",
  message: { host: "github.com", kind: "Https" },
};
const HANDLE = { id: "repo-9", path: "/dev/private", head: "main" };

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

/** `clone_repo` refuses without credentials, succeeds once given them. */
function armClone() {
  mockInvoke("clone_repo", (args) => {
    if (!args.credentials) throw AUTH;
    return "/dev/private";
  });
  mockInvoke("open_repo", () => HANDLE);
  mockInvoke("trust_repo_path", () => undefined);
  mockInvoke("remember_credential", () => undefined);
  // openRepo's refresh fan-out.
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("list_all_files", () => []);
}

beforeEach(() => {
  resetInvokeMock();
  useAuthStore.setState({ challenge: null });
  useCreateStore.setState({
    open: "clone",
    busy: false,
    progress: null,
    error: null,
  });
  useRepoStore.setState({ current: null } as never);
});

describe("clone credential retry", () => {
  it("raises a credential challenge instead of a dead-end error", async () => {
    armClone();

    await useCreateStore.getState().runClone({
      url: "https://github.com/me/private.git",
      parentDir: "/dev",
      name: "private",
      recurseSubmodules: false,
    });

    const challenge = useAuthStore.getState().challenge;
    expect(challenge).not.toBeNull();
    expect(challenge?.host).toBe("github.com");
    expect(challenge?.kind).toBe("Https");
    // No error text: the prompt IS the answer to this failure.
    expect(useCreateStore.getState().error).toBeNull();
    // The dialog must stay dismissable while the prompt is up — `close()`
    // refuses to close while busy.
    expect(useCreateStore.getState().busy).toBe(false);
  });

  it("retries the clone with the supplied credential and closes on success", async () => {
    armClone();
    await useCreateStore.getState().runClone({
      url: "https://github.com/me/private.git",
      parentDir: "/dev",
      name: "private",
      recurseSubmodules: false,
    });

    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "token" }, false);

    expect(calls("clone_repo")).toHaveLength(2);
    expect(calls("clone_repo")[1].args.credentials).toEqual({
      username: "ada",
      secret: "token",
    });
    expect(useCreateStore.getState().open).toBe("none");
    expect(useCreateStore.getState().error).toBeNull();
  });

  it("remembers the credential only after the clone actually worked", async () => {
    armClone();
    await useCreateStore.getState().runClone({
      url: "https://github.com/me/private.git",
      parentDir: "/dev",
      name: "private",
      recurseSubmodules: false,
    });

    // Nothing stored yet — the credential has not been proven.
    expect(calls("remember_credential")).toHaveLength(0);

    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "token" }, true);

    expect(calls("remember_credential")).toHaveLength(1);
    expect(calls("remember_credential")[0].args.host).toBe("github.com");
  });

  it("surfaces a non-auth failure in the dialog without prompting", async () => {
    mockInvoke("clone_repo", () => {
      throw { kind: "Network", message: "could not resolve host" };
    });

    await useCreateStore.getState().runClone({
      url: "https://nope.invalid/x.git",
      parentDir: "/dev",
      name: "x",
      recurseSubmodules: false,
    });

    expect(useAuthStore.getState().challenge).toBeNull();
    expect(useCreateStore.getState().error).toContain("could not resolve host");
    expect(useCreateStore.getState().busy).toBe(false);
  });
});
