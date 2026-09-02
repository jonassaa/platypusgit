// How a commit timestamp is written on screen (#354).
//
// THE one place that turns `CommitInfo.timestamp` into text. Every date surface
// — History rows and detail, Reflog, Compare, the repository browser — reads
// from here, so the log column, the tooltip and the detail line cannot describe
// the same instant three different ways. `relativeTime` in ./derive stays where
// it is: it is one of the forms composed here, not a surface of its own.
//
// Local time, deliberately. The offset the author committed under is not
// carried across IPC (`CommitInfo` has only unix seconds), and the question
// this feature exists to answer — "did this land before or after that?" — is
// asked in the reader's own clock. `fullTimestamp` therefore names the zone it
// used, so a stamp copied out of a tooltip is unambiguous.
import { relativeTime } from "./derive";

/**
 * What the Date column shows. The user's choice, persisted as `dateFormat` in
 * settings; `relative` is the default and the fallback.
 */
export type DateFormat = "relative" | "absolute" | "both";

/** Every mode, in the order the Settings control offers them. */
export const DATE_FORMATS: readonly DateFormat[] = ["relative", "absolute", "both"] as const;

/** Is this a mode this build knows? Guards a hand-edited or newer-build value. */
export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === "string" && (DATE_FORMATS as readonly string[]).includes(value);
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * A zone offset the way people write it — `+02:00`, `-05:30`.
 *
 * Takes the value `Date#getTimezoneOffset` returns, which is minutes to ADD to
 * local time to reach UTC: its sign is the opposite of the printed one, which
 * is why this is a named function with its own tests rather than a template.
 */
export function tzOffsetLabel(offsetMinutes: number): string {
  const total = -offsetMinutes;
  const sign = total < 0 ? "-" : "+";
  const abs = Math.abs(total);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * `2026-08-14 13:42` — local, zero-padded, sortable.
 *
 * ISO-ish rather than locale-formatted: this sits in a fixed-width monospace
 * column, where every stamp must occupy the same 16 characters, and a
 * developer tool should not make the reader guess whether `08/14` is August or
 * February.
 */
export function absoluteTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    ` ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * `2026-08-14 13:42:07` — the stamp with seconds, for surfaces with room.
 *
 * Seconds matter on a detail surface: two commits a few seconds apart read as
 * the same instant without them. The zone does not appear here — the reader is
 * already in it — and is one hover away in `fullTimestamp`.
 */
export function preciseTime(unixSeconds: number): string {
  return `${absoluteTime(unixSeconds)}:${pad2(new Date(unixSeconds * 1000).getSeconds())}`;
}

/**
 * `2026-08-14 13:42:07 +00:00` — the unambiguous form, for hover text.
 *
 * The zone is what makes it decisive beyond this window: a stamp with no zone
 * cannot be compared with one pasted from a terminal or read off a CI log.
 */
export function fullTimestamp(unixSeconds: number): string {
  return `${preciseTime(unixSeconds)} ${tzOffsetLabel(
    new Date(unixSeconds * 1000).getTimezoneOffset(),
  )}`;
}

/** What the Date column shows, for the user's chosen `mode`. */
export function commitDateText(
  unixSeconds: number,
  mode: DateFormat,
  now: number = Date.now(),
): string {
  switch (mode) {
    case "absolute":
      return absoluteTime(unixSeconds);
    case "both":
      return `${absoluteTime(unixSeconds)} (${relativeTime(unixSeconds, now)})`;
    default:
      // Includes "relative" and anything a newer build might have written.
      return relativeTime(unixSeconds, now);
  }
}

/**
 * The hover text — always the full answer, whatever the column shows.
 *
 * Mode-independent on purpose: "what time exactly?" is then one hover away in
 * every mode, and nobody has to visit Settings to read one commit's timestamp.
 */
export function commitDateTitle(unixSeconds: number, now: number = Date.now()): string {
  return `${fullTimestamp(unixSeconds)} (${relativeTime(unixSeconds, now)})`;
}
