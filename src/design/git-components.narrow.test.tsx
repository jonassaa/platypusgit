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
  COL_PAD,
  COMMIT_LIST_MIN_W,
  DATE_COL_W,
  SHA_COL_W,
  SUBJECT_MIN_W,
  commitRowGrid,
  graphWidth,
} from "./graph-geometry";

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
  // right edge, so the narrowest pane the app can produce has to hold them:
  // COMMIT_LIST_MIN_W is that pane. Raising a column's minimum — or the Date
  // column's width — without checking this is how the row starts overflowing
  // again at the bottom of the drag.
  it("fits every minimum inside the narrowest commit list", () => {
    const min =
      graphWidth(4) + SHA_COL_W + SUBJECT_MIN_W + AUTHOR_MIN_W + DATE_COL_W.relative;
    expect(min).toBeLessThanOrEqual(COMMIT_LIST_MIN_W);
  });

  // Avatar 16px, the flex gap after it, and COL_PAD: below that the "who" goes
  // as well as the name — a column that costs space and says nothing — or the
  // avatar ends up touching the date.
  it("keeps the author's avatar inside the author minimum", () => {
    expect(AUTHOR_MIN_W).toBeGreaterThanOrEqual(16 + 6 + COL_PAD);
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
