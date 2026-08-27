// The subject line, and the two things composed onto it (#252): a
// conventional-commit `type(scope):` prefix and a ticket key.
//
// The message box holds plain text and nothing else. There is no structured
// draft behind it: the type picker PARSES the subject on every render and
// rewrites it on change, so typing `feat: x` by hand selects "feat" in the
// picker, clearing the picker hands the typed text back, and free typing keeps
// working exactly as it did. The issue is explicit that it must — "a mandatory
// form here would be worse than nothing".

/** The types conventionalcommits.org names, plus the two the Angular set adds. */
export const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export interface ConventionalPrefix {
  type: string;
  /** The `(scope)`, without parentheses. Empty when there is none. */
  scope: string;
  /** The `!` breaking-change marker. Parsed so a type change PRESERVES it. */
  breaking: boolean;
  /** The subject with the prefix removed. */
  rest: string;
}

/**
 * `type(scope)!: rest`, or `null` when the subject is not one.
 *
 * The type is a single word — deliberately no space allowed — which is what
 * keeps prose out: `Merge branch 'x': tidy` and `See also: the README` both
 * have a space before the colon and are left alone. A scope containing
 * parentheses is refused too, because it could not be written back out
 * unambiguously.
 */
export function parseConventionalPrefix(subject: string): ConventionalPrefix | null {
  const m = /^([A-Za-z][A-Za-z0-9]*)(?:\(([^()]*)\))?(!?):(?: (.*))?$/.exec(subject);
  if (!m) return null;
  return {
    type: m[1],
    scope: m[2] ?? "",
    breaking: m[3] === "!",
    rest: m[4] ?? "",
  };
}

/** The first line of a message. */
export function subjectOf(message: string): string {
  return message.split("\n", 1)[0];
}

/** A message with its first line replaced, body untouched. */
function withSubject(message: string, subject: string): string {
  const nl = message.indexOf("\n");
  return nl === -1 ? subject : subject + message.slice(nl);
}

/**
 * Rewrite the subject's conventional prefix.
 *
 * An empty `type` REMOVES the prefix and gives back what was after it, which is
 * why the picker having a blank option is safe: it can always be undone by
 * re-picking. An existing `!` survives a type or scope change — this feature
 * does not offer that toggle, and silently dropping a marker the user typed
 * would be the worst of both.
 */
export function withConventionalPrefix(
  message: string,
  type: string,
  scope: string,
): string {
  const subject = subjectOf(message);
  const parsed = parseConventionalPrefix(subject);
  const base = parsed ? parsed.rest : subject;
  if (!type) return withSubject(message, base);
  const bang = parsed?.breaking ? "!" : "";
  const scoped = scope ? `(${scope})` : "";
  return withSubject(message, `${type}${scoped}${bang}: ${base}`);
}

/**
 * Put `ticket` at the front of the subject — after any conventional prefix.
 *
 * `PROJ-1 feat: thing` is not a conventional commit and commitlint rejects it;
 * `feat: PROJ-1 thing` is one and it does not. A subject that already names the
 * ticket is returned unchanged, so the affordance is idempotent; the BODY is
 * not searched, because a `Refs PROJ-1` trailer is not the same claim as a
 * subject prefix.
 */
export function insertTicket(message: string, ticket: string): string {
  const subject = subjectOf(message);
  if (subjectNamesTicket(subject, ticket)) return message;
  const parsed = parseConventionalPrefix(subject);
  if (!parsed) return withSubject(message, joinTicket(ticket, subject));
  const scoped = parsed.scope ? `(${parsed.scope})` : "";
  const bang = parsed.breaking ? "!" : "";
  return withSubject(
    message,
    `${parsed.type}${scoped}${bang}: ${joinTicket(ticket, parsed.rest)}`,
  );
}

/** Whether the subject already carries this ticket — the chip's disable rule. */
export function subjectNamesTicket(subject: string, ticket: string): boolean {
  return subject.includes(ticket);
}

function joinTicket(ticket: string, rest: string): string {
  return rest ? `${ticket} ${rest}` : `${ticket} `;
}
