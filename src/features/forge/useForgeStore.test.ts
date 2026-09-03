import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import type { ForgeDetection, PullRequest } from "@/lib/types";
import { useAuthStore } from "@/features/auth/useAuthStore";
import type { ForgeAccount } from "./forgeAccounts";
import { useForgeStore } from "./useForgeStore";

/** One signed-in account, active unless said otherwise. */
function acct(over: Partial<ForgeAccount> = {}): ForgeAccount {
  return { id: "acc-1", login: "jonassaa", active: true, ...over };
}

/** Answer everything `useRepoStore.refreshAll` fans out to. */
function mockRefreshAll() {
  for (const cmd of [
    "get_status",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], hasMore: false }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
}

const GH_DETECTION: ForgeDetection = {
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

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 118,
    title: "Add a thing",
    author: "jonassaa",
    sourceBranch: "feat/thing",
    targetBranch: "main",
    url: "https://github.com/jonassaa/platypusgit/pull/118",
    draft: false,
    crossRepo: false,
    sha: "6d15cfe",
    updatedAt: "2026-08-14T00:00:00Z",
    ...over,
  };
}

function reset() {
  resetInvokeMock();
  localStorage.clear();
  useForgeStore.setState({
    repoId: null,
    detection: null,
    forge: null,
    signedIn: false,
    pulls: [],
    selected: null,
    checks: {},
    hostKinds: {},
    accounts: {},
    loading: false,
    creating: false,
    checkingOut: false,
    authBusy: false,
    error: null,
    createOpen: false,
    createdUrl: null,
  });
}

describe("detect + gate", () => {
  beforeEach(reset);

  it("reports no-repo before a repository is open", () => {
    expect(useForgeStore.getState().gate()).toBe("no-repo");
  });

  it("resets when the repository closes", async () => {
    useForgeStore.setState({ repoId: "r1", detection: GH_DETECTION, pulls: [pr()] });
    await useForgeStore.getState().detect(null);
    const s = useForgeStore.getState();
    expect(s.repoId).toBeNull();
    expect(s.detection).toBeNull();
    expect(s.pulls).toEqual([]);
  });

  it("reports no-forge — NOT an error — when no remote parses", async () => {
    mockInvoke("forge_detect", () => null);
    await useForgeStore.getState().detect("r1");
    const s = useForgeStore.getState();
    expect(s.gate()).toBe("no-forge");
    // "This repo has no forge" is a state the UI renders, not a failure.
    expect(s.error).toBeNull();
  });

  it("reports unknown-host for a self-hosted instance and never calls the API", async () => {
    mockInvoke("forge_detect", () => SELF_HOSTED);
    await useForgeStore.getState().detect("r1");
    expect(useForgeStore.getState().gate()).toBe("unknown-host");
    // No kind means no API base — asking for a token first would send it to the
    // wrong forge.
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("forge_token_status");
  });

  it("reports signed-out without hitting the network", async () => {
    mockInvoke("forge_detect", () => GH_DETECTION);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: false,
      login: null,
    }));
    await useForgeStore.getState().detect("r1");
    expect(useForgeStore.getState().gate()).toBe("signed-out");
    // Entering the screen must not cost an authenticated request just to render
    // an empty state.
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain(
      "forge_list_pull_requests",
    );
  });

  it("lists requests once a token is present", async () => {
    mockInvoke("forge_detect", () => GH_DETECTION);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: true,
      login: null,
    }));
    mockInvoke("forge_list_pull_requests", () => [pr(), pr({ number: 119 })]);
    await useForgeStore.getState().detect("r1");
    const s = useForgeStore.getState();
    expect(s.gate()).toBe("ready");
    expect(s.pulls).toHaveLength(2);
    // First row selected so the detail pane is never blank on arrival.
    expect(s.selected).toBe(118);
    expect(s.forge).toEqual({
      host: "github.com",
      owner: "jonassaa",
      name: "platypusgit",
      kind: "GitHub",
    });
  });

  it("passes the persisted host-kind map to detection", async () => {
    localStorage.setItem(
      "pg-forge-hosts",
      JSON.stringify({ hostKinds: { "git.example.com": "GitLab" }, accounts: {} }),
    );
    useForgeStore.setState({ hostKinds: { "git.example.com": "GitLab" } });
    mockInvoke("forge_detect", () => ({ ...SELF_HOSTED, kind: "GitLab" }));
    mockInvoke("forge_token_status", () => ({
      host: "git.example.com",
      signedIn: false,
      login: null,
    }));
    await useForgeStore.getState().detect("r1");
    const call = getInvokeCalls().find((c) => c.cmd === "forge_detect");
    expect(call?.args.hostKinds).toEqual({ "git.example.com": "GitLab" });
  });
});

describe("refresh", () => {
  beforeEach(() => {
    reset();
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      forge: {
        host: "github.com",
        owner: "jonassaa",
        name: "platypusgit",
        kind: "GitHub",
      },
      signedIn: true,
    });
  });

  it("falls back to the signed-out gate on a rejected token, with no banner", async () => {
    mockInvoke("forge_list_pull_requests", () => {
      throw { kind: "ForgeAuth", message: "github.com" };
    });
    await useForgeStore.getState().refresh();
    const s = useForgeStore.getState();
    expect(s.signedIn).toBe(false);
    expect(s.gate()).toBe("signed-out");
    // The screen offers the fix; a bare "forge authentication required" banner
    // would not.
    expect(s.error).toBeNull();
  });

  it("reports any other failure as an error and stays signed in", async () => {
    mockInvoke("forge_list_pull_requests", () => {
      throw { kind: "Network", message: "could not resolve host" };
    });
    await useForgeStore.getState().refresh();
    const s = useForgeStore.getState();
    expect(s.signedIn).toBe(true);
    expect(s.error).toContain("could not resolve host");
    expect(s.loading).toBe(false);
  });

  it("keeps a still-open selection and re-picks when it closed", async () => {
    useForgeStore.setState({ selected: 119 });
    mockInvoke("forge_list_pull_requests", () => [pr({ number: 119 }), pr()]);
    await useForgeStore.getState().refresh();
    expect(useForgeStore.getState().selected).toBe(119);

    mockInvoke("forge_list_pull_requests", () => [pr({ number: 200 })]);
    await useForgeStore.getState().refresh();
    expect(useForgeStore.getState().selected).toBe(200);
  });
});

describe("checks", () => {
  beforeEach(() => {
    reset();
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      forge: {
        host: "github.com",
        owner: "jonassaa",
        name: "platypusgit",
        kind: "GitHub",
      },
      signedIn: true,
      pulls: [pr()],
    });
  });

  it("fetches once per request and caches", async () => {
    mockInvoke("forge_pull_request_checks", () => ({
      state: "Success",
      total: 3,
      label: "success",
    }));
    await useForgeStore.getState().loadChecks(118);
    await useForgeStore.getState().loadChecks(118);
    expect(
      getInvokeCalls().filter((c) => c.cmd === "forge_pull_request_checks"),
    ).toHaveLength(1);
    expect(useForgeStore.getState().checks[118]?.state).toBe("Success");
  });

  it("skips a request with no head sha", async () => {
    useForgeStore.setState({ pulls: [pr({ sha: null })] });
    await useForgeStore.getState().loadChecks(118);
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain(
      "forge_pull_request_checks",
    );
  });

  it("swallows a checks failure rather than banner-ing it", async () => {
    mockInvoke("forge_pull_request_checks", () => {
      throw { kind: "Forge", message: "HTTP 404" };
    });
    await useForgeStore.getState().loadChecks(118);
    expect(useForgeStore.getState().error).toBeNull();
  });
});

describe("checkout", () => {
  beforeEach(() => {
    reset();
    useAuthStore.setState({ challenge: null });
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      forge: {
        host: "github.com",
        owner: "jonassaa",
        name: "platypusgit",
        kind: "GitHub",
      },
      signedIn: true,
    });
    // refreshAll now runs INSIDE the retried closure (the retry path has no other
    // way to reflect the new branch), so its fan-out has to be answerable.
    mockRefreshAll();
  });

  it("fetches into the request's own branch name for a same-repo request", async () => {
    mockInvoke("forge_checkout_pull_request", () => null);
    expect(await useForgeStore.getState().checkout(pr())).toBe("ok");
    const call = getInvokeCalls().find(
      (c) => c.cmd === "forge_checkout_pull_request",
    );
    expect(call?.args.request).toEqual({
      repoId: "r1",
      remoteName: "origin",
      kind: "GitHub",
      number: 118,
      localBranch: "feat/thing",
      force: false,
    });
  });

  it("numbers the branch for a fork request", async () => {
    mockInvoke("forge_checkout_pull_request", () => null);
    await useForgeStore
      .getState()
      .checkout(pr({ crossRepo: true, sourceBranch: "main", number: 7 }));
    const call = getInvokeCalls().find(
      (c) => c.cmd === "forge_checkout_pull_request",
    );
    // A fork's `main` must never land on your `main`.
    expect(call?.args.request.localBranch).toBe("pr-7");
  });

  it("fetches from the remote detection picked, not a hardcoded origin", async () => {
    useForgeStore.setState({
      detection: { ...GH_DETECTION, remote: "upstream" },
    });
    mockInvoke("forge_checkout_pull_request", () => null);
    await useForgeStore.getState().checkout(pr());
    const call = getInvokeCalls().find(
      (c) => c.cmd === "forge_checkout_pull_request",
    );
    expect(call?.args.request.remoteName).toBe("upstream");
  });

  it("reports branch-exists with NO error, so the caller can confirm", async () => {
    mockInvoke("forge_checkout_pull_request", () => {
      throw { kind: "BranchExists", message: "feat/thing" };
    });
    expect(await useForgeStore.getState().checkout(pr())).toBe("branch-exists");
    // The caller confirms and retries with force; a store that opened its own
    // dialog would stop being unit-testable.
    expect(useForgeStore.getState().error).toBeNull();
    expect(useForgeStore.getState().checkingOut).toBe(false);
  });

  it("raises a credential challenge on an auth failure instead of erroring", async () => {
    // Fetching a request's head ref is an ordinary git-transport op, so it must
    // reuse the SAME challenge/retry path as fetch/pull/push/pushTag (#61 D5) —
    // not a second one, and not a bare banner the user cannot act on.
    mockInvoke("forge_checkout_pull_request", () => {
      throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
    });
    expect(await useForgeStore.getState().checkout(pr())).toBe("auth-pending");
    const challenge = useAuthStore.getState().challenge;
    expect(challenge?.host).toBe("github.com");
    expect(challenge?.kind).toBe("Https");
    // NOT an error banner, and NOT "branch-exists" — stacking an overwrite
    // confirm on top of a password prompt is what the outcome type prevents.
    expect(useForgeStore.getState().error).toBeNull();
    expect(useForgeStore.getState().checkingOut).toBe(false);
  });

  it("retries the SAME checkout with the credential the dialog collected", async () => {
    let attempt = 0;
    mockInvoke("forge_checkout_pull_request", () => {
      attempt += 1;
      if (attempt === 1) {
        throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
      }
      return null;
    });
    mockInvoke("remember_credential", () => null);

    await useForgeStore.getState().checkout(pr());
    const challenge = useAuthStore.getState().challenge;
    await challenge!.retry({ username: "u", secret: "s" }, false);

    const calls = getInvokeCalls().filter(
      (c) => c.cmd === "forge_checkout_pull_request",
    );
    expect(calls).toHaveLength(2);
    // Same request, now carrying the credential — the retry must not silently
    // change the branch it lands on.
    expect(calls[1].args.request).toEqual(calls[0].args.request);
    expect(calls[1].args.credentials).toEqual({ username: "u", secret: "s" });
  });

  it("reports a non-auth, non-collision failure as an error", async () => {
    mockInvoke("forge_checkout_pull_request", () => {
      throw { kind: "Network", message: "could not resolve host" };
    });
    expect(await useForgeStore.getState().checkout(pr())).toBe("error");
    expect(useForgeStore.getState().error).toContain("could not resolve host");
  });
});

describe("create", () => {
  beforeEach(() => {
    reset();
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      forge: {
        host: "github.com",
        owner: "jonassaa",
        name: "platypusgit",
        kind: "GitHub",
      },
      signedIn: true,
    });
  });

  it("surfaces the created url and puts the request at the top of the list", async () => {
    const created = pr({ number: 121, url: "https://github.com/o/r/pull/121" });
    mockInvoke("forge_create_pull_request", () => created);
    useForgeStore.getState().openCreate();
    const out = await useForgeStore.getState().create({
      title: "Add a thing",
      body: "",
      sourceBranch: "feat/thing",
      targetBranch: "main",
      draft: false,
    });
    const s = useForgeStore.getState();
    expect(out?.number).toBe(121);
    expect(s.createdUrl).toBe("https://github.com/o/r/pull/121");
    expect(s.pulls[0]?.number).toBe(121);
    expect(s.selected).toBe(121);
    expect(s.createOpen).toBe(false);
  });

  it("keeps the form open and reports the error on failure", async () => {
    mockInvoke("forge_create_pull_request", () => {
      throw { kind: "Forge", message: "HTTP 422: A pull request already exists" };
    });
    useForgeStore.getState().openCreate();
    expect(
      await useForgeStore.getState().create({
        title: "Add a thing",
        body: "",
        sourceBranch: "feat/thing",
        targetBranch: "main",
        draft: false,
      }),
    ).toBeNull();
    const s = useForgeStore.getState();
    expect(s.createOpen).toBe(true);
    expect(s.error).toContain("already exists");
    expect(s.creating).toBe(false);
  });
});

describe("accounts", () => {
  beforeEach(reset);

  it("signIn stores the account and the host's kind, and never the token", async () => {
    mockInvoke("forge_sign_in", () => ({ login: "jonassaa", name: "Jonas" }));
    expect(
      await useForgeStore.getState().signIn("github.com", "GitHub", "ghp_secret"),
    ).toBe(true);
    const s = useForgeStore.getState();
    expect(s.accounts["github.com"]?.[0]).toMatchObject({
      login: "jonassaa",
      active: true,
    });
    expect(s.hostKinds["github.com"]).toBe("GitHub");
    // Nothing in the store, and nothing in localStorage, may hold the token.
    expect(JSON.stringify(s)).not.toContain("ghp_secret");
    expect(localStorage.getItem("pg-forge-hosts")).not.toContain("ghp_secret");
  });

  it("signIn names the credential slot it wants the token stored in", async () => {
    // The slot id is what lets a second account on the same host have its own
    // token instead of overwriting the first one's.
    mockInvoke("forge_sign_in", () => ({ login: "jonassaa", name: null }));
    await useForgeStore.getState().signIn("github.com", "GitHub", "ghp_x");
    const call = getInvokeCalls().find((c) => c.cmd === "forge_sign_in");
    const id = useForgeStore.getState().accounts["github.com"][0].id;
    expect(id).toBeTruthy();
    expect(call?.args.account).toBe(id);
  });

  it("keeps BOTH accounts when a second login signs in to the same host", async () => {
    // The whole point of #233's forge half: work and personal on github.com.
    useForgeStore.setState({
      accounts: { "github.com": [acct({ id: "acc-work", login: "work" })] },
    });
    mockInvoke("forge_sign_in", () => ({ login: "personal", name: null }));
    await useForgeStore.getState().signIn("github.com", "GitHub", "ghp_2");
    const list = useForgeStore.getState().accounts["github.com"];
    expect(list.map((a) => a.login)).toEqual(["work", "personal"]);
    // The one you just signed in to is the one you meant to use.
    expect(list.find((a) => a.active)?.login).toBe("personal");
  });

  it("collapses a re-sign-in for a login that already has a slot, erasing the old one", async () => {
    // Pasting a fresh token for an expired one must not leave two "work" rows —
    // and the token in the slot it replaces must not linger in the keychain.
    useForgeStore.setState({
      accounts: { "github.com": [acct({ id: null, login: "work" })] },
    });
    mockInvoke("forge_sign_in", () => ({ login: "work", name: null }));
    mockInvoke("forge_sign_out", () => null);
    await useForgeStore.getState().signIn("github.com", "GitHub", "ghp_new");
    const list = useForgeStore.getState().accounts["github.com"];
    expect(list).toHaveLength(1);
    expect(list[0].login).toBe("work");
    expect(list[0].id).not.toBeNull();
    const out = getInvokeCalls().find((c) => c.cmd === "forge_sign_out");
    expect(out?.args).toEqual({ host: "github.com", account: null });
  });

  it("signIn reports a rejected token and stores no account", async () => {
    mockInvoke("forge_sign_in", () => {
      throw { kind: "ForgeAuth", message: "github.com" };
    });
    expect(
      await useForgeStore.getState().signIn("github.com", "GitHub", "bad"),
    ).toBe(false);
    const s = useForgeStore.getState();
    expect(s.accounts["github.com"]).toBeUndefined();
    expect(s.error).toContain("github.com");
    expect(s.authBusy).toBe(false);
  });

  it("a rejected second token leaves the first account untouched", async () => {
    useForgeStore.setState({
      accounts: { "github.com": [acct({ id: "acc-work", login: "work" })] },
    });
    mockInvoke("forge_sign_in", () => {
      throw { kind: "ForgeAuth", message: "github.com" };
    });
    await useForgeStore.getState().signIn("github.com", "GitHub", "bad");
    expect(useForgeStore.getState().accounts["github.com"]).toEqual([
      { id: "acc-work", login: "work", active: true },
    ]);
  });

  it("signIn surfaces a token-store failure so it is not silently lost", async () => {
    // D5 could treat storage as best-effort; a forge token cannot — a token that
    // vanishes means the user typed a secret into a box for nothing.
    mockInvoke("forge_sign_in", () => {
      throw {
        kind: "ForgeTokenStore",
        message: "git did not keep the token for github.com. Configure a credential helper",
      };
    });
    expect(
      await useForgeStore.getState().signIn("github.com", "GitHub", "ghp_x"),
    ).toBe(false);
    expect(useForgeStore.getState().error).toContain("credential helper");
  });

  it("validate re-probes ONE slot and renames just that account", async () => {
    useForgeStore.setState({
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work" }),
          acct({ id: "acc-2", login: "personal", active: false }),
        ],
      },
    });
    mockInvoke("forge_validate_token", () => ({ login: "renamed", name: null }));
    await useForgeStore.getState().validate("github.com", "GitHub", "acc-2");
    const call = getInvokeCalls().find((c) => c.cmd === "forge_validate_token");
    expect(call?.args.account).toBe("acc-2");
    expect(
      useForgeStore.getState().accounts["github.com"].map((a) => a.login),
    ).toEqual(["work", "renamed"]);
  });

  it("validate drops ONLY the account the forge no longer accepts", async () => {
    useForgeStore.setState({
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work" }),
          acct({ id: "acc-2", login: "personal", active: false }),
        ],
      },
      forge: { host: "github.com", owner: "o", name: "r", kind: "GitHub" },
      signedIn: true,
    });
    mockInvoke("forge_validate_token", () => {
      throw { kind: "ForgeAuth", message: "github.com" };
    });
    await useForgeStore.getState().validate("github.com", "GitHub", "acc-1");
    const list = useForgeStore.getState().accounts["github.com"];
    // The other account on the same host is still signed in — the eviction the
    // singular `logins` map could not avoid.
    expect(list).toEqual([{ id: "acc-2", login: "personal", active: true }]);
  });

  it("signOut clears one account, the list and the checks cache", async () => {
    useForgeStore.setState({
      accounts: { "github.com": [acct({ id: "acc-1" })] },
      forge: { host: "github.com", owner: "o", name: "r", kind: "GitHub" },
      signedIn: true,
      pulls: [pr()],
      checks: { 118: { state: "Success", total: 1, label: "success" } },
    });
    mockInvoke("forge_sign_out", () => null);
    await useForgeStore.getState().signOut("github.com", "acc-1");
    const s = useForgeStore.getState();
    expect(s.accounts["github.com"]).toBeUndefined();
    expect(s.signedIn).toBe(false);
    expect(s.pulls).toEqual([]);
    expect(s.checks).toEqual({});
    const call = getInvokeCalls().find((c) => c.cmd === "forge_sign_out");
    expect(call?.args.account).toBe("acc-1");
  });

  it("signOut does NOT evict the other account on the same host", async () => {
    useForgeStore.setState({
      repoId: "r1",
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work" }),
          acct({ id: "acc-2", login: "personal", active: false }),
        ],
      },
      detection: GH_DETECTION,
      forge: { host: "github.com", owner: "o", name: "r", kind: "GitHub" },
      signedIn: true,
    });
    mockInvoke("forge_sign_out", () => null);
    mockInvoke("forge_detect", () => GH_DETECTION);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: true,
      login: null,
    }));
    mockInvoke("forge_list_pull_requests", () => []);
    await useForgeStore.getState().signOut("github.com", "acc-1");
    expect(useForgeStore.getState().accounts["github.com"]).toEqual([
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("switchAccount points the host at another account and re-detects", async () => {
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work" }),
          acct({ id: "acc-2", login: "personal", active: false }),
        ],
      },
    });
    mockInvoke("forge_detect", () => GH_DETECTION);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: true,
      login: null,
    }));
    mockInvoke("forge_list_pull_requests", () => []);
    await useForgeStore.getState().switchAccount("github.com", "acc-2");
    const list = useForgeStore.getState().accounts["github.com"];
    expect(list.find((a) => a.active)?.id).toBe("acc-2");
    // Persisted immediately: which account a host uses must survive a restart.
    expect(localStorage.getItem("pg-forge-hosts")).toContain("acc-2");
    // The list on screen belongs to the account that just went inactive.
    const status = getInvokeCalls().find((c) => c.cmd === "forge_token_status");
    expect(status?.args.account).toBe("acc-2");
  });

  it("refreshTokenStatus drops only the active account when its slot is empty", async () => {
    useForgeStore.setState({
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work" }),
          acct({ id: "acc-2", login: "personal", active: false }),
        ],
      },
    });
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: false,
      login: null,
    }));
    await useForgeStore.getState().refreshTokenStatus("github.com");
    expect(useForgeStore.getState().accounts["github.com"]).toEqual([
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("setHostKind persists and re-runs detection", async () => {
    mockInvoke("forge_detect", () => ({ ...SELF_HOSTED, kind: "GitLab" }));
    mockInvoke("forge_token_status", () => ({
      host: "git.example.com",
      signedIn: false,
      login: null,
    }));
    useForgeStore.setState({ repoId: "r1", detection: SELF_HOSTED });
    useForgeStore.getState().setHostKind("git.example.com", "GitLab");
    // Persisted immediately, so a restart does not ask again.
    expect(localStorage.getItem("pg-forge-hosts")).toContain("GitLab");
    // Detection re-runs so the screen picks the kind up without a manual refresh.
    await Promise.resolve();
    await Promise.resolve();
    expect(getInvokeCalls().map((c) => c.cmd)).toContain("forge_detect");
  });
});

describe("every token-using call names the active account", () => {
  beforeEach(() => {
    reset();
    useForgeStore.setState({
      repoId: "r1",
      detection: GH_DETECTION,
      forge: {
        host: "github.com",
        owner: "jonassaa",
        name: "platypusgit",
        kind: "GitHub",
      },
      signedIn: true,
      accounts: {
        "github.com": [
          acct({ id: "acc-1", login: "work", active: false }),
          acct({ id: "acc-2", login: "personal" }),
        ],
      },
    });
  });

  it("detect asks about the active slot, not the host as a whole", async () => {
    mockInvoke("forge_detect", () => GH_DETECTION);
    mockInvoke("forge_token_status", () => ({
      host: "github.com",
      signedIn: false,
      login: null,
    }));
    await useForgeStore.getState().detect("r1");
    const call = getInvokeCalls().find((c) => c.cmd === "forge_token_status");
    expect(call?.args.account).toBe("acc-2");
  });

  it("refresh lists the active account's requests", async () => {
    mockInvoke("forge_list_pull_requests", () => [pr()]);
    await useForgeStore.getState().refresh();
    const call = getInvokeCalls().find((c) => c.cmd === "forge_list_pull_requests");
    expect(call?.args.account).toBe("acc-2");
  });

  it("loadChecks uses the active account", async () => {
    useForgeStore.setState({ pulls: [pr()] });
    mockInvoke("forge_pull_request_checks", () => ({
      state: "Success",
      total: 1,
      label: "success",
    }));
    await useForgeStore.getState().loadChecks(118);
    const call = getInvokeCalls().find((c) => c.cmd === "forge_pull_request_checks");
    expect(call?.args.account).toBe("acc-2");
  });

  it("create opens the request as the active account", async () => {
    mockInvoke("forge_create_pull_request", () => pr({ number: 121 }));
    await useForgeStore.getState().create({
      title: "t",
      body: "",
      sourceBranch: "feat/x",
      targetBranch: "main",
      draft: false,
    });
    const call = getInvokeCalls().find((c) => c.cmd === "forge_create_pull_request");
    expect(call?.args.account).toBe("acc-2");
  });

  it("falls back to the pre-#233 slot when the host has no account list", async () => {
    // Cleared localStorage with the keychain intact: null is the slot a released
    // build actually stored the token in, so this still finds it.
    useForgeStore.setState({ accounts: {} });
    mockInvoke("forge_list_pull_requests", () => []);
    await useForgeStore.getState().refresh();
    const call = getInvokeCalls().find((c) => c.cmd === "forge_list_pull_requests");
    expect(call?.args.account).toBeNull();
  });
});

describe("openInBrowser", () => {
  beforeEach(reset);

  it("goes through open_url, the one validated opener path", async () => {
    mockInvoke("open_url", () => null);
    await useForgeStore.getState().openInBrowser(pr());
    const call = getInvokeCalls().find((c) => c.cmd === "open_url");
    expect(call?.args.url).toBe(
      "https://github.com/jonassaa/platypusgit/pull/118",
    );
  });

  it("reports a rejected url instead of failing silently", async () => {
    mockInvoke("open_url", () => {
      throw { kind: "InvalidUrl", message: "refusing to open a non-https url" };
    });
    await useForgeStore.getState().openInBrowser(pr({ url: "http://x/y" }));
    expect(useForgeStore.getState().error).toContain("non-https");
  });
});
