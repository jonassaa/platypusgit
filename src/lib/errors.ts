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
  /**
   * A local branch tracks nothing, so there is no upstream to fast-forward it
   * to (#246). Distinct from `InvalidRef` — the branch is fine, it just has no
   * upstream — and the remedy is one menu item away: set one.
   */
  | { kind: "NoUpstream"; message: string }
  /**
   * The branch tip is not an ancestor of its upstream tip, so its ref cannot be
   * advanced without a merge or a rebase (#246). The one refusal the
   * fast-forward op exists to make; the message names both refs.
   */
  | { kind: "NotFastForward"; message: string }
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
  | { kind: "DubiousOwnership"; message: string }
  | { kind: "InvalidRebasePlan"; message: string }
  /** A forge API call failed (#92). Scrubbed + redacted: never carries a token. */
  | { kind: "Forge"; message: string }
  /**
   * The forge API rejected our token for this HOST (401/403). Distinct from
   * `Auth`, which is a git-transport credential prompt — only Settings can fix
   * a bad API token, so the two must not share a dialog.
   */
  | { kind: "ForgeAuth"; message: string }
  /** The token did not survive `git credential approve` → `fill` (#92). */
  | { kind: "ForgeTokenStore"; message: string }
  /** A local branch the operation would overwrite already exists. */
  | { kind: "BranchExists"; message: string }
  /**
   * The stash entry at the given index is no longer the one that was selected
   * (#133) — a stash index is a reflog POSITION and any write to `refs/stash`
   * shifts it. Recoverable: refresh the list and pick again.
   */
  | { kind: "StaleStash"; message: string }
  /**
   * The `git-lfs` binary is missing or unrunnable (#93). A state the UI disables
   * on, not a failure it reports — distinct from `Git`/`Network` so git's
   * `'lfs' is not a git command` never reaches a banner.
   */
  | { kind: "LfsUnavailable"; message: string }
  /** An op needed a bisect in progress and found none (#93). */
  | { kind: "NoBisect"; message?: string }
  /**
   * The user cancelled a running network op (#234). The outcome they asked for,
   * not a failure — every catch arm suppresses the banner for it and just clears
   * the spinner. Distinct from `Network` because a SIGKILLed git's last words
   * ("the remote end hung up unexpectedly") would otherwise be reported to
   * someone who pressed Cancel as a broken connection.
   */
  | { kind: "Cancelled"; message?: string }
  /**
   * A git hook ran and refused (#232). The payload is a STRUCT, and its
   * `output` is deliberately NOT rendered into the banner sentence: forty lines
   * of eslint belong in the dedicated output block, which scrolls. See
   * `appErrorDetail`.
   */
  | { kind: "HookRejected"; message: HookRejection };

/** Which credential the remote is asking for. */
export type AuthKind = "Https" | "SshPassphrase" | "SshKey";

export interface AuthChallenge {
  /** Host the credential is for, when git's stderr named one. */
  host: string | null;
  kind: AuthKind;
}

/**
 * A hook's refusal (#232). `output` is whatever the hook printed, verbatim —
 * stdout and stderr both, as git delivers them.
 */
export interface HookRejection {
  hook: string;
  output: string;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  );
}

/**
 * The prose half of an `AppError` — what a human reads, with no discriminant.
 *
 * Empty when the variant carries no message at all (`Unborn`, `NoBisect`, …), so
 * callers decide what to show instead: a banner falls back to the kind, a log
 * line already has it.
 *
 * ALWAYS a string, whatever the payload is. `isAppError` accepts any object with
 * a string `kind`, so `message` is only a string by convention — and `Auth`
 * proves the enum itself can carry a struct. The old `e.message ?? ""` therefore
 * returned an object for any shape without a case below: `[object Object]` in a
 * log line, and "Objects are not valid as a React child" in a banner.
 */
function appErrorDetail(e: AppError): string {
  // ONE guarded read, so every branch below works on a value that is already in
  // hand. A `message` getter that throws must not escape — see `describeError`.
  let message: unknown;
  try {
    message = (e as { message?: unknown }).message;
  } catch {
    // Unreadable reads as "no prose available", same as a variant that carries
    // none: both consumers then fall back to the kind, which is the whole
    // reason that fallback exists.
    return "";
  }
  // Each variant that carries a STRUCT or an IDENTIFIER instead of prose renders
  // it here — and checks the shape it needs first, so a payload of the wrong
  // type falls through to the generic tail instead of being mis-read.
  //
  // Auth's payload is structured, not a sentence.
  if (e.kind === "Auth" && typeof message === "object" && message !== null) {
    return authChallengeMessage(message as AuthChallenge);
  }
  // ForgeAuth carries a HOST and BranchExists carries a BRANCH NAME, not
  // prose. Rendered raw, the banner would just read "github.com".
  if (e.kind === "ForgeAuth" && typeof message === "string") {
    return forgeAuthMessage(message);
  }
  // HookRejected carries a struct, and its `output` is deliberately dropped
  // here: the output goes to the block that can scroll, while a banner gets the
  // sentence naming which hook to go and look at.
  if (
    e.kind === "HookRejected" &&
    typeof message === "object" &&
    message !== null &&
    typeof (message as HookRejection).hook === "string"
  ) {
    return `The ${(message as HookRejection).hook} hook rejected this commit.`;
  }
  if (e.kind === "BranchExists" && typeof message === "string") {
    return `A local branch named ${message} already exists.`;
  }
  // StaleStash carries a LABEL (`stash@{1}`) — rendered raw the banner would
  // just read "stash@{1}" with no hint of what to do about it.
  if (e.kind === "StaleStash" && typeof message === "string") {
    return `${message} is no longer the entry you picked — the stash list changed. Refresh and try again.`;
  }
  if (message === undefined || message === null) return "";
  if (typeof message === "string") return message;
  // Anything else: a future Rust variant carrying a struct with no case above,
  // or a foreign object that merely satisfies `isAppError`. `describeUnknown` is
  // what keeps the return type honest and "[object Object]" out of both the log
  // file and the DOM.
  return describeUnknown(message);
}

/**
 * Anything that is NOT an `AppError`, rendered without ever reaching
 * `[object Object]` (#146).
 *
 * `String(x)` is the trap: it is correct for every primitive and wrong for
 * exactly the case that matters, an object carrying the reason.
 */
function describeUnknown(e: unknown): string {
  if (e === undefined) return "undefined";
  if (e === null) return "null";
  if (typeof e === "string") return e === "" ? "<empty string>" : e;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === "object") {
    try {
      const json = JSON.stringify(e);
      // `undefined` for a non-serialisable value, "{}" when every own property
      // was dropped — neither says more than the constructor name does.
      if (json && json !== "{}") return json;
    } catch {
      // Circular. Fall through: a name beats a thrown logger.
    }
    const name = (e as { constructor?: { name?: string } }).constructor?.name;
    return name ? `<${name}>` : "<object>";
  }
  return String(e);
}

export function appErrorMessage(e: unknown): string {
  try {
    // `|| e.kind` is the no-prose fallback; `|| describeUnknown` catches an
    // empty kind too, so a banner can never be blank.
    if (isAppError(e)) return appErrorDetail(e) || e.kind || describeUnknown(e);
    if (e instanceof Error) return e.message;
    return describeUnknown(e);
  } catch {
    // Same reason `describeError` is total: this runs in catch arms and in
    // render, so throwing here would either replace the failure being reported
    // or take the whole screen down with it.
    return "The error could not be read.";
  }
}

/**
 * Any throw as an `AppError`, for a store whose `error` field is one.
 *
 * A rejected Tauri command already IS an `AppError` and passes through with its
 * identity intact — callers narrow on `kind` (`isAuthError`,
 * `isLfsUnavailableError`, `isBranchExistsError`, `isDubiousOwnershipError`), and
 * rewrapping it as `Internal` would defeat every one of them. Anything else — a
 * bug in our own code, a rejected non-command promise — becomes `Internal`
 * carrying `appErrorMessage`'s prose, because that string is what a BANNER
 * renders, not a log line.
 *
 * One definition for the five stores that hold an `AppError`: `useRepoStore`,
 * `useReflogStore`, `useWorktreesStore`, `useSubmodulesStore`, `useLfsStore`. It
 * was five byte-identical copies, and #151 had to edit all five to change this
 * one line. Stores whose `error` is a plain string (`useForgeStore`,
 * `useCompareStore`, `useCreateStore`, `useUpdateStore`) call `appErrorMessage`
 * directly and need nothing from here.
 */
export function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: appErrorMessage(e) };
}

/**
 * One failure rendered for the LOG FILE, not for a banner (#146).
 *
 * Differs from `appErrorMessage` on purpose: a log line leads with the `kind`,
 * because that discriminant is the greppable half and it is the first thing you
 * need when a user hands over a log — `InvalidPath` and `Network` want entirely
 * different follow-up questions. A banner, by contrast, must never show the
 * enum's spelling to a user.
 *
 * Total over every input shape: `AppError`, `Error`, string, `undefined`,
 * `null`, a bare object, a primitive, an `AppError` whose message is not a
 * string. It never returns an empty string and never returns `[object Object]`,
 * which is what v0.0.11 logged for every backend failure and what cost us the
 * diagnosis in #146.
 *
 * And it NEVER THROWS, which matters more than the formatting: `invoke` logs a
 * failure and then rethrows it, in that order, so an exception raised in here
 * would replace the original rejection — `isAuthError` would stop narrowing and
 * a network op would fail silently instead of raising the credential prompt.
 * Hence the catch-all: an unreadable payload (a throwing getter, an exotic
 * proxy) costs a vague line, not the diagnosis.
 */
export function describeError(e: unknown): string {
  try {
    if (isAppError(e)) {
      const detail = appErrorDetail(e);
      // `isAppError` only checks that `kind` is a STRING, so it can be empty —
      // and an empty kind with an empty message composed the one thing this
      // function promises never to return. Fall back to the object itself.
      if (detail) return e.kind ? `${e.kind}: ${detail}` : detail;
      return e.kind || describeUnknown(e);
    }
    return describeUnknown(e);
  } catch {
    return "<unreadable error>";
  }
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

/**
 * The user cancelled this op (#234) — so it is not something to report.
 *
 * Every network catch arm asks this before writing an error: a banner reading
 * "early EOF" after pressing Cancel says the app broke, when what happened is
 * exactly what was asked for. The op still refreshes on its way out; only the
 * banner is suppressed.
 */
export function isCancelledError(e: unknown): boolean {
  return isAppError(e) && e.kind === "Cancelled";
}

/** Narrow to an auth failure, so a caller can prompt and retry (#61 D5). */
export function isAuthError(
  e: unknown,
): e is Extract<AppError, { kind: "Auth" }> {
  return isAppError(e) && e.kind === "Auth";
}

/**
 * Narrow to a forge-token failure (#92). Routes the user to Settings, NOT to
 * the git-transport credential dialog — a forge token is a different credential
 * and no askpass prompt can supply it.
 */
export function isForgeAuthError(
  e: unknown,
): e is Extract<AppError, { kind: "ForgeAuth" }> {
  return isAppError(e) && e.kind === "ForgeAuth";
}

/** The host a forge-token failure was for, or null. */
export function forgeAuthHost(e: unknown): string | null {
  return isForgeAuthError(e) ? e.message : null;
}

/**
 * What to tell the user about a rejected or absent forge token. Same split of
 * duties as the embedded-repo and dubious-ownership helpers: the Rust error stays
 * terse (it carries only the host), the words live next to the UI — and they must
 * point at Settings, because no askpass prompt can supply an API token.
 */
export function forgeAuthMessage(host: string): string {
  return `The API token for ${host} is missing or was rejected. Add one in Settings → Integrations.`;
}

/** Narrow to "a local branch of that name already exists". */
export function isBranchExistsError(
  e: unknown,
): e is Extract<AppError, { kind: "BranchExists" }> {
  return isAppError(e) && e.kind === "BranchExists";
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

/** Narrow to "git-lfs is not installed", so a surface can disable rather than error. */
export function isLfsUnavailableError(e: unknown): boolean {
  return isAppError(e) && e.kind === "LfsUnavailable";
}

export const LFS_UNAVAILABLE_HELP =
  "Install git-lfs and run `git lfs install` once, then reopen the repository. Large files stay as pointer text until their objects are fetched.";
