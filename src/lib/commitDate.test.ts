// How a commit timestamp reads on screen (#354). The Date column used to say
// only "3w ago", which cannot answer "was this before or after the release?".
//
// Everything here is pure, but "local time" is not: `absoluteTime` formats in
// whatever zone the process is in. The exact-string tests pin TZ to UTC — the
// one zone present on every machine and in every CI container — and the
// zone-dependent half is tested through `tzOffsetLabel`, which takes the offset
// as a NUMBER and so needs no tzdata at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DATE_FORMATS,
  absoluteTime,
  commitDateText,
  commitDateTitle,
  fullTimestamp,
  isDateFormat,
  preciseTime,
  tzOffsetLabel,
} from "./commitDate";

// 2026-08-14T13:42:07Z
const TS = 1786714927;

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("tzOffsetLabel", () => {
  // getTimezoneOffset() is minutes to ADD to local time to reach UTC, so its
  // sign is the opposite of the one people write. Getting this backwards would
  // label every European commit "-02:00" — plausible enough to ship unnoticed.
  it("inverts the getTimezoneOffset sign", () => {
    expect(tzOffsetLabel(-120)).toBe("+02:00"); // CEST
    expect(tzOffsetLabel(300)).toBe("-05:00"); // EST
  });

  it("pads and keeps half-hour and quarter-hour zones", () => {
    expect(tzOffsetLabel(-330)).toBe("+05:30"); // India
    expect(tzOffsetLabel(-345)).toBe("+05:45"); // Nepal
    expect(tzOffsetLabel(-540)).toBe("+09:00"); // Japan
  });

  it("writes UTC as +00:00, never -00:00", () => {
    expect(tzOffsetLabel(0)).toBe("+00:00");
  });
});

describe("absoluteTime", () => {
  it("is zero-padded and sortable, to the minute", () => {
    expect(absoluteTime(TS)).toBe("2026-08-14 13:42");
  });

  // A one-digit month/day/hour must not shorten the string: the Date column is
  // fixed-width monospace, and a ragged stamp is what a naive template gives.
  it("pads single-digit fields", () => {
    expect(absoluteTime(Date.UTC(2026, 0, 5, 4, 3, 9) / 1000)).toBe("2026-01-05 04:03");
  });

  it("has the same width for every instant", () => {
    const widths = new Set(
      [0, TS, Date.UTC(1999, 11, 31, 23, 59) / 1000].map((t) => absoluteTime(t).length),
    );
    expect(widths).toEqual(new Set([16]));
  });
});

describe("preciseTime", () => {
  // Seconds, no zone: what commit details shows INLINE. Two commits made in
  // the same minute have to be tellable apart there, but the zone is noise on
  // a line the reader is already reading in their own clock — it lives one
  // hover away instead, in `fullTimestamp`.
  it("adds seconds to the absolute stamp", () => {
    expect(preciseTime(TS)).toBe("2026-08-14 13:42:07");
    expect(preciseTime(TS)).toBe(`${absoluteTime(TS)}:07`);
  });

  it("pads a single-digit second", () => {
    expect(preciseTime(Date.UTC(2026, 0, 5, 4, 3, 9) / 1000)).toBe("2026-01-05 04:03:09");
  });
});

describe("fullTimestamp", () => {
  // Seconds AND the zone: this is the string that has to settle "which of these
  // two commits came first", so it must be unambiguous on its own.
  it("carries seconds and the zone offset", () => {
    expect(fullTimestamp(TS)).toBe("2026-08-14 13:42:07 +00:00");
    expect(fullTimestamp(TS)).toBe(`${preciseTime(TS)} +00:00`);
  });
});

describe("commitDateText", () => {
  const now = (TS + 60 * 60 * 24 * 21) * 1000; // three weeks later

  it("shows only the relative form in relative mode", () => {
    expect(commitDateText(TS, "relative", now)).toBe("3w ago");
  });

  it("shows only the stamp in absolute mode", () => {
    expect(commitDateText(TS, "absolute", now)).toBe("2026-08-14 13:42");
  });

  it("shows the stamp with the relative form in parentheses in both mode", () => {
    expect(commitDateText(TS, "both", now)).toBe("2026-08-14 13:42 (3w ago)");
  });

  // A persisted preference this build has never heard of must still render a
  // date — an empty Date column is worse than the wrong format.
  it("falls back to relative for an unknown mode", () => {
    expect(commitDateText(TS, "wat" as never, now)).toBe("3w ago");
  });
});

describe("commitDateTitle", () => {
  const now = (TS + 60 * 60 * 24 * 21) * 1000;

  // The hover text is mode-independent on purpose: whatever the column shows,
  // the tooltip is the full answer, so "show me the exact time" never needs a
  // trip to Settings.
  it("carries the full stamp and the relative form", () => {
    expect(commitDateTitle(TS, now)).toBe("2026-08-14 13:42:07 +00:00 (3w ago)");
  });
});

describe("isDateFormat", () => {
  it("accepts exactly the three modes", () => {
    expect(DATE_FORMATS).toEqual(["relative", "absolute", "both"]);
    for (const mode of DATE_FORMATS) expect(isDateFormat(mode)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "Relative", "iso", 3, null, undefined, {}]) {
      expect(isDateFormat(bad)).toBe(false);
    }
  });
});
