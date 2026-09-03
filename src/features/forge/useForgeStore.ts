// Forge (GitHub / GitLab) feature state (#92).
//
// Lives here rather than in `useSettingsStore` even though the token control
// renders inside Settings: `useSettingsStore` is the PREFERENCES store
// (appearance, diff, pull mode) and a list of signed-in hosts is not a
// preference. Per-feature Zustand is the stated convention.
//
// The store never holds a token. `signIn` hands one straight to the backend and
// keeps only the login it comes back with; nothing in this file can read a token
// out, because no command returns one.
//
// Accounts are host → MANY, with one active per host (#233). The shape, the
// migration from the old singular `logins` map, and why an account id is an
// opaque credential-slot name rather than the login all live in
// `forgeAccounts.ts`. Every token-using call names the active slot, so a host
// with a work and a personal account uses the one the user picked.

import { create } from "zustand";

import {
  forgeCheckoutPullRequest,
  forgeCreatePullRequest,
  forgeDetect,
  forgeListPullRequests,
  forgePullRequestChecks,
  forgeSignIn,
  forgeSignOut,
  forgeTokenStatus,
  forgeValidateToken,
  openUrl,
} from "@/lib/tauri";
import {
  appErrorMessage,
  isBranchExistsError,
  isForgeAuthError,
} from "@/lib/errors";
import { useRepoStore, withAuthRetry } from "@/features/repo/useRepoStore";
import type {
  ChecksSummary,
  ForgeDetection,
  ForgeKind,
  ForgeRepo,
  NewPullRequest,
  PullRequest,
} from "@/lib/types";
import { localBranchFor } from "./forgeLabels";
import {
  activeAccountId,
  HOSTS_KEY,
  newAccountId,
  parseHosts,
  removeAccount,
  setActiveAccount,
  upsertAccount,
  type ForgeAccount,
  type PersistedHosts,
} from "./forgeAccounts";

function loadHosts(): PersistedHosts {
  try {
    // `parseHosts` owns the defensive read AND the migration off the old
    // singular `logins` map — pure, so both are testable without localStorage.
    return parseHosts(localStorage.getItem(HOSTS_KEY));
  } catch {
    // A localStorage that throws (private mode) must not stop the feature.
    return { hostKinds: {}, accounts: {} };
  }
}

function saveHosts(h: PersistedHosts): void {
  try {
    localStorage.setItem(HOSTS_KEY, JSON.stringify(h));
  } catch {
    // non-fatal (private mode, quota)
  }
}

/**
 * How a checkout ended.
 *
 * A boolean cannot carry this: the caller must pop an overwrite confirmation for
 * `branch-exists` but must NOT for `auth-pending`, where the credential dialog is
 * already on screen and the retry will finish out of band. Returning `false` for
 * both is how a "did you mean to overwrite?" dialog would appear on top of a
 * password prompt.
 */
export type CheckoutOutcome = "ok" | "branch-exists" | "auth-pending" | "error";

/**
 * Why the list is empty / disabled. Each value is a different sentence, and
 * three of the five are actionable — "nothing here" with no reason is the state
 * this enum exists to prevent.
 */
export type ForgeGate =
  | "no-repo"
  | "no-forge"
  | "unknown-host"
  | "signed-out"
  | "ready";

export interface ForgeState {
  repoId: string | null;
  detection: ForgeDetection | null;
  /** Detection plus a resolved kind — present only when an API call is possible. */
  forge: ForgeRepo | null;
  signedIn: boolean;
  pulls: PullRequest[];
  selected: number | null;
  checks: Record<number, ChecksSummary>;
  hostKinds: Record<string, ForgeKind>;
  /** Host → its signed-in accounts. Exactly one per host is active. */
  accounts: Record<string, ForgeAccount[]>;
  loading: boolean;
  creating: boolean;
  checkingOut: boolean;
  /** A `forge_validate_token` / `forge_sign_in` round trip is in flight. */
  authBusy: boolean;
  error: string | null;
  createOpen: boolean;
  /** URL of the request created by the last successful `create()`. */
  createdUrl: string | null;

  gate: () => ForgeGate;
  detect: (repoId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  select: (n: number | null) => void;
  loadChecks: (n: number) => Promise<void>;
  /** Only the url is read, so the created-request banner can pass a bare url. */
  openInBrowser: (pr: Pick<PullRequest, "url">) => Promise<void>;
  checkout: (pr: PullRequest, force?: boolean) => Promise<CheckoutOutcome>;
  openCreate: () => void;
  closeCreate: () => void;
  create: (input: NewPullRequest) => Promise<PullRequest | null>;
  setHostKind: (host: string, kind: ForgeKind) => void;
  refreshTokenStatus: (host: string) => Promise<void>;
  /** Take a token, mint it a slot, and make that account the host's active one. */
  signIn: (host: string, kind: ForgeKind, token: string) => Promise<boolean>;
  validate: (host: string, kind: ForgeKind, account: string | null) => Promise<void>;
  signOut: (host: string, account: string | null) => Promise<void>;
  /** Point a host at one of its other accounts. */
  switchAccount: (host: string, account: string | null) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

/** Detection + a known kind, or null. */
function toForge(d: ForgeDetection | null): ForgeRepo | null {
  if (!d || !d.kind) return null;
  return { host: d.host, owner: d.owner, name: d.name, kind: d.kind };
}

const initial = loadHosts();

export const useForgeStore = create<ForgeState>((set, get) => {
  /**
   * Commit one host's account list to state AND localStorage.
   *
   * One writer, because every path that changes an account has to persist it —
   * an account map that only lives in memory silently reverts on restart, and
   * that reads as "it signed me out again". A host with no accounts left drops
   * out of the map entirely rather than persisting an empty array.
   */
  const writeAccounts = (
    host: string,
    list: ForgeAccount[],
    hostKinds?: Record<string, ForgeKind>,
  ): void => {
    const accounts = { ...get().accounts };
    if (list.length === 0) delete accounts[host];
    else accounts[host] = list;
    set({ accounts });
    saveHosts({ hostKinds: hostKinds ?? get().hostKinds, accounts });
  };

  return {
    repoId: null,
    detection: null,
    forge: null,
    signedIn: false,
    pulls: [],
    selected: null,
    checks: {},
    hostKinds: initial.hostKinds,
    accounts: initial.accounts,
    loading: false,
    creating: false,
    checkingOut: false,
    authBusy: false,
    error: null,
    createOpen: false,
    createdUrl: null,

    gate() {
      const s = get();
      if (!s.repoId) return "no-repo";
      if (!s.detection) return "no-forge";
      if (!s.detection.kind) return "unknown-host";
      if (!s.signedIn) return "signed-out";
      return "ready";
    },

    async detect(repoId) {
      if (!repoId) {
        get().reset();
        return;
      }
      set({ repoId, error: null });
      try {
        const detection = await forgeDetect(repoId, get().hostKinds);
        const forge = toForge(detection);
        set({ detection, forge, pulls: [], selected: null, checks: {} });
        if (!forge) {
          set({ signedIn: false });
          return;
        }
        // Presence only — no network, so entering the screen never costs an
        // authenticated request just to render an empty state. Asked about the
        // ACTIVE slot: "does this host have a token" is not the question when the
        // host has two accounts and only one of them is signed in.
        const status = await forgeTokenStatus(
          forge.host,
          activeAccountId(get().accounts, forge.host),
        );
        set({ signedIn: status.signedIn });
        if (status.signedIn) await get().refresh();
      } catch (e) {
        set({ error: appErrorMessage(e) });
      }
    },

    async refresh() {
      const { forge } = get();
      if (!forge) return;
      set({ loading: true, error: null });
      try {
        const pulls = await forgeListPullRequests(
          forge,
          activeAccountId(get().accounts, forge.host),
        );
        set({
          pulls,
          loading: false,
          signedIn: true,
          // Drop a selection that is no longer open.
          selected: pulls.some((p) => p.number === get().selected)
            ? get().selected
            : (pulls[0]?.number ?? null),
        });
      } catch (e) {
        // A rejected/absent token is `ForgeAuth`; fall back to the signed-out
        // gate so the screen offers the fix instead of a bare banner.
        const signedOut = isForgeAuthError(e);
        set({
          loading: false,
          pulls: [],
          signedIn: signedOut ? false : get().signedIn,
          error: signedOut ? null : appErrorMessage(e),
        });
      }
    },

    select(n) {
      set({ selected: n });
    },

    async loadChecks(n) {
      const { forge, pulls, checks } = get();
      if (!forge) return;
      if (checks[n]) return;
      const pr = pulls.find((p) => p.number === n);
      if (!pr?.sha) return;
      try {
        const summary = await forgePullRequestChecks(
          forge,
          pr.sha,
          activeAccountId(get().accounts, forge.host),
        );
        set({ checks: { ...get().checks, [n]: summary } });
      } catch {
        // A missing CI verdict is not worth a banner — the row simply shows none.
      }
    },

    async openInBrowser(pr) {
      try {
        // Goes through `open_url`, i.e. through opener::safe_url — https-only,
        // parsed, no shell. There is deliberately no second path.
        await openUrl(pr.url);
      } catch (e) {
        set({ error: appErrorMessage(e) });
      }
    },

    async checkout(pr, force = false) {
      const { forge, detection, repoId } = get();
      if (!forge || !detection || !repoId) return "error";
      set({ checkingOut: true, error: null });

      // Fetching a request's head ref is an ordinary git-transport operation, so it
      // needs the SAME credential challenge/retry every other network op uses
      // (#61 D5) — reusing `withAuthRetry` rather than growing a second retry path.
      // The forge API token is not a transport credential and is never offered here.
      //
      // `withAuthRetry` resolves as soon as it RAISES a challenge, so "neither
      // branch ran" is the auth-pending signal: `run` sets ok, `onError` sets the
      // failure kinds, and an auth failure leaves the initial value in place.
      let outcome: CheckoutOutcome = "auth-pending";
      await withAuthRetry(
        repoId,
        async (creds) => {
          await forgeCheckoutPullRequest(
            {
              repoId,
              remoteName: detection.remote,
              kind: forge.kind,
              number: pr.number,
              localBranch: localBranchFor(pr, forge.kind),
              force,
            },
            creds,
          );
          // Inside the retried closure, per the network-op convention: the retry
          // path has no other way to reflect the new branch.
          await useRepoStore.getState().refreshAll();
          outcome = "ok";
        },
        (e) => {
          // The caller confirms and retries with force — the store must not open a
          // dialog itself, or it stops being unit-testable.
          if (isBranchExistsError(e)) {
            outcome = "branch-exists";
            return;
          }
          outcome = "error";
          set({ error: appErrorMessage(e) });
        },
        // `checkingOut` drives this panel's own button; the `activity` entry is
        // what reaches the status bar and the Cancel button (#296). Fetching a
        // pull request's head ref is an ordinary transfer and can stall like one.
        { key: "forge", label: `Checking out #${pr.number}…` },
      );
      set({ checkingOut: false });
      return outcome;
    },

    openCreate() {
      set({ createOpen: true, createdUrl: null, error: null });
    },

    closeCreate() {
      set({ createOpen: false });
    },

    async create(input) {
      const { forge } = get();
      if (!forge) return null;
      set({ creating: true, error: null, createdUrl: null });
      try {
        const created = await forgeCreatePullRequest(
          forge,
          input,
          activeAccountId(get().accounts, forge.host),
        );
        set({
          creating: false,
          createOpen: false,
          createdUrl: created.url,
          pulls: [created, ...get().pulls.filter((p) => p.number !== created.number)],
          selected: created.number,
        });
        return created;
      } catch (e) {
        set({ creating: false, error: appErrorMessage(e) });
        return null;
      }
    },

    setHostKind(host, kind) {
      const hostKinds = { ...get().hostKinds, [host]: kind };
      set({ hostKinds });
      saveHosts({ hostKinds, accounts: get().accounts });
      // Re-run detection so the screen picks the kind up without a manual refresh.
      void get().detect(get().repoId);
    },

    async refreshTokenStatus(host) {
      try {
        const slot = activeAccountId(get().accounts, host);
        const status = await forgeTokenStatus(host, slot);
        if (get().forge?.host === host) set({ signedIn: status.signedIn });
        // An empty slot forgets THAT account only. Dropping every account on the
        // host — what the singular `logins` map had to do — would sign the user
        // out of a second account whose token is perfectly fine.
        if (!status.signedIn && (get().accounts[host] ?? []).length > 0) {
          writeAccounts(host, removeAccount(get().accounts[host] ?? [], slot));
        }
      } catch (e) {
        set({ error: appErrorMessage(e) });
      }
    },

    async signIn(host, kind, token) {
      set({ authBusy: true, error: null });
      // A fresh slot every time, so a second token for the same host cannot
      // overwrite the first account's. Which login it turns out to be is the
      // forge's answer, not something we can know before validating.
      const slot = newAccountId();
      try {
        const identity = await forgeSignIn(host, kind, token, slot);
        const before = get().accounts[host] ?? [];
        // Re-authenticating an account whose token expired arrives as a new slot;
        // `upsertAccount` collapses it onto the login's existing row, and the slot
        // it displaced still holds a dead token, so erase it. Best-effort: the
        // sign-in succeeded, and a helper that cannot erase must not fail it.
        const displaced = before.filter((a) => a.login === identity.login && a.id !== slot);
        const accounts = upsertAccount(before, { id: slot, login: identity.login });
        // Signing in to a host also settles what forge it is.
        const hostKinds = { ...get().hostKinds, [host]: kind };
        set({ authBusy: false, hostKinds });
        writeAccounts(host, accounts, hostKinds);
        for (const old of displaced) {
          try {
            await forgeSignOut(host, old.id);
          } catch {
            // The account row is already gone; a stale keychain entry is not
            // worth failing a successful sign-in over.
          }
        }
        if (get().detection?.host === host) await get().detect(get().repoId);
        return true;
      } catch (e) {
        set({ authBusy: false, error: appErrorMessage(e) });
        return false;
      }
    },

    async validate(host, kind, account) {
      set({ authBusy: true, error: null });
      const isActive = activeAccountId(get().accounts, host) === account;
      try {
        const identity = await forgeValidateToken(host, kind, account);
        // Rename in place: re-checking the personal account must not steal the
        // active flag from the work one.
        const accounts = (get().accounts[host] ?? []).map((a) =>
          a.id === account ? { ...a, login: identity.login } : a,
        );
        set({
          authBusy: false,
          signedIn:
            isActive && get().forge?.host === host ? true : get().signedIn,
        });
        writeAccounts(host, accounts);
      } catch (e) {
        // Only the slot the forge rejected goes. The other account on the same
        // host is still signed in.
        writeAccounts(host, removeAccount(get().accounts[host] ?? [], account));
        set({
          authBusy: false,
          signedIn:
            isActive && get().forge?.host === host ? false : get().signedIn,
          error: appErrorMessage(e),
        });
      }
    },

    async signOut(host, account) {
      set({ authBusy: true, error: null });
      try {
        await forgeSignOut(host, account);
      } catch (e) {
        set({ error: appErrorMessage(e) });
      }
      const remaining = removeAccount(get().accounts[host] ?? [], account);
      writeAccounts(host, remaining);
      const isCurrent = get().forge?.host === host;
      set({
        authBusy: false,
        signedIn: isCurrent ? false : get().signedIn,
        pulls: isCurrent ? [] : get().pulls,
        checks: {},
      });
      // A survivor was just promoted to active, so the host is not signed out at
      // all — re-probe with the account that now applies rather than leaving the
      // screen claiming a gate that is no longer true. `detect(null)` RESETS, so
      // the repo has to still be open.
      if (isCurrent && remaining.length > 0 && get().repoId) {
        await get().detect(get().repoId);
      }
    },

    async switchAccount(host, account) {
      const list = get().accounts[host] ?? [];
      if (!list.some((a) => a.id === account)) return;
      writeAccounts(host, setActiveAccount(list, account));
      // The requests on screen belong to the account that just went inactive.
      if (get().detection?.host === host) {
        set({ pulls: [], selected: null, checks: {} });
        await get().detect(get().repoId);
      }
    },

    clearError() {
      set({ error: null });
    },

    reset() {
      set({
        repoId: null,
        detection: null,
        forge: null,
        signedIn: false,
        pulls: [],
        selected: null,
        checks: {},
        loading: false,
        error: null,
        createOpen: false,
        createdUrl: null,
      });
    },
  };
});
