// PGErrorBanner — the one surface an `AppError` is reported on (#212).
//
// Two defects lived in the markup this component replaces, and both are pinned
// here because neither was visible to a test of `appErrorMessage` alone:
//
//  1. The banner printed the ENUM's spelling. `appErrorMessage` was written so
//     it never would — `docs/dev/backend.md` says as much — and then both
//     banners bolted `{error.kind}` back on in front of it. A fresh machine's
//     first commit read "NoSignature: git needs a name and an email address…",
//     a failed push read "Network: …". `test/appErrors.test.ts` could not see
//     it: it asked the formatter, and the formatter was innocent.
//
//  2. Multi-line git output collapsed into one run-on line. A rejected
//     non-fast-forward push is `! [rejected] … (fetch first)` plus git's
//     four-line `hint:` paragraph; `ProgressReader` keeps all of it
//     (`DEFAULT_TAIL_LINES`) and the banner then threw the shape away, so the
//     hint that names the fix ran into the line above it.
//
// The first assertion runs over the REAL Rust enum, so a variant added tomorrow
// is covered whether or not anyone remembers this file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AppError } from "@/lib/errors";
import { PGErrorBanner } from "./error-banner";

/** Every variant of Rust's `AppError`, parsed the way `appErrors.test.ts`
 *  parses it — the enum declaration is where a variant comes into existence. */
function rustVariants(): string[] {
  const src = readFileSync(
    resolve(process.cwd(), "src-tauri/src/error.rs"),
    "utf8",
  );
  const start = src.indexOf("pub enum AppError {");
  const block = src.slice(start, src.indexOf("\n}", start));
  const names = [...block.matchAll(/^ {4}([A-Z][A-Za-z0-9]*)(\(|,)/gm)].map(
    (m) => m[1],
  );
  expect(names.length, "parsed no AppError variants").toBeGreaterThan(20);
  return names;
}

/** A sentence that shares no substring with any variant's spelling, so a hit
 *  below can only have come from the discriminant. */
const PROSE = "the sentence a human is supposed to read";

const banner = (error: AppError) =>
  render(<PGErrorBanner error={error} onDismiss={() => {}} />);

describe("PGErrorBanner", () => {
  it("never puts a variant's own spelling on screen", () => {
    for (const kind of rustVariants()) {
      const { unmount } = banner({ kind, message: PROSE } as AppError);
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text, `${kind} leaked its enum spelling into the banner`).not.toContain(
        kind,
      );
      // ...and said SOMETHING. Several variants answer with prose of their own
      // rather than the payload (`Unborn`, `NoSignature`, `StaleStash`), which
      // is the point of `appErrorDetail` — so this asserts a sentence exists,
      // not which sentence it is.
      const said = screen.getByTestId("banner-text").textContent ?? "";
      expect(said.length, `${kind} rendered an empty banner`).toBeGreaterThan(10);
      unmount();
    }
  });

  it("leads with a written category only where somebody wrote one", () => {
    // Two variants keep a bold prefix because the backend keeps them terse and
    // the category is the fastest way to recognise the situation.
    banner({ kind: "EmbeddedRepo", message: "embedded repository: vendor/lib/" });
    expect(screen.getByTestId("banner-label").textContent).toContain(
      "Embedded repository",
    );
  });

  it("has no label at all for a variant whose sentence stands alone", () => {
    banner({ kind: "Network", message: "fatal: could not resolve host" });
    expect(screen.queryByTestId("banner-label")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "could not resolve host",
    );
  });

  it("carries the remediation prose for an embedded repository", () => {
    banner({ kind: "EmbeddedRepo", message: "embedded repository: vendor/lib/" });
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toContain("vendor/lib/");
    expect(text).toContain(".gitignore");
    // The backend's own prefix is the enum's vocabulary, not the user's.
    expect(text).not.toContain("embedded repository:");
  });

  it("carries the remediation prose for a dubious-ownership refusal", () => {
    banner({
      kind: "DubiousOwnership",
      message: "repository is owned by another user: /mnt/c/dev/x",
    });
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toContain("/mnt/c/dev/x");
    expect(text).toContain("safe.directory");
  });

  it("keeps every line of git's multi-line output", () => {
    // Verbatim from a rejected non-fast-forward push. The `hint:` paragraph is
    // the half that says what to do, and it is the half a collapsed banner ran
    // together with the line above it.
    const push = [
      " ! [rejected]        main -> main (fetch first)",
      "error: failed to push some refs to 'origin'",
      "hint: Updates were rejected because the remote contains work that you do",
      "hint: not have locally. This is usually caused by another repository",
      "hint: pushing to the same ref.",
    ].join("\n");
    banner({ kind: "Network", message: push });
    const body = screen.getByTestId("banner-text");
    expect(body.textContent).toBe(push);
    // `pre-wrap`, not `pre`: the newlines survive AND a long line still wraps
    // inside the strip rather than scrolling the whole app sideways.
    expect(body.style.whiteSpace).toBe("pre-wrap");
  });

  it("dismisses", async () => {
    const onDismiss = vi.fn();
    render(
      <PGErrorBanner
        error={{ kind: "Git", message: "boom" }}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
