// Forge accounts: host → MANY, with one active (#233, forge half).
//
// ## What changed and why the id matters
//
// Until now `pg-forge-hosts` persisted `logins: Record<string, string>` — one
// login per host, singular. Two GitHub accounts (the mundane work/personal
// split this issue is about) were not expressible at all, because the forge
// token they authenticate with was stored under a single per-host credential
// key.
//
// So an account is now a SLOT, and `id` is the slot's name. It is the
// discriminator the backend appends to the credential username
// (`platypusgit-forge:<id>`), which is what lets one host hold two tokens
// without either overwriting the other.
//
// **`id: null` is the pre-#233 slot** — the bare `platypusgit-forge` username a
// released build already wrote real tokens under. Migration therefore lands the
// existing login on `id: null` and nothing else: any other id would point at a
// slot that has never held anything, and a user who never signed out would come
// back signed out. Nothing ever mints `null` for a new account; it only ever
// arrives from migration and is only ever read.
//
// ## Why the active account is a flag, not a pointer
//
// A `Record<host, accountId>` pointer has two states this does not: dangling
// (naming an account that was removed) and ambiguous (`null` meaning both "the
// legacy slot" and "nothing recorded"). A flag on the row cannot dangle, and
// `parseHosts` normalises "none flagged" and "two flagged" to exactly one, so
// every host with accounts has an active one by construction.
//
// Nothing here touches a token. The id is a storage slot name, never a secret,
// and no command returns a token to compare against.

import type { ForgeKind } from "@/lib/types";

/** One signed-in forge account. */
export interface ForgeAccount {
  /**
   * Credential-slot discriminator, or `null` for the pre-#233 slot.
   *
   * Deliberately NOT the login: a forge login can be renamed while the token
   * stays valid, and a renamed login would orphan the stored token.
   */
  id: string | null;
  /** Who the slot's token authenticates as. Display only. */
  login: string;
  /** Whether API calls for this host use this account. Exactly one per host. */
  active: boolean;
}

/** The whole `pg-forge-hosts` blob. */
export interface PersistedHosts {
  /** Host → forge, for self-hosted instances a URL cannot classify. */
  hostKinds: Record<string, ForgeKind>;
  /** Host → its accounts, so "signed in as X" needs no network call at startup. */
  accounts: Record<string, ForgeAccount[]>;
}

/** One localStorage key for the whole account map. */
export const HOSTS_KEY = "pg-forge-hosts";

const EMPTY: PersistedHosts = { hostKinds: {}, accounts: {} };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v !== "";
}

/**
 * Coerce one host's stored value into a usable account list.
 *
 * Every rule here exists because the blob is user-writable state that survives
 * across versions: an entry that is not an object, has no login, or repeats a
 * slot id is dropped rather than rendered as a broken row.
 */
export function normalizeAccounts(value: unknown): ForgeAccount[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string | null>();
  const list: ForgeAccount[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (!nonEmptyString(entry.login)) continue;
    const id =
      entry.id === null || entry.id === undefined
        ? null
        : nonEmptyString(entry.id)
          ? entry.id
          : undefined;
    if (id === undefined) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ id, login: entry.login, active: entry.active === true });
  }
  return withOneActive(list);
}

/** Exactly one active account, or none when the list is empty. */
function withOneActive(list: ForgeAccount[]): ForgeAccount[] {
  if (list.length === 0) return list;
  const i = list.findIndex((a) => a.active);
  const active = i === -1 ? 0 : i;
  return list.map((a, n) => (a.active === (n === active) ? a : { ...a, active: n === active }));
}

/**
 * Read the blob, migrating the pre-#233 `logins` map.
 *
 * Pure and takes the raw string, so the migration is testable without touching
 * localStorage. Every failure mode the old parser tolerated — absent, corrupt,
 * missing keys — still yields a working empty state rather than an exception:
 * a bad blob must never stop the feature from working.
 */
export function parseHosts(raw: string | null): PersistedHosts {
  if (!raw) return { ...EMPTY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
  if (!isRecord(parsed)) return { ...EMPTY };

  const hostKinds = isRecord(parsed.hostKinds)
    ? (parsed.hostKinds as Record<string, ForgeKind>)
    : {};

  const accounts: Record<string, ForgeAccount[]> = {};

  // The old key first, so the new one can overwrite a host both describe: only
  // `accounts` can express two accounts, so it is the more informed of the two.
  if (isRecord(parsed.logins)) {
    for (const [host, login] of Object.entries(parsed.logins)) {
      if (!nonEmptyString(login)) continue;
      // `id: null` — the slot a released build actually stored the token in.
      accounts[host] = [{ id: null, login, active: true }];
    }
  }
  if (isRecord(parsed.accounts)) {
    for (const [host, value] of Object.entries(parsed.accounts)) {
      const list = normalizeAccounts(value);
      if (list.length > 0) accounts[host] = list;
      else delete accounts[host];
    }
  }

  return { hostKinds, accounts };
}

/** The account API calls for `host` use, or null when the host has none. */
export function activeAccount(
  accounts: Record<string, ForgeAccount[]>,
  host: string,
): ForgeAccount | null {
  return (accounts[host] ?? []).find((a) => a.active) ?? null;
}

/**
 * The slot id to hand the backend for `host`.
 *
 * `null` for a host with no accounts is not a gap: it names the pre-#233 slot,
 * which is where a token lives when the account list was lost (cleared
 * localStorage, a fresh profile) but the credential helper still holds one.
 */
export function activeAccountId(
  accounts: Record<string, ForgeAccount[]>,
  host: string,
): string | null {
  return activeAccount(accounts, host)?.id ?? null;
}

let seq = 0;

/**
 * A fresh slot id.
 *
 * Time-based, like `newIdentityId`, so two accounts added in one session cannot
 * collide. Restricted to characters git's line-based credential protocol can
 * carry — the id ends up inside `username=`, and the backend refuses a value
 * with a newline in it.
 */
export function newAccountId(): string {
  seq += 1;
  return `acc-${Date.now().toString(36)}-${seq}`;
}

/**
 * Add or replace an account, and make it the active one.
 *
 * Matching is by id first, then by login: pasting a fresh token for an account
 * whose old one expired arrives as a NEW slot, and leaving the stale row would
 * show the same login twice. The caller erases the token of any slot this
 * collapses — see `useForgeStore.signIn`.
 */
export function upsertAccount(
  list: readonly ForgeAccount[],
  entry: { id: string | null; login: string },
): ForgeAccount[] {
  const next: ForgeAccount = { id: entry.id, login: entry.login, active: true };
  const known = list.some((a) => a.id === entry.id);
  const kept = list.filter((a) => a.id === entry.id || a.login !== entry.login);
  const merged = known ? kept.map((a) => (a.id === entry.id ? next : a)) : [...kept, next];
  // The account just signed in wins the flag, not whichever row held it before.
  return setActiveAccount(merged, entry.id);
}

/** Point the host at another account. A miss is a no-op, never a wipe. */
export function setActiveAccount(
  list: readonly ForgeAccount[],
  id: string | null,
): ForgeAccount[] {
  if (!list.some((a) => a.id === id)) return [...list];
  return list.map((a) => (a.active === (a.id === id) ? a : { ...a, active: a.id === id }));
}

/**
 * Drop one slot, promoting a survivor when the active one went.
 *
 * Signing out of one account must not sign the user out of the others on the
 * same host — the failure the singular `delete logins[host]` could not avoid.
 */
export function removeAccount(
  list: readonly ForgeAccount[],
  id: string | null,
): ForgeAccount[] {
  return withOneActive(list.filter((a) => a.id !== id).map((a) => ({ ...a })));
}
