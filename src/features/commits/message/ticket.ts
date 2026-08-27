// Ticket / issue key derived from the branch name (#252).
//
// Offered as a one-click insert, never applied automatically: a branch name is
// a guess about intent, and a guess does not get to write in the message box.

/**
 * Jira / Linear / YouTrack shape: an uppercase project key, a hyphen, a number.
 *
 * UPPERCASE deliberately. The permissive `[A-Za-z][A-Za-z0-9]+-\d+` also matches
 * `fix-404` in `feature/fix-404-page` and `add-2` in `feat/add-2fa-login`, and a
 * chip offering `add-2` as your ticket is worse than no chip at all. A team whose
 * branches carry lowercase keys edits the pattern; a team using words with
 * numbers in them cannot edit their way out of a false positive.
 */
export const DEFAULT_TICKET_PATTERN = "[A-Z][A-Z0-9]+-\\d+";

/** Whether a pattern compiles. An empty pattern is "off", not "broken". */
export function isValidTicketPattern(pattern: string): boolean {
  if (pattern.trim() === "") return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * The ticket a branch name carries, or `null`.
 *
 * Capture group 1 wins when the pattern has one, so `issue-(\d+)` can match
 * around the ticket and still insert only the ticket. A pattern that does not
 * compile — a half-typed one in Settings — yields `null` rather than throwing:
 * this runs on every keystroke in the commit box.
 */
export function extractTicket(
  branch: string | null | undefined,
  pattern: string = DEFAULT_TICKET_PATTERN,
): string | null {
  if (!branch) return null;
  if (pattern.trim() === "") return null;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null;
  }
  const m = re.exec(branch);
  if (!m) return null;
  const found = m[1] ?? m[0];
  return found ? found : null;
}
