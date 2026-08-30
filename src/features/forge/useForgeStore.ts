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

/** One localStorage key for the whole account map. */
const HOSTS_KEY = "pg-forge-hosts";

interface PersistedHosts {
  /** Host → forge, for self-hosted instances a URL cannot classify. */
  hostKinds: Record<string, ForgeKind>;
  /** Host → login, so "signed in as X" needs no network call at startup. */
  logins: Record<string, string>;
}

function loadHosts(): PersistedHosts {
  const empty: PersistedHosts = { hostKinds: {}, logins: {} };
  try {
    const raw = localStorage.getItem(HOSTS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedHosts>;
    return {
      hostKinds: parsed.hostKinds ?? {},
      logins: parsed.logins ?? {},
    };
  } catch {
    // A corrupt blob must not stop the feature from working; start clean.
    return empty;
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
  logins: Record<string, string>;
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
  signIn: (host: string, kind: ForgeKind, token: string) => Promise<boolean>;
  validate: (host: string, kind: ForgeKind) => Promise<void>;
  signOut: (host: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

/** Detection + a known kind, or null. */
function toForge(d: ForgeDetection | null): ForgeRepo | null {
  if (!d || !d.kind) return null;
  return { host: d.host, owner: d.owner, name: d.name, kind: d.kind };
}

const initial = loadHosts();

export const useForgeStore = create<ForgeState>((set, get) => ({
  repoId: null,
  detection: null,
  forge: null,
  signedIn: false,
  pulls: [],
  selected: null,
  checks: {},
  hostKinds: initial.hostKinds,
  logins: initial.logins,
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
      // authenticated request just to render an empty state.
      const status = await forgeTokenStatus(forge.host);
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
      const pulls = await forgeListPullRequests(forge);
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
      const summary = await forgePullRequestChecks(forge, pr.sha);
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
      const created = await forgeCreatePullRequest(forge, input);
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
    saveHosts({ hostKinds, logins: get().logins });
    // Re-run detection so the screen picks the kind up without a manual refresh.
    void get().detect(get().repoId);
  },

  async refreshTokenStatus(host) {
    try {
      const status = await forgeTokenStatus(host);
      if (get().forge?.host === host) set({ signedIn: status.signedIn });
      if (!status.signedIn && get().logins[host]) {
        const logins = { ...get().logins };
        delete logins[host];
        set({ logins });
        saveHosts({ hostKinds: get().hostKinds, logins });
      }
    } catch (e) {
      set({ error: appErrorMessage(e) });
    }
  },

  async signIn(host, kind, token) {
    set({ authBusy: true, error: null });
    try {
      const identity = await forgeSignIn(host, kind, token);
      const logins = { ...get().logins, [host]: identity.login };
      // Signing in to a host also settles what forge it is.
      const hostKinds = { ...get().hostKinds, [host]: kind };
      set({ authBusy: false, logins, hostKinds });
      saveHosts({ hostKinds, logins });
      if (get().detection?.host === host) await get().detect(get().repoId);
      return true;
    } catch (e) {
      set({ authBusy: false, error: appErrorMessage(e) });
      return false;
    }
  },

  async validate(host, kind) {
    set({ authBusy: true, error: null });
    try {
      const identity = await forgeValidateToken(host, kind);
      const logins = { ...get().logins, [host]: identity.login };
      set({ authBusy: false, logins, signedIn: get().forge?.host === host ? true : get().signedIn });
      saveHosts({ hostKinds: get().hostKinds, logins });
    } catch (e) {
      const logins = { ...get().logins };
      delete logins[host];
      saveHosts({ hostKinds: get().hostKinds, logins });
      set({
        authBusy: false,
        logins,
        signedIn: get().forge?.host === host ? false : get().signedIn,
        error: appErrorMessage(e),
      });
    }
  },

  async signOut(host) {
    set({ authBusy: true, error: null });
    try {
      await forgeSignOut(host);
    } catch (e) {
      set({ error: appErrorMessage(e) });
    }
    const logins = { ...get().logins };
    delete logins[host];
    saveHosts({ hostKinds: get().hostKinds, logins });
    set({
      authBusy: false,
      logins,
      signedIn: get().forge?.host === host ? false : get().signedIn,
      pulls: get().forge?.host === host ? [] : get().pulls,
      checks: {},
    });
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
}));
