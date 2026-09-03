// The forge-account control, rendered inside the Settings screen (#92, #233).
//
// State lives in `useForgeStore`, NOT `useSettingsStore`: that store is the
// preferences store (appearance, diff, pull mode), and a list of signed-in hosts
// is not a preference. Per-feature Zustand is the stated convention.
//
// A host has MANY accounts (#233), so this renders one row per account plus one
// row for adding another — and the active account is marked, because two logins
// with no "which one am I?" is exactly the confusion the feature exists to
// remove. Removing an account touches ONE credential slot: the other account on
// the same host keeps its token.
//
// SECURITY: the token is component state and is handed straight to
// `forge_sign_in`. It is never put in the store (a devtools snapshot or a future
// persistence middleware would pick it up), never logged, and no command can
// read one back out. An account id is a credential-slot name, never a secret.

import React from "react";

import {
  PGBadge,
  PGButton,
  PGIcon,
  PGInput,
  PGSelect,
  pgConfirm,
  pgFlash,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { ForgeKind } from "@/lib/types";
import type { ForgeAccount } from "./forgeAccounts";
import { forgeLabel } from "./forgeLabels";
import { useForgeStore } from "./useForgeStore";

/**
 * A slot id as a testid / React key fragment.
 *
 * The pre-#233 slot's id is `null` — see `forgeAccounts.ts` — and `null` makes a
 * useless key.
 */
function slotKey(id: string | null): string {
  return id ?? "default";
}

/** Where a user goes to mint the token, per forge. */
const TOKEN_DOC: Record<ForgeKind, string> = {
  GitHub: "GitHub → Settings → Developer settings → Personal access tokens (scope: repo)",
  GitLab: "GitLab → Preferences → Access tokens (scopes: api, read_repository)",
};

export function ForgeSettings() {
  const repoId = useRepoStore((s) => s.current?.id ?? null);
  const detection = useForgeStore((s) => s.detection);
  const accounts = useForgeStore((s) => s.accounts);
  const hostKinds = useForgeStore((s) => s.hostKinds);
  const authBusy = useForgeStore((s) => s.authBusy);
  const signedIn = useForgeStore((s) => s.signedIn);
  const error = useForgeStore((s) => s.error);

  // Detect here too, not only on the Pulls screen: Settings is reachable without
  // ever visiting Pulls (titlebar gear, ⌘,), and with no detection this section
  // would claim "no forge detected" for a repository that has one.
  React.useEffect(() => {
    if (repoId && !useForgeStore.getState().detection) {
      void useForgeStore.getState().detect(repoId);
    }
  }, [repoId]);

  // Hosts worth showing: whatever this repository points at, plus every host the
  // user has already configured or signed in to.
  const hosts = React.useMemo(() => {
    const set = new Set<string>();
    if (detection) set.add(detection.host);
    Object.keys(hostKinds).forEach((h) => set.add(h));
    Object.keys(accounts).forEach((h) => set.add(h));
    return [...set].sort();
  }, [detection, hostKinds, accounts]);

  return (
    <div data-testid="settings-forge">
      <Section
        title="Integrations"
        subtitle="Pull and merge requests. A forge API token is a separate credential from the one git pushes with — it is stored under its own key and never replaces it. A host can hold several accounts; the active one is what pull requests are listed and opened as."
      >
        {hosts.length === 0 && (
          <Row
            label="No forge detected"
            hint="Open a repository whose remote points at GitHub or GitLab, and its host appears here."
            control={<span />}
          />
        )}
        {hosts.map((host) => (
          <HostSection
            key={host}
            host={host}
            accounts={accounts[host] ?? []}
            kind={hostKinds[host] ?? builtinKindFor(host)}
            busy={authBusy}
            isCurrent={detection?.host === host}
            currentSignedIn={signedIn}
          />
        ))}
        {error && (
          <Row
            label="Last error"
            hint={<span style={{ color: "var(--git-removed)" }}>{error}</span>}
            control={
              <PGButton
                size="sm"
                variant="ghost"
                onClick={() => useForgeStore.getState().clearError()}
              >
                Dismiss
              </PGButton>
            }
          />
        )}
      </Section>
    </div>
  );
}

/** Hosts whose forge is known without configuration — mirrors the Rust map. */
function builtinKindFor(host: string): ForgeKind | undefined {
  const bare = host.split(":")[0].toLowerCase();
  if (bare === "github.com" || bare === "www.github.com") return "GitHub";
  if (bare === "gitlab.com" || bare === "www.gitlab.com") return "GitLab";
  return undefined;
}

/** Every account on one host, then the row that adds another. */
function HostSection({
  host,
  accounts,
  kind,
  busy,
  isCurrent,
  currentSignedIn,
}: {
  host: string;
  accounts: ForgeAccount[];
  kind: ForgeKind | undefined;
  busy: boolean;
  isCurrent: boolean;
  currentSignedIn: boolean;
}) {
  const [pickedKind, setPickedKind] = React.useState<ForgeKind>(kind ?? "GitHub");
  // A self-hosted host has no known forge — asking which one it is has to come
  // before asking for a token, or the token goes to the wrong API.
  const needsKind = !kind;
  const effectiveKind = kind ?? pickedKind;

  return (
    <>
      {accounts.map((account) => (
        <AccountRow
          key={slotKey(account.id)}
          host={host}
          account={account}
          kind={effectiveKind}
          busy={busy}
          isCurrent={isCurrent}
        />
      ))}
      <AddAccountRow
        host={host}
        hasAccounts={accounts.length > 0}
        needsKind={needsKind}
        effectiveKind={effectiveKind}
        pickedKind={pickedKind}
        setPickedKind={setPickedKind}
        busy={busy}
        // Only read when the host has no accounts: a live token with no account
        // record (cleared localStorage, keychain intact) is worth saying out
        // loud, because pull requests keep working while Settings shows nothing.
        hasUnnamedToken={isCurrent && currentSignedIn}
      />
    </>
  );
}

function AccountRow({
  host,
  account,
  kind,
  busy,
  isCurrent,
}: {
  host: string;
  account: ForgeAccount;
  kind: ForgeKind;
  busy: boolean;
  isCurrent: boolean;
}) {
  const key = slotKey(account.id);

  const remove = async () => {
    if (
      !(await pgConfirm({
        title: `Remove the ${forgeLabel(kind)} token for ${account.login} on ${host}?`,
        body: "Pull and merge requests open as this account stop loading until you add a token again. Any other account on this host, and your git push credential, are separate credentials and are not touched.",
        danger: true,
        confirmLabel: "Remove token",
      }))
    ) {
      return;
    }
    await useForgeStore.getState().signOut(host, account.id);
    pgFlash(`Removed the token for ${account.login} on ${host}`);
  };

  return (
    <Row
      label={account.login}
      testId={`forge-account-${host}-${key}`}
      hint={
        <span
          // The active account answers "is this host signed in", so it keeps the
          // per-host testid the rest of the app and the e2e suite look for.
          data-testid={account.active ? `forge-signed-in-${host}` : undefined}
        >
          <PGIcon
            name="check"
            size={11}
            style={{ color: "var(--git-added)", marginRight: 4 }}
          />
          {forgeLabel(kind)} — signed in as{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>{account.login}</code>
          {" on "}
          {host}
        </span>
      }
      badge={
        account.active ? (
          <PGBadge tone="accent" style={{ marginLeft: 8 }}>
            Active
          </PGBadge>
        ) : null
      }
      control={
        <div style={{ display: "flex", gap: 6 }}>
          {!account.active && (
            <PGButton
              size="sm"
              variant="default"
              onClick={() =>
                void useForgeStore.getState().switchAccount(host, account.id)
              }
              disabled={busy}
              data-testid={`forge-use-${host}-${key}`}
            >
              Use
            </PGButton>
          )}
          <PGButton
            size="sm"
            variant={account.active && isCurrent ? "default" : "ghost"}
            onClick={() =>
              void useForgeStore.getState().validate(host, kind, account.id)
            }
            disabled={busy}
            data-testid={`forge-recheck-${host}-${key}`}
          >
            Re-check
          </PGButton>
          <PGButton
            size="sm"
            variant="ghost"
            onClick={() => void remove()}
            disabled={busy}
            data-testid={`forge-remove-${host}-${key}`}
          >
            Remove token
          </PGButton>
        </div>
      }
    />
  );
}

function AddAccountRow({
  host,
  hasAccounts,
  needsKind,
  effectiveKind,
  pickedKind,
  setPickedKind,
  busy,
  hasUnnamedToken,
}: {
  host: string;
  hasAccounts: boolean;
  needsKind: boolean;
  effectiveKind: ForgeKind;
  pickedKind: ForgeKind;
  setPickedKind: (k: ForgeKind) => void;
  busy: boolean;
  hasUnnamedToken: boolean;
}) {
  const [token, setToken] = React.useState("");
  // A password box sitting permanently open under every signed-in host is
  // noise; a host with nothing signed in still gets the field directly, because
  // that IS the thing to do there.
  const [open, setOpen] = React.useState(false);
  const showField = !hasAccounts || open;

  const submit = async () => {
    const value = token.trim();
    if (!value) return;
    if (needsKind) useForgeStore.getState().setHostKind(host, pickedKind);
    const ok = await useForgeStore.getState().signIn(host, effectiveKind, value);
    // Clear the field either way: a rejected token must not sit in the DOM.
    setToken("");
    if (ok) {
      setOpen(false);
      pgFlash(`Signed in to ${host}`);
    }
  };

  return (
    <Row
      label={host}
      hint={
        hasAccounts ? (
          "Add another account on this host — a work login and a personal one can both be signed in, and you pick which one is active."
        ) : (
          <span data-testid={`forge-signed-out-${host}`}>
            {needsKind
              ? "platypusgit cannot tell a self-hosted GitHub from a GitLab by its URL — pick the forge, then paste a token."
              : TOKEN_DOC[effectiveKind]}
            {hasUnnamedToken
              ? " A token is already stored for this host but not the account it belongs to — sign in again to name it."
              : ""}
          </span>
        )
      }
      control={
        showField ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {needsKind && (
              <PGSelect
                size="sm"
                value={pickedKind}
                onChange={(v) => setPickedKind(v as ForgeKind)}
                options={[
                  { value: "GitHub", label: "GitHub" },
                  { value: "GitLab", label: "GitLab" },
                ]}
                data-testid={`forge-kind-${host}`}
              />
            )}
            <PGInput
              size="sm"
              value={token}
              onChange={setToken}
              placeholder="API token"
              mono
              // type=password so a screen share or a screenshot of Settings does
              // not carry the secret.
              type="password"
              autoComplete="off"
              style={{ width: 200 }}
              data-testid={`forge-token-${host}`}
            />
            <PGButton
              size="sm"
              variant="primary"
              onClick={() => void submit()}
              disabled={busy || !token.trim()}
              loading={busy}
              data-testid={`forge-signin-${host}`}
            >
              Sign in
            </PGButton>
          </div>
        ) : (
          <PGButton
            size="sm"
            variant="default"
            onClick={() => setOpen(true)}
            disabled={busy}
            data-testid={`forge-add-${host}`}
          >
            Add account
          </PGButton>
        )
      }
    />
  );
}

// ─── Local copies of the Settings screen's layout helpers ────────────────────
// Same shape as `Section` / `Row` in screens/Settings.tsx. Kept local rather than
// exported from there so this feature does not import from a screen; the screen
// owns its own layout, this owns its own.

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: 20,
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-4)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border-0)",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--fg-1)",
            fontWeight: 600,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--fs-12)",
              color: "var(--fg-3)",
            }}
          >
            {subtitle}
          </div>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  control,
  badge,
  testId,
}: {
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  /** Sits beside the label — "Active", not a second line of prose. */
  badge?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-0)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: "var(--fs-13)",
            color: "var(--fg-0)",
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
          }}
        >
          {label}
          {badge}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 3,
              fontSize: "var(--fs-11)",
              color: "var(--fg-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>{control}</div>
    </div>
  );
}
