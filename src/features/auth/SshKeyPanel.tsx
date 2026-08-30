import React from "react";
import { PGButton, PGIcon, PGInput, pgFlash } from "@/design";
import type { AuthKind } from "@/lib/errors";
import { SSH_KEYGEN_UNAVAILABLE_HELP } from "@/lib/errors";
import { openUrl } from "@/lib/tauri";
import type { SshKeyInfo } from "@/lib/types";
import { sshAdvice } from "./sshAdvice";
import { useSshKeyStore } from "./useSshKeyStore";

/**
 * The SSH half of the credential dialog (#248).
 *
 * Before this, a `Permission denied (publickey)` produced a passphrase box and
 * the sentence "configure a key it will accept" — accurate and useless. This
 * panel answers the three questions that actually stand between the user and a
 * working remote: do I have a key, what is it, and how do I get it onto the
 * host.
 *
 * It renders no secret and stores none. The passphrase for a NEW key is
 * component state here and is handed straight to the store's `generate`, the
 * same rule the credential secret follows one level up.
 */
export function SshKeyPanel({ kind, host }: { kind: AuthKind; host: string | null }) {
  const status = useSshKeyStore((s) => s.status);
  const loading = useSshKeyStore((s) => s.loading);
  const generating = useSshKeyStore((s) => s.generating);
  const generated = useSshKeyStore((s) => s.generated);
  const error = useSshKeyStore((s) => s.error);
  const load = useSshKeyStore((s) => s.load);
  const generate = useSshKeyStore((s) => s.generate);

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  React.useEffect(() => {
    void load(host);
  }, [load, host]);

  // Prefill from the backend's suggestions, which are the only source that
  // knows what name is free. Guarded on emptiness so a re-read (after a
  // generate) never overwrites what the user is in the middle of typing.
  React.useEffect(() => {
    if (!status) return;
    setName((v) => v || status.suggestedName);
    setComment((v) => v || status.suggestedComment);
  }, [status]);

  const advice = sshAdvice(kind, status);
  // The key to lead with: the one just generated, else the first ssh would try
  // on its own, else whatever is there.
  const primary: SshKeyInfo | null =
    generated ??
    status?.keys.find((k) => k.isDefaultIdentity) ??
    status?.keys[0] ??
    null;

  const copy = (key: SshKeyInfo) => {
    void navigator.clipboard
      ?.writeText(key.publicKey)
      .then(() => pgFlash("Public key copied"))
      .catch(() => pgFlash("Could not reach the clipboard"));
  };

  const openAddKeyPage = () => {
    const url = status?.addKeyUrl;
    if (!url) return;
    // The app makes no request of its own — this hands the URL to the OS, which
    // is why `open_url` re-validates it as https before spawning anything.
    void openUrl(url).catch(() => pgFlash("Could not open your browser"));
  };

  const submit = async () => {
    if (generating) return;
    if (passphrase !== confirm) {
      pgFlash("The two passphrases do not match");
      return;
    }
    const key = await generate({
      name: name.trim() || undefined,
      comment: comment.trim() || undefined,
      passphrase: passphrase || undefined,
    });
    // Cleared whatever happened: a passphrase left in a mounted input outlives
    // the reason it was typed.
    setPassphrase("");
    setConfirm("");
    if (key) {
      setOpen(false);
      setName("");
    }
  };

  return (
    <div
      data-testid="ssh-key-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        background: "var(--bg-1)",
      }}
    >
      {loading && !status ? (
        <div
          data-testid="ssh-key-loading"
          style={{ fontSize: "var(--fs-12)", color: "var(--fg-2)" }}
        >
          Looking for SSH keys…
        </div>
      ) : (
        <>
          <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-0)" }}>
            {advice.headline}
          </div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
            {advice.body}
          </div>

          {primary && (
            <div
              data-testid="ssh-key-primary"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-1)",
                wordBreak: "break-all",
              }}
            >
              <div>
                <PGIcon name="lock" size={11} /> {primary.path}
                {primary.isDefaultIdentity ? "" : "  (not a default identity)"}
              </div>
              <div data-testid="ssh-key-fingerprint">{primary.fingerprint}</div>
            </div>
          )}

          {status && status.keys.length > 1 && (
            <div
              data-testid="ssh-key-others"
              style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}
            >
              {status.keys.length - 1} other key
              {status.keys.length - 1 === 1 ? "" : "s"} in {status.dir}. Which one
              ssh offers can be pinned by a `~/.ssh/config` entry, which this app
              does not read.
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {primary && (
              <PGButton
                size="sm"
                icon="copy"
                onClick={() => copy(primary)}
                data-testid="ssh-key-copy"
              >
                Copy public key
              </PGButton>
            )}
            {status?.addKeyUrl && (
              <PGButton
                size="sm"
                icon="external"
                onClick={openAddKeyPage}
                data-testid="ssh-key-add-link"
              >
                Add a key on {status.host}
              </PGButton>
            )}
            {!open && (
              <PGButton
                size="sm"
                icon="plus"
                variant={advice.wantsGenerate ? "primary" : "default"}
                disabled={!status?.canGenerate}
                title={status?.canGenerate ? undefined : SSH_KEYGEN_UNAVAILABLE_HELP}
                onClick={() => setOpen(true)}
                data-testid="ssh-key-generate-open"
              >
                Generate an SSH key
              </PGButton>
            )}
          </div>

          {status && !status.canGenerate && (
            <div
              data-testid="ssh-keygen-unavailable"
              style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}
            >
              {SSH_KEYGEN_UNAVAILABLE_HELP}
            </div>
          )}

          {open && (
            <div
              data-testid="ssh-key-generate-form"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
                  FILE NAME IN {status?.dir ?? "~/.ssh"}
                </span>
                <PGInput
                  size="sm"
                  mono
                  value={name}
                  onChange={setName}
                  data-testid="ssh-key-name"
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
                  COMMENT
                </span>
                <PGInput
                  size="sm"
                  value={comment}
                  onChange={setComment}
                  data-testid="ssh-key-comment"
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
                  PASSPHRASE — OPTIONAL
                </span>
                <PGInput
                  size="sm"
                  type="password"
                  value={passphrase}
                  onChange={setPassphrase}
                  placeholder="leave empty for an unencrypted key"
                  data-testid="ssh-key-passphrase"
                />
              </label>
              {passphrase !== "" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-2)" }}>
                    CONFIRM PASSPHRASE
                  </span>
                  <PGInput
                    size="sm"
                    type="password"
                    value={confirm}
                    onChange={setConfirm}
                    data-testid="ssh-key-passphrase-confirm"
                  />
                </label>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <PGButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    setPassphrase("");
                    setConfirm("");
                  }}
                  data-testid="ssh-key-generate-cancel"
                >
                  Cancel
                </PGButton>
                <PGButton
                  size="sm"
                  variant="primary"
                  loading={generating}
                  disabled={generating || !name.trim()}
                  onClick={() => void submit()}
                  data-testid="ssh-key-generate-submit"
                >
                  Create ed25519 key
                </PGButton>
              </div>
            </div>
          )}

          {generated && (
            <div
              data-testid="ssh-key-generated"
              style={{ fontSize: "var(--fs-11)", color: "var(--fg-1)" }}
            >
              Created {generated.path}. Copy the public key and add it to{" "}
              {status?.host ?? "your account"} — the private half never leaves
              this machine.
            </div>
          )}

          {error && (
            <div
              data-testid="ssh-key-error"
              style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
            >
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
