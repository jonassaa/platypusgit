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
  | { kind: "DirtyWorktree"; message: string }
  | { kind: "NotMerged"; message: string }
  | { kind: "ConflictsDetected"; message: string }
  | { kind: "NoSignature"; message?: string }
  | { kind: "Internal"; message: string }
  | { kind: "Network"; message: string }
  | { kind: "EmbeddedRepo"; message: string };

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
    return e.message ?? e.kind;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isEmbeddedRepoError(e: unknown): boolean {
  return isAppError(e) && e.kind === "EmbeddedRepo";
}

/**
 * What to tell the user about an embedded repository. The backend error stays
 * terse (`embedded repository: vendor/lib/`) like the rest of the enum —
 * remediation prose belongs here, next to the UI that can act on it.
 */
export const EMBEDDED_REPO_HELP =
  "This folder is a git repository of its own, so git can only record it as a bare pointer that nobody who clones this repo can resolve. Add it to .gitignore, or register it as a submodule.";
