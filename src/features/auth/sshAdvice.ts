import type { AuthKind } from "@/lib/errors";
import type { SshKeyStatus } from "@/lib/types";

/**
 * What to tell someone whose SSH authentication just failed (#248).
 *
 * PURE, and separate from the panel that renders it, for two reasons. It is a
 * choice of WORDS, table-testable across the (kind × has-a-key) grid; and it
 * cannot live in the backend's `classify_auth_failure`, which is pure over
 * git's stderr and must not start reading `~/.ssh` to make a distinction the
 * frontend can make from two facts it already has.
 *
 * The distinction the issue asks for is exactly that pair of facts:
 * `Permission denied (publickey)` means the host rejected what was offered, so
 * whether anything exists to offer splits it into two very different sentences.
 */
export type SshAdviceTone = "none" | "unregistered" | "passphrase";

export interface SshAdvice {
  tone: SshAdviceTone;
  headline: string;
  body: string;
  /** Whether the primary action is "make a key" rather than "add this one". */
  wantsGenerate: boolean;
}

/** How to name the host in a sentence, when git's stderr gave us one. */
function where(host: string | null | undefined): string {
  return host ? host : "the server";
}

export function sshAdvice(
  kind: AuthKind,
  status: SshKeyStatus | null,
): SshAdvice {
  const host = status?.host ?? null;
  // `null` means the status has not loaded yet — the panel renders a skeleton
  // rather than guessing, so this branch describes the challenge alone.
  const keys = status?.keys ?? [];
  const dir = status?.dir ?? "~/.ssh";

  if (kind === "SshPassphrase") {
    return {
      tone: "passphrase",
      headline: "Your SSH key is encrypted.",
      body: `Enter its passphrase to continue. The key itself is fine — ${where(
        host,
      )} has not rejected it.`,
      wantsGenerate: false,
    };
  }

  if (status && keys.length === 0) {
    return {
      tone: "none",
      headline: `No SSH key found in ${dir}.`,
      body: `That is why ${where(
        host,
      )} refused the connection: there was nothing to offer. Generate a key, then add its public half to your account.`,
      wantsGenerate: true,
    };
  }

  return {
    tone: "unregistered",
    headline: `${where(host)} did not accept your SSH key.`,
    body:
      "The usual cause is that the key has not been added to your account — the public half is below, ready to copy. A `~/.ssh/config` entry pointing at a different key, or a key that only lives in your agent, would also land here.",
    wantsGenerate: false,
  };
}
