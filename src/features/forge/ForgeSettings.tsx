// The forge-account control, rendered inside the Settings screen (#92).
//
// State lives in `useForgeStore`, NOT `useSettingsStore`: that store is the
// preferences store (appearance, diff, pull mode), and a list of signed-in hosts
// is not a preference. Per-feature Zustand is the stated convention.
//
// SECURITY: the token is component state and is handed straight to
// `forge_sign_in`. It is never put in the store (a devtools snapshot or a future
// persistence middleware would pick it up), never logged, and no command can
// read one back out.

import React from "react";

import { PGButton, PGIcon, PGInput, PGSelect, pgConfirm, pgFlash } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { ForgeKind } from "@/lib/types";
import { forgeLabel } from "./forgeLabels";
import { useForgeStore } from "./useForgeStore";

/** Where a user goes to mint the token, per forge. */
const TOKEN_DOC: Record<ForgeKind, string> = {
  GitHub: "GitHub → Settings → Developer settings → Personal access tokens (scope: repo)",
  GitLab: "GitLab → Preferences → Access tokens (scopes: api, read_repository)",
};

export function ForgeSettings() {
  const repoId = useRepoStore((s) => s.current?.id ?? null);
  const detection = useForgeStore((s) => s.detection);
  const logins = useForgeStore((s) => s.logins);
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
    Object.keys(logins).forEach((h) => set.add(h));
    return [...set].sort();
  }, [detection, hostKinds, logins]);

  return (
    <div data-testid="settings-forge">
      <Section
        title="Integrations"
        subtitle="Pull and merge requests. A forge API token is a separate credential from the one git pushes with — it is stored under its own key and never replaces it."
      >
        {hosts.length === 0 && (
          <Row
            label="No forge detected"
            hint="Open a repository whose remote points at GitHub or GitLab, and its host appears here."
            control={<span />}
          />
        )}
        {hosts.map((host) => (
          <HostRow
            key={host}
            host={host}
            login={logins[host] ?? null}
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

function HostRow({
  host,
  login,
  kind,
  busy,
  isCurrent,
  currentSignedIn,
}: {
  host: string;
  login: string | null;
  kind: ForgeKind | undefined;
  busy: boolean;
  isCurrent: boolean;
  currentSignedIn: boolean;
}) {
  const [token, setToken] = React.useState("");
  const [pickedKind, setPickedKind] = React.useState<ForgeKind>(kind ?? "GitHub");

  // A self-hosted host has no login yet AND no known forge — asking which one it
  // is has to come before asking for a token, or the token goes to the wrong API.
  const needsKind = !kind;
  const effectiveKind = kind ?? pickedKind;
  // A stored login is the strongest "signed in" signal we have without a network
  // call; the current host also has a live presence check.
  const isSignedIn = !!login || (isCurrent && currentSignedIn);

  const submit = async () => {
    const value = token.trim();
    if (!value) return;
    if (needsKind) useForgeStore.getState().setHostKind(host, pickedKind);
    const ok = await useForgeStore.getState().signIn(host, effectiveKind, value);
    // Clear the field either way: a rejected token must not sit in the DOM.
    setToken("");
    if (ok) pgFlash(`Signed in to ${host}`);
  };

  const remove = async () => {
    if (
      !(await pgConfirm({
        title: `Remove the ${forgeLabel(effectiveKind)} token for ${host}?`,
        body: "Pull and merge requests for this host stop loading until you add a token again. Your git push credential is a separate credential and is not touched.",
        danger: true,
        confirmLabel: "Remove token",
      }))
    ) {
      return;
    }
    await useForgeStore.getState().signOut(host);
    pgFlash(`Removed the token for ${host}`);
  };

  return (
    <Row
      label={host}
      hint={
        isSignedIn ? (
          <span data-testid={`forge-signed-in-${host}`}>
            <PGIcon
              name="check"
              size={11}
              style={{ color: "var(--git-added)", marginRight: 4 }}
            />
            {forgeLabel(effectiveKind)} — signed in
            {login ? (
              <>
                {" as "}
                <code style={{ fontFamily: "var(--font-mono)" }}>{login}</code>
              </>
            ) : null}
          </span>
        ) : (
          <span data-testid={`forge-signed-out-${host}`}>
            {needsKind
              ? "platypusgit cannot tell a self-hosted GitHub from a GitLab by its URL — pick the forge, then paste a token."
              : TOKEN_DOC[effectiveKind]}
          </span>
        )
      }
      control={
        isSignedIn ? (
          <div style={{ display: "flex", gap: 6 }}>
            <PGButton
              size="sm"
              variant="default"
              onClick={() => void useForgeStore.getState().validate(host, effectiveKind)}
              disabled={busy}
              data-testid={`forge-recheck-${host}`}
            >
              Re-check
            </PGButton>
            <PGButton
              size="sm"
              variant="ghost"
              onClick={() => void remove()}
              disabled={busy}
              data-testid={`forge-remove-${host}`}
            >
              Remove token
            </PGButton>
          </div>
        ) : (
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
}: {
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div
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
            fontSize: "var(--fs-13)",
            color: "var(--fg-0)",
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
          }}
        >
          {label}
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
