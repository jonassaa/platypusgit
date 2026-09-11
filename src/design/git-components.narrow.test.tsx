// What the commit row does when the pane it lives in is NARROW.
//
// Measured in Chrome (real layout, not jsdom) against the pre-fix template
// `<graph>px 70px 1fr 150px 90px` in a 420px box — the narrowest the commit
// list can be dragged to:
//
//     graph 88 | sha 70 | SUBJECT 22 | author 150 | date 90
//
// The subject — the one column anybody reads — was the ONLY track that could
// yield, so it took every pixel of the shortfall and collapsed to 22px while
// the author name kept a rigid 150. Its content (branch pills, the HEAD badge,
// the subject text) then painted straight over the author cell, and History's
// header read "SUBJECTAUTHOR".
//
// So the yield order is now written into the template: the subject has a FLOOR
// and the author name is what gives way, down to the width of its avatar. Every
// cell clips, so nothing can paint over the column to its right no matter how
// far past the floor the pane goes.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { PGCommitRow } from "./git-components";
import {
  AUTHOR_COL_W,
  AUTHOR_MIN_W,
  DATE_COL_W,
  SHA_COL_W,
  SUBJECT_MIN_W,
  authorMinW,
  colPad,
  commitListMinW,
  commitRowGrid,
  dateColW,
  graphWidth,
  shaColW,
} from "./graph-geometry";
import { TEXT_SCALE } from "@/features/settings/useSettingsStore";

describe("commitRowGrid yield order", () => {
  it("floors the subject and lets the author name shrink to its avatar", () => {
    expect(commitRowGrid(88, DATE_COL_W.relative)).toBe(
      `88px ${SHA_COL_W}px minmax(${SUBJECT_MIN_W}px, 1fr) ` +
        `minmax(${AUTHOR_MIN_W}px, ${AUTHOR_COL_W}px) ${DATE_COL_W.relative}px`,
    );
  });

  // Reflog's rows, which draw no lanes. Same yield order, one track fewer —
  // and Reflog is the surface that needs it most: its pane is 35% of the
  // window, so its subject collapsed on any window under ~1200px.
  it("drops the graph track without changing the yield order", () => {
    expect(commitRowGrid(0, DATE_COL_W.relative)).toBe(
      `${SHA_COL_W}px minmax(${SUBJECT_MIN_W}px, 1fr) ` +
        `minmax(${AUTHOR_MIN_W}px, ${AUTHOR_COL_W}px) ${DATE_COL_W.relative}px`,
    );
  });

  // The floors are only worth anything if they FIT. Past the sum of the
  // minimum tracks the grid overflows its pane and the date falls off the
  // right edge, so the narrowest pane the app can produce has to hold them.
  //
  // Asserted at EVERY text preset, not only at x1: the columns are sized to
  // text, so they all move together and a floor that stayed at 420 would push
  // the Date column off the edge the moment someone picked Large. The sum is
  // re-derived from commitRowGrid's own template rather than from the same
  // expression commitListMinW uses -- otherwise this asserts nothing, and what
  // it is here to catch is a NEW fixed column added to the grid and not to the
  // formula.
  it("fits every minimum inside the narrowest commit list, at every text preset", () => {
    for (const scale of Object.values(TEXT_SCALE)) {
      const template = commitRowGrid(graphWidth(4), dateColW("relative", scale), scale);
      const tracks = template.split(" ");
      const sum = tracks.reduce((acc, t) => {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(t);
        if (px) return acc + Number.parseFloat(px[1]);
        const mm = /^minmax\((\d+(?:\.\d+)?)px,/.exec(t);
        if (mm) return acc + Number.parseFloat(mm[1]);
        return acc;
      }, 0);
      expect(sum, `scale ${scale}`).toBeLessThanOrEqual(commitListMinW(scale));
    }
  });

  // The avatar and the flex gap after it are not type, so they do not scale --
  // but COL_PAD does, because it exists to make the NAME truncate before it
  // touches the date. Below this the "who" goes as well as the name.
  it("keeps the author's avatar inside the author minimum at every preset", () => {
    for (const scale of Object.values(TEXT_SCALE)) {
      expect(authorMinW(scale), `scale ${scale}`).toBeGreaterThanOrEqual(
        16 + 6 + colPad(scale),
      );
    }
  });

  // A sha is seven hex digits of monospace: the column is sized to text, so it
  // has to move with text or it truncates the one value truncation destroys.
  it("grows the sha and date columns with the text scale", () => {
    expect(shaColW(1)).toBe(SHA_COL_W);
    expect(shaColW(1.3)).toBeGreaterThan(SHA_COL_W);
    expect(dateColW("relative", 1)).toBe(DATE_COL_W.relative);
    expect(dateColW("relative", 1.3)).toBeGreaterThan(DATE_COL_W.relative);
  });
});

describe("PGCommitRow cell clipping", () => {
  function cells() {
    const { container } = render(
      <PGCommitRow
        graphW={graphWidth(0)}
        sha="abc1234"
        message="feat(commits): a subject far too long for a narrow pane"
        author="Gaurav Vijay Jadhav"
        date="14 min ago"
        refs={[{ name: "main", tone: "accent", icon: "branch" }]}
      />,
    );
    const subject = container.querySelector<HTMLElement>(
      '[data-testid="commit-subject"]',
    )!;
    const date = container.querySelector<HTMLElement>('[data-testid="commit-date"]')!;
    return {
      subject: subject.parentElement!,
      author: date.previousElementSibling as HTMLElement,
    };
  }

  // The pills and the HEAD badge do not shrink (a half-pill reads as a
  // different branch name), so past the subject floor they have to be CUT
  // rather than allowed to spill into the author column.
  it("clips the subject cell", () => {
    const { subject } = cells();
    expect(subject.style.overflow).toBe("hidden");
    // jsdom's CSSOM normalises the `minWidth: 0` React writes to "0px".
    expect(subject.style.minWidth).toBe("0px");
  });

  // Not only a narrow-pane bug: "Gaurav Vijay Jadhav" ran over the date at
  // EVERY width, because the author cell had neither a 0 minimum nor a clip.
  it("clips the author cell", () => {
    const { author } = cells();
    expect(author.style.overflow).toBe("hidden");
    expect(author.style.minWidth).toBe("0px");
  });
});
