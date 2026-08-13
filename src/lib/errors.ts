export type AppError =
  | { kind: "NotARepo"; message: string }
  | { kind: "UnknownRepo"; message: string }
  | { kind: "InvalidPath"; message: string }
  | { kind: "InvalidUrl"; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Git"; message: string }
  | { kind: "NotImplemented"; message?: string }
  | { kind: "Unborn"; message?: string }
  | { kind: "InvalidRef"; message: string }
  | { kind: "InvalidArgument"; message: string }
  | { kind: "DirtyWorktree"; message: string }
  | { kind: "NotMerged"; message: string }
  | { kind: "ConflictsDetected"; message: string }
  | { kind: "NoSignature"; message?: string }
  | { kind: "Internal"; message: string }
  | { kind: "Network"; message: string }
  /**
   * The remote needs credentials (#61 D5). Distinct from `Network` so the UI can
   * prompt and retry. Carries no secret and no raw git stderr.
   */
  | { kind: "Auth"; message: AuthChallenge }
  | { kind: "EmbeddedRepo"; message: string }
  | { kind: "DubiousOwnership"; message: string };

/** Which credential the remote is asking for. */
export type AuthKind = "Https" | "SshPassphrase" | "SshKey";

export interface AuthChallenge {
  /** Host the credential is for, when git's stderr named one. */
  host: string | null;
  kind: AuthKind;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  );
}

export function appErrorMessage(e: unknown): string {
  if (isAppError(e)) {
    // Auth's payload is structured, not a sentence — render it here rather than
    // letting an object reach the UI as "[object Object]".
    if (e.kind === "Auth") return authChallengeMessage(e.message);
    return e.message ?? e.kind;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** One-line description of an auth challenge, for banners and fallbacks. */
export function authChallengeMessage(c: AuthChallenge): string {
  const where = c.host ? ` for ${c.host}` : "";
  switch (c.kind) {
    case "SshPassphrase":
      return `SSH key passphrase required${where}.`;
    case "SshKey":
      return `The server rejected the SSH key${where}.`;
    default:
      return `Authentication required${where}.`;
  }
}

export function isEmbeddedRepoError(e: unknown): boolean {
  return isAppError(e) && e.kind === "EmbeddedRepo";
}

/**
 * What to tell the user about an embedded repository. The backend error stays
 * terse (`embedded repository: vendor/lib/`) like the rest of the enum —
 * remediation prose belongs here, next to the UI that can act on it.
 */
export function isDubiousOwnershipError(e: unknown): boolean {
  return isAppError(e) && e.kind === "DubiousOwnership";
}

/** Narrow to an auth failure, so a caller can prompt and retry (#61 D5). */
export function isAuthError(
  e: unknown,
): e is Extract<AppError, { kind: "Auth" }> {
  return isAppError(e) && e.kind === "Auth";
}

/**
 * The path the backend refused, without the enum's prefix. Same split of
 * duties as the embedded-repo helpers above: the Rust error stays terse, the
 * words the user reads live here.
 */
export function dubiousOwnershipPath(e: unknown): string | null {
  if (!isDubiousOwnershipError(e)) return null;
  return appErrorMessage(e).replace(/^repository is owned by another user: /, "");
}

/**
 * Why git refuses, and what accepting costs. Opening a repository runs
 * commands its own config names (`core.pager`, `core.fsmonitor`), so a
 * repository owned by someone else is a way to run their code — which is what
 * the check exists to stop. On a Windows drive under WSL the owner mismatch
 * is an artefact of how the drive is mounted, not a threat; the app cannot
 * tell those two apart, so the user decides, once per repository.
 */
export const DUBIOUS_OWNERSHIP_HELP =
  "git refuses to open a repository owned by another user, because opening one can run commands from that repository's config. This is expected for repositories on a Windows drive under WSL. Trusting it adds a safe.directory entry to your global git config.";

export const EMBEDDED_REPO_HELP =
  "This folder is a git repository of its own, so git can only record it as a bare pointer that nobody who clones this repo can resolve. Add it to .gitignore, or register it as a submodule.";
