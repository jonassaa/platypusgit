export type AppError =
  | { kind: "NotARepo"; message: string }
  | { kind: "UnknownRepo"; message: string }
  | { kind: "InvalidPath"; message: string }
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
