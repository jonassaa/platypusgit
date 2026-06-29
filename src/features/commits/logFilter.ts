import type { LogFilter } from "@/lib/types";

/**
 * Inputs from the History search bar, before they become a backend `LogFilter`.
 * `text` is the free-text box; the rest come from dedicated controls.
 */
export interface LogFilterInputs {
  /** Free text. May contain `key:value` qualifiers (see parseQueryText). */
  text?: string;
  author?: string;
  path?: string;
  /** ISO date string `YYYY-MM-DD` (date input). */
  sinceDate?: string;
  /** ISO date string `YYYY-MM-DD` (date input). */
  untilDate?: string;
}

/** A SHA-ish token: hex, length 4..40. */
const SHA_RE = /^[0-9a-f]{4,40}$/i;

/**
 * Parse a free-text query into partial filter fields. Supports `key:value`
 * qualifiers (`author:`, `path:`, `sha:`, `since:`, `until:`, `message:`);
 * everything else accumulates into the message substring. A bare token that
 * looks like a SHA prefix becomes `shaPrefix` (unless other text is present).
 *
 * Quoting is intentionally not supported — values run to the next whitespace.
 */
export function parseQueryText(text: string): Partial<LogFilter> {
  const out: Partial<LogFilter> = {};
  const messageParts: string[] = [];
  const bareTokens: string[] = [];

  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    const colon = tok.indexOf(":");
    const key = colon > 0 ? tok.slice(0, colon).toLowerCase() : "";
    const value = colon > 0 ? tok.slice(colon + 1) : "";
    switch (key) {
      case "author":
      case "by":
        if (value) out.author = mergeTerm(out.author, value);
        break;
      case "path":
      case "file":
        if (value) out.path = value;
        break;
      case "sha":
      case "commit":
        if (value) out.shaPrefix = value;
        break;
      case "since":
      case "after":
        if (value) out.since = parseSince(value) ?? out.since;
        break;
      case "until":
      case "before":
        if (value) out.until = parseUntil(value) ?? out.until;
        break;
      case "message":
      case "msg":
        if (value) messageParts.push(value);
        break;
      default:
        bareTokens.push(tok);
    }
  }

  // A single bare token that's clearly a SHA prefix → shaPrefix; otherwise the
  // bare tokens form the message substring.
  if (bareTokens.length === 1 && !messageParts.length && SHA_RE.test(bareTokens[0])) {
    out.shaPrefix = out.shaPrefix ?? bareTokens[0];
  } else {
    messageParts.push(...bareTokens);
  }

  const message = messageParts.join(" ").trim();
  if (message) out.message = message;
  return out;
}

function mergeTerm(existing: string | null | undefined, next: string): string {
  return existing ? `${existing} ${next}` : next;
}

/** Parse `YYYY-MM-DD` to unix seconds at local 00:00:00. Returns null if invalid. */
function parseSince(value: string): number | null {
  return dateToUnix(value, false);
}

/** Parse `YYYY-MM-DD` to unix seconds at local 23:59:59 (end of day). */
function parseUntil(value: string): number | null {
  return dateToUnix(value, true);
}

function dateToUnix(value: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
  );
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}

/**
 * Build a backend `LogFilter` from the History search controls. Combines the
 * free-text query (which may itself carry qualifiers) with the dedicated
 * author/path/date fields. Dedicated fields take precedence over qualifiers of
 * the same name parsed from the text.
 */
export function buildLogFilter(inputs: LogFilterInputs): LogFilter {
  const fromText = parseQueryText(inputs.text ?? "");
  const filter: LogFilter = { ...fromText };

  const author = inputs.author?.trim();
  if (author) filter.author = author;

  const path = inputs.path?.trim();
  if (path) filter.path = path;

  if (inputs.sinceDate) {
    const since = parseSince(inputs.sinceDate);
    if (since != null) filter.since = since;
  }
  if (inputs.untilDate) {
    const until = parseUntil(inputs.untilDate);
    if (until != null) filter.until = until;
  }

  return normalizeFilter(filter);
}

/** Drop empty/blank fields so an "empty" filter is genuinely `{}`. */
export function normalizeFilter(filter: LogFilter): LogFilter {
  const out: LogFilter = {};
  if (filter.message?.trim()) out.message = filter.message.trim();
  if (filter.author?.trim()) out.author = filter.author.trim();
  if (filter.shaPrefix?.trim()) out.shaPrefix = filter.shaPrefix.trim();
  if (filter.path?.trim()) out.path = filter.path.trim();
  if (typeof filter.since === "number") out.since = filter.since;
  if (typeof filter.until === "number") out.until = filter.until;
  return out;
}

/** True when no filter dimension is set (matches everything). */
export function isFilterEmpty(filter: LogFilter): boolean {
  return Object.keys(normalizeFilter(filter)).length === 0;
}
