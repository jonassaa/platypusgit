/**
 * @vitest-environment node
 */
// The app must not open with a white flash, and must not open with no window
// at all.
//
// Both properties rest on values that live in four different files and have no
// compiler relationship to each other:
//
//   - `--bg-0` in src/index.css              — what the CSS eventually paints
//   - `backgroundColor` in tauri.conf.json   — the WINDOW layer, before any document
//   - the inline `background` in index.html  — the DOCUMENT, before any stylesheet
//   - `backgroundColor` in openMergeWindow   — the same, for the resolver window
//   - `backgroundColor` in openAppWindow     — the same, for a repository window
//
// Nothing else notices when one of them changes. Re-theme the default palette,
// or drop the config key while debugging something else, and the app quietly
// goes back to flashing white on every launch — the exact bug this set of
// values was introduced to remove, with no test failing and nothing to read in
// a diff.
//
// The other half is worse. The main window is created with `"visible": false`
// and is shown by the frontend (src/lib/revealWindow.tsx). Delete that call and
// platypusgit becomes a process with no UI. **E2E cannot catch this**: WebDriver
// attaches to the webview, not to the window, so the whole suite passes green
// against an app that never appears on screen. That is why the wiring is
// asserted here, statically, rather than left to an integration test.
//
// Lives in `test/` rather than `src/` for the reason docs.test.ts does: it
// asserts things about src-tauri/ and index.html, and is not a frontend test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
const indexHtml = read("index.html");
const indexCss = read("src/index.css");
const mergeWindow = read("src/features/merge/openMergeWindow.ts");
const appWindow = read("src/features/windows/openAppWindow.ts");
const mainTsx = read("src/main.tsx");

const mainWindow = tauriConf.app.windows.find(
  (w: { title?: string }) => w.title === "PlatypusGit",
);

/** `#rrggbb` → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * `oklch(L C H)` → sRGB [r, g, b].
 *
 * Hand-rolled rather than pulled from a colour library, matching the trade
 * msixIcons.test.ts documents: one dependency for one assertion is the wrong
 * trade, and this is the standard OKLab matrix pair, not a judgement call.
 */
function oklchToRgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const H = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }) as [number, number, number];
}

describe("the app's first paint is dark, not white", () => {
  it("gives the main window a background colour at the WINDOW layer", () => {
    // Without this the OS window itself is white while the webview starts up,
    // which no amount of CSS can reach.
    expect(mainWindow?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("gives index.html an inline background, for the paint before any CSS", () => {
    // A stylesheet is a separate request; the document paints before it lands.
    const html = /<html[^>]*style="[^"]*background:\s*(#[0-9a-f]{6})/i.exec(indexHtml);
    expect(
      html,
      "index.html's <html> element needs an inline `background: #rrggbb`",
    ).not.toBeNull();
    expect(html![1].toLowerCase()).toBe(mainWindow.backgroundColor.toLowerCase());
  });

  it("declares a dark color-scheme, so the engine's own chrome starts dark", () => {
    expect(indexHtml).toMatch(
      /<meta\s+name="color-scheme"\s+content="dark[^"]*"/i,
    );
  });

  it("opens the merge resolver on the same colour", () => {
    const merge = /backgroundColor:\s*"(#[0-9a-f]{6})"/i.exec(mergeWindow);
    expect(merge, "openMergeWindow needs a backgroundColor").not.toBeNull();
    expect(merge![1].toLowerCase()).toBe(mainWindow.backgroundColor.toLowerCase());
  });

  it("opens a second REPOSITORY window on the same colour (#256)", () => {
    // Same trade as the resolver's, and the same reason it has to be asserted
    // here: a runtime-created window inherits nothing from tauri.conf.json, so
    // the value is a fourth copy with no compiler relationship to the other
    // three. This one names its colour, so both halves are checked — the
    // constant's value, and that it is what actually reaches the window.
    const decl = /WINDOW_BACKGROUND\s*=\s*"(#[0-9a-f]{6})"/i.exec(appWindow);
    expect(decl, "openAppWindow needs a WINDOW_BACKGROUND constant").not.toBeNull();
    expect(decl![1].toLowerCase()).toBe(mainWindow.backgroundColor.toLowerCase());
    expect(
      appWindow,
      "the window creation must actually pass WINDOW_BACKGROUND",
    ).toMatch(/backgroundColor:\s*WINDOW_BACKGROUND/);
  });

  it("creates a second repository window HIDDEN, like the main one", () => {
    // The other half of the same trade — see the reveal suite below. A window
    // created visible flashes an empty frame; RevealOnFirstPaint runs in every
    // window, so a sibling gets the same already-drawn open the main one does.
    expect(appWindow).toMatch(/visible:\s*false/);
  });

  it("keeps that colour tracking --bg-0 of the default dark theme", () => {
    // The window/document background exists to be INDISTINGUISHABLE from the
    // first styled paint. If the palette moves and these do not, the flash
    // comes back as a dark-grey-to-other-dark-grey jump instead of white — less
    // ugly, still wrong, and much harder to notice by hand.
    const decl = /--bg-0:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(indexCss);
    expect(decl, "src/index.css must declare --bg-0 as oklch(L C H)").not.toBeNull();
    const [, L, C, H] = decl!;
    const expected = oklchToRgb(Number(L), Number(C), Number(H));
    const actual = hexToRgb(mainWindow.backgroundColor);
    // ±2 per channel: enough slack for rounding and for a nudge to the palette
    // that is genuinely invisible, tight enough that a real theme change fails.
    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(actual[i] - expected[i]),
        `channel ${"rgb"[i]}: config has ${actual[i]}, --bg-0 renders ${expected[i]}`,
      ).toBeLessThanOrEqual(2);
    }
  });
});

describe("the hidden main window always gets shown", () => {
  it("is created hidden", () => {
    // Not an accident to be tidied away: the reveal below is what replaces it.
    expect(mainWindow?.visible).toBe(false);
  });

  it("grants the window:show permission the reveal needs", () => {
    const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(caps.permissions).toContain("core:window:allow-show");
  });

  it("mounts the reveal from main.tsx", () => {
    expect(mainTsx).toMatch(/from\s+"\.\/lib\/revealWindow"/);
    expect(mainTsx).toMatch(/<RevealOnFirstPaint\s*\/>/);
  });

  it("mounts the reveal OUTSIDE the error boundary", () => {
    // Inside, a throw from the app swaps the reveal out for the boundary's
    // fallback before its effect runs — so the "something went wrong" screen
    // renders into a window that is never shown, which is the single worst
    // outcome available here.
    const reveal = mainTsx.indexOf("<RevealOnFirstPaint");
    const boundary = mainTsx.indexOf("<PGErrorBoundary");
    expect(reveal).toBeGreaterThan(-1);
    expect(boundary).toBeGreaterThan(-1);
    expect(
      reveal,
      "<RevealOnFirstPaint /> must be a sibling before <PGErrorBoundary>, not a child",
    ).toBeLessThan(boundary);
  });

  it("keeps a Rust-side backstop for a frontend that never gets there", () => {
    // A bundle that throws at module scope never reveals anything, and the
    // config says the window starts hidden. Something has to break that tie.
    const libRs = read("src-tauri/src/lib.rs");
    expect(libRs).toMatch(/SHOW_WINDOW_FALLBACK_MS/);
    expect(libRs).toMatch(/is_visible\(\)/);
    expect(libRs).toMatch(/win\.show\(\)/);
  });
});
