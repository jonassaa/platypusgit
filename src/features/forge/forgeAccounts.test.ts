import { describe, expect, it } from "vitest";

import {
  activeAccount,
  activeAccountId,
  newAccountId,
  parseHosts,
  removeAccount,
  setActiveAccount,
  upsertAccount,
  type ForgeAccount,
} from "./forgeAccounts";

/** The blob a pre-#233 build wrote: one login per host, singular. */
function legacyBlob(logins: Record<string, string>, hostKinds = {}) {
  return JSON.stringify({ hostKinds, logins });
}

function account(over: Partial<ForgeAccount> = {}): ForgeAccount {
  return { id: "acc-1", login: "alice", active: false, ...over };
}

describe("parseHosts — migration from the singular logins map", () => {
  it("keeps a signed-in account signed in, in the LEGACY credential slot", () => {
    // This is the whole migration. `id: null` is not cosmetic: it is what tells
    // the backend to read the token from `username=platypusgit-forge`, where a
    // pre-#233 build put it. Any other id looks in a slot that holds nothing,
    // and the user is silently signed out of a host they never left.
    const hosts = parseHosts(legacyBlob({ "github.com": "jonassaa" }));
    expect(hosts.accounts["github.com"]).toEqual([
      { id: null, login: "jonassaa", active: true },
    ]);
  });

  it("migrates every host in the map, not just the first", () => {
    const hosts = parseHosts(
      legacyBlob({ "github.com": "jonassaa", "gitlab.com": "aasberg" }),
    );
    expect(hosts.accounts["github.com"]?.[0]?.login).toBe("jonassaa");
    expect(hosts.accounts["gitlab.com"]?.[0]?.login).toBe("aasberg");
    expect(activeAccountId(hosts.accounts, "gitlab.com")).toBeNull();
  });

  it("carries hostKinds across untouched", () => {
    const hosts = parseHosts(
      legacyBlob({ "git.example.com": "aasberg" }, { "git.example.com": "GitLab" }),
    );
    expect(hosts.hostKinds).toEqual({ "git.example.com": "GitLab" });
  });

  it("migrates nothing from an empty logins map", () => {
    expect(parseHosts(legacyBlob({}))).toEqual({ hostKinds: {}, accounts: {} });
  });

  it("drops a login that is not a non-empty string", () => {
    const raw = JSON.stringify({
      logins: { "github.com": "", "gitlab.com": 7, "git.example.com": null },
    });
    expect(parseHosts(raw).accounts).toEqual({});
  });
});

describe("parseHosts — the cases the old parser already tolerated", () => {
  it("returns empty for an absent blob", () => {
    expect(parseHosts(null)).toEqual({ hostKinds: {}, accounts: {} });
  });

  it("returns empty for a corrupt blob rather than throwing", () => {
    expect(parseHosts("{not json")).toEqual({ hostKinds: {}, accounts: {} });
  });

  it("returns empty for a blob that parses to a non-object", () => {
    expect(parseHosts("42")).toEqual({ hostKinds: {}, accounts: {} });
    expect(parseHosts("null")).toEqual({ hostKinds: {}, accounts: {} });
    expect(parseHosts('"a string"')).toEqual({ hostKinds: {}, accounts: {} });
  });

  it("returns empty for a blob with neither key", () => {
    expect(parseHosts("{}")).toEqual({ hostKinds: {}, accounts: {} });
  });

  it("ignores a hostKinds that is not an object", () => {
    expect(parseHosts(JSON.stringify({ hostKinds: "GitHub" })).hostKinds).toEqual({});
  });
});

describe("parseHosts — the new shape", () => {
  it("round-trips what saveHosts writes", () => {
    const raw = JSON.stringify({
      hostKinds: { "github.com": "GitHub" },
      accounts: {
        "github.com": [
          { id: null, login: "work", active: false },
          { id: "acc-2", login: "personal", active: true },
        ],
      },
    });
    expect(parseHosts(raw).accounts["github.com"]).toEqual([
      { id: null, login: "work", active: false },
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("makes the first account active when the blob flags none", () => {
    const raw = JSON.stringify({
      accounts: {
        "github.com": [
          { id: "acc-1", login: "work" },
          { id: "acc-2", login: "personal" },
        ],
      },
    });
    // "No active account" would mean every API call falls back to the legacy
    // slot — i.e. a host with two accounts would use neither.
    expect(parseHosts(raw).accounts["github.com"]).toEqual([
      { id: "acc-1", login: "work", active: true },
      { id: "acc-2", login: "personal", active: false },
    ]);
  });

  it("keeps exactly one active account when the blob flags two", () => {
    const raw = JSON.stringify({
      accounts: {
        "github.com": [
          { id: "acc-1", login: "work", active: true },
          { id: "acc-2", login: "personal", active: true },
        ],
      },
    });
    const list = parseHosts(raw).accounts["github.com"];
    expect(list.filter((a) => a.active)).toHaveLength(1);
    expect(list[0].active).toBe(true);
  });

  it("drops entries that are not usable accounts, keeping the rest", () => {
    const raw = JSON.stringify({
      accounts: {
        "github.com": [
          null,
          "alice",
          { login: 3 },
          { id: 5, login: "bob" },
          { id: "acc-9", login: "carol", active: true },
        ],
      },
    });
    expect(parseHosts(raw).accounts["github.com"]).toEqual([
      { id: "acc-9", login: "carol", active: true },
    ]);
  });

  it("drops a duplicate id rather than storing two rows for one slot", () => {
    const raw = JSON.stringify({
      accounts: {
        "github.com": [
          { id: "acc-1", login: "work", active: true },
          { id: "acc-1", login: "stale", active: false },
        ],
      },
    });
    expect(parseHosts(raw).accounts["github.com"]).toHaveLength(1);
  });

  it("drops a host whose account list is not an array, or ends up empty", () => {
    const raw = JSON.stringify({ accounts: { "github.com": "alice", "gitlab.com": [] } });
    expect(parseHosts(raw).accounts).toEqual({});
  });

  it("prefers accounts over logins when a blob somehow carries both", () => {
    // A downgrade-then-upgrade writes the old key back. The new key is the one
    // that can express two accounts, so it wins where both name the same host —
    // and a host only the old key knows is still migrated.
    const raw = JSON.stringify({
      logins: { "github.com": "stale", "gitlab.com": "aasberg" },
      accounts: { "github.com": [{ id: "acc-1", login: "current", active: true }] },
    });
    const { accounts } = parseHosts(raw);
    expect(accounts["github.com"]).toEqual([
      { id: "acc-1", login: "current", active: true },
    ]);
    expect(accounts["gitlab.com"]).toEqual([
      { id: null, login: "aasberg", active: true },
    ]);
  });
});

describe("activeAccount / activeAccountId", () => {
  it("answers with the flagged account", () => {
    const accounts = {
      "github.com": [
        account({ id: "acc-1", login: "work" }),
        account({ id: "acc-2", login: "personal", active: true }),
      ],
    };
    expect(activeAccount(accounts, "github.com")?.login).toBe("personal");
    expect(activeAccountId(accounts, "github.com")).toBe("acc-2");
  });

  it("falls back to the legacy slot for a host with no accounts at all", () => {
    // localStorage cleared, keychain intact: the honest guess is the slot a
    // pre-#233 build used, which is also where a single stored token lives.
    expect(activeAccount({}, "github.com")).toBeNull();
    expect(activeAccountId({}, "github.com")).toBeNull();
  });
});

describe("upsertAccount", () => {
  it("appends a new account and makes it the active one", () => {
    const list = [account({ id: "acc-1", login: "work", active: true })];
    const next = upsertAccount(list, { id: "acc-2", login: "personal" });
    expect(next).toEqual([
      { id: "acc-1", login: "work", active: false },
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("replaces the entry with the same id in place", () => {
    const list = [
      account({ id: "acc-1", login: "work", active: true }),
      account({ id: "acc-2", login: "personal" }),
    ];
    const next = upsertAccount(list, { id: "acc-1", login: "renamed" });
    expect(next.map((a) => a.login)).toEqual(["renamed", "personal"]);
    expect(next[0].active).toBe(true);
  });

  it("collapses a second sign-in for a login that already has a slot", () => {
    // Pasting a fresh token for an account whose old one expired must not leave
    // the host showing the same login twice.
    const list = [account({ id: null, login: "alice", active: true })];
    const next = upsertAccount(list, { id: "acc-7", login: "alice" });
    expect(next).toEqual([{ id: "acc-7", login: "alice", active: true }]);
  });
});

describe("setActiveAccount", () => {
  it("moves the flag without reordering or evicting anything", () => {
    const list = [
      account({ id: "acc-1", login: "work", active: true }),
      account({ id: "acc-2", login: "personal" }),
    ];
    expect(setActiveAccount(list, "acc-2")).toEqual([
      { id: "acc-1", login: "work", active: false },
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("can activate the legacy slot, whose id is null", () => {
    const list = [
      account({ id: null, login: "work" }),
      account({ id: "acc-2", login: "personal", active: true }),
    ];
    expect(setActiveAccount(list, null)[0].active).toBe(true);
  });

  it("leaves the list alone when the id is not in it", () => {
    const list = [account({ id: "acc-1", login: "work", active: true })];
    expect(setActiveAccount(list, "nope")).toEqual(list);
  });
});

describe("removeAccount", () => {
  it("removes only the named slot and promotes a survivor to active", () => {
    const list = [
      account({ id: "acc-1", login: "work", active: true }),
      account({ id: "acc-2", login: "personal" }),
    ];
    // Signing out of one account must not sign the user out of the other — the
    // bug the singular `delete logins[host]` could not avoid.
    expect(removeAccount(list, "acc-1")).toEqual([
      { id: "acc-2", login: "personal", active: true },
    ]);
  });

  it("removes the legacy slot by its null id", () => {
    const list = [
      account({ id: null, login: "work", active: true }),
      account({ id: "acc-2", login: "personal" }),
    ];
    expect(removeAccount(list, null).map((a) => a.id)).toEqual(["acc-2"]);
  });

  it("keeps the active flag where it is when another account goes", () => {
    const list = [
      account({ id: "acc-1", login: "work", active: true }),
      account({ id: "acc-2", login: "personal" }),
    ];
    expect(removeAccount(list, "acc-2")).toEqual([
      { id: "acc-1", login: "work", active: true },
    ]);
  });
});

describe("newAccountId", () => {
  it("never collides and is never the legacy slot", () => {
    const ids = new Set([newAccountId(), newAccountId(), newAccountId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toBeTruthy();
  });

  it("is safe to carry in git's line-based credential protocol", () => {
    // The id becomes part of `username=` in the credential protocol, which the
    // backend refuses if it carries a newline. Generating one that cannot be
    // stored would fail at the last step of a sign-in.
    expect(newAccountId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
