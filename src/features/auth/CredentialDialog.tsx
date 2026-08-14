import React from "react";
import { PGButton, PGCheckbox, PGInput, PGModal } from "@/design";
import { useAuthStore } from "./useAuthStore";

/**
 * Collects a credential for a failed network op and hands it to the retry
 * (#61 D5).
 *
 * The secret is component state and is never written to the store, so nothing
 * sensitive outlives this component. Cancelling retries nothing — the original
 * error surfaces through the normal banner path.
 */
export function CredentialDialog() {
  const challenge = useAuthStore((s) => s.challenge);
  const dismiss = useAuthStore((s) => s.dismiss);

  const [username, setUsername] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [remember, setRemember] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // A fresh challenge must not inherit the previous one's typed values.
  React.useEffect(() => {
    setUsername("");
    setSecret("");
    setReveal(false);
    setRemember(false);
    setBusy(false);
  }, [challenge]);

  if (!challenge) return null;

  // An SSH passphrase has no username; asking for one would be noise.
  const wantsUsername = challenge.kind === "Https";
  const where = challenge.host ? ` for ${challenge.host}` : "";
  const title =
    challenge.kind === "SshPassphrase"
      ? `Unlock SSH key${where}`
      : `Sign in${where}`;
  const body =
    challenge.kind === "SshKey"
      ? "The server rejected the SSH key that was offered. Enter a passphrase if the key is encrypted, or configure a key it will accept."
      : challenge.kind === "SshPassphrase"
        ? "Your SSH key is encrypted. Enter its passphrase to continue."
        : "Use a personal access token as the password — most hosts no longer accept account passwords over HTTPS.";

  const submit = async () => {
    if (!secret || busy) return;
    setBusy(true);
    const creds = wantsUsername
      ? { username: username.trim() || undefined, secret }
      : { secret };
    const doRetry = challenge.retry;
    // Clear before awaiting: the dialog's job is done, and leaving it mounted
    // over a long fetch reads as if nothing happened.
    dismiss();
    await doRetry(creds, remember);
  };

  return (
    <PGModal onCancel={dismiss} width={460}>
      <div
        data-testid="credential-dialog"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: "var(--fs-14)", color: "var(--fg-0)" }}>
          {title}
        </div>
        <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}>
          {body}
        </div>

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
            Cancel
          </PGButton>
          <PGButton
            variant="primary"
            disabled={!secret || busy}
            onClick={() => void submit()}
            data-testid="credential-submit"
          >
            Sign in
          </PGButton>
        </div>
      </div>
    </PGModal>
  );
}
