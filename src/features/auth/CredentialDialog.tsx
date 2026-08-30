import React from "react";
import { PGButton, PGCheckbox, PGInput, PGModal } from "@/design";
import { SshKeyPanel } from "./SshKeyPanel";
import { useAuthStore } from "./useAuthStore";
import { useSshKeyStore } from "./useSshKeyStore";

/**
 * Collects a credential for a failed network op and hands it to the retry
 * (#61 D5), and — for an SSH challenge — offers the key setup that makes the
 * retry possible at all (#248).
 *
 * The secret is component state and is never written to the store, so nothing
 * sensitive outlives this component. Cancelling retries nothing — the original
 * error surfaces through the normal banner path.
 */
export function CredentialDialog() {
  const challenge = useAuthStore((s) => s.challenge);
  const dismiss = useAuthStore((s) => s.dismiss);
  const resetSshKeys = useSshKeyStore((s) => s.reset);

  const [username, setUsername] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [remember, setRemember] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // A rejected PUBLIC key is not a passphrase problem, so on an `SshKey`
  // challenge the box starts folded away behind this and the key panel leads.
  const [wantsSecret, setWantsSecret] = React.useState(false);

  // A fresh challenge must not inherit the previous one's typed values, and
  // must not inherit the previous host's key status either — the panel reloads
  // for the host it is now looking at.
  React.useEffect(() => {
    setUsername("");
    setSecret("");
    setReveal(false);
    setRemember(false);
    setBusy(false);
    setWantsSecret(false);
    resetSshKeys();
  }, [challenge, resetSshKeys]);

  if (!challenge) return null;

  // An SSH passphrase has no username; asking for one would be noise.
  const wantsUsername = challenge.kind === "Https";
  const isSsh = challenge.kind !== "Https";
  // Everything except a rejected public key leads with the secret box.
  const secretLeads = challenge.kind !== "SshKey" || wantsSecret;
  const where = challenge.host ? ` for ${challenge.host}` : "";
  const title =
    challenge.kind === "SshKey"
      ? `SSH key not accepted${where}`
      : challenge.kind === "SshPassphrase"
        ? `Unlock SSH key${where}`
        : `Sign in${where}`;
  // The SSH kinds get their prose from `SshKeyPanel`, which knows whether a key
  // exists — one sentence, in one place, rather than a generic one here that
  // the panel then contradicts.
  const body =
    challenge.kind === "Https"
      ? "Use a personal access token as the password — most hosts no longer accept account passwords over HTTPS."
      : null;

  // An SSH retry needs no secret: after generating a key and registering it with
  // the host, the operation that just failed is the one that now succeeds, and
  // there is nothing to type. HTTPS still requires one — a blank token would
  // burn an authentication attempt on a credential we know is empty.
  const canSubmit = !busy && (isSsh || Boolean(secret));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const creds = !secret
      ? undefined
      : wantsUsername
        ? { username: username.trim() || undefined, secret }
        : { secret };
    const doRetry = challenge.retry;
    // Clear before awaiting: the dialog's job is done, and leaving it mounted
    // over a long fetch reads as if nothing happened.
    dismiss();
    await doRetry(creds, remember);
  };

  return (
    <PGModal onCancel={dismiss} width={isSsh ? 520 : 460}>
      <div
        data-testid="credential-dialog"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: "var(--fs-14)", color: "var(--fg-0)" }}>
          {title}
        </div>
        {body && (
          <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}>
            {body}
          </div>
        )}

        {isSsh && (
          <SshKeyPanel kind={challenge.kind} host={challenge.host} />
        )}

        {wantsUsername && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
              USERNAME
            </span>
            <PGInput
              value={username}
              onChange={setUsername}
              placeholder="username"
              data-testid="credential-username"
              autoFocus
            />
          </label>
        )}

        {/* On an `SshKey` challenge the passphrase is a long shot — the key was
            rejected, not locked — so it stays one click away instead of being
            the first thing the dialog asks for. */}
        {!secretLeads && (
          <PGButton
            size="sm"
            variant="ghost"
            onClick={() => setWantsSecret(true)}
            data-testid="credential-reveal-secret"
          >
            My key is encrypted — enter a passphrase instead
          </PGButton>
        )}

        {secretLeads && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
              {challenge.kind === "Https" ? "TOKEN OR PASSWORD" : "PASSPHRASE"}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <PGInput
                value={secret}
                onChange={setSecret}
                type={reveal ? "text" : "password"}
                placeholder="••••••••"
                data-testid="credential-secret"
                style={{ flex: 1 }}
                autoFocus={!wantsUsername}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
              <PGButton
                size="sm"
                variant="ghost"
                icon="eye"
                title={reveal ? "Hide" : "Show"}
                onClick={() => setReveal((v) => !v)}
              />
            </div>
          </label>
        )}

        {/* HTTPS only. git's credential helpers store HTTP(S) passwords; an SSH
            key passphrase belongs in ssh-agent, and handing it to `git
            credential approve` would file it as this host's HTTPS password —
            the wrong secret in the wrong store, offered on the next HTTPS
            prompt. `withAuthRetry` enforces the same rule. */}
        {challenge.kind === "Https" && (
          <PGCheckbox
            checked={remember}
            onChange={setRemember}
            label="Remember — stores it with git's own credential helper"
          />
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <PGButton
            variant="ghost"
            onClick={dismiss}
            data-testid="credential-cancel"
          >
            {challenge.kind === "SshKey" && !secretLeads ? "Close" : "Cancel"}
          </PGButton>
          <PGButton
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="credential-submit"
          >
            {isSsh ? "Retry" : "Sign in"}
          </PGButton>
        </div>
      </div>
    </PGModal>
  );
}
