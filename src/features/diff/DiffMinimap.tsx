// The scrubable minimap gutter (#161 part 2).
//
// A canvas miniature of the file down the side of a diff: per-line bars whose
// width is the line's content extent and whose colour is its change kind, plus a
// viewport indicator, plus click/drag scrubbing.
//
// Everything hard lives in `lib/diffMinimap.ts` (pure, tested in node) and
// `lib/cssColor.ts` (pure, tested in node). What is left here is the three things
// that genuinely need the platform: measuring, painting, and the pointer gesture.
import React from "react";
import { parseCssColor, rgbaCss, type Rgba } from "@/lib/cssColor";
import type { DiffRow } from "@/lib/diffRows";
import { rowOffset } from "@/lib/diffRows";
import {
  MINIMAP_COLS,
  MINIMAP_MIN_CHANGED_FRAC,
  MINIMAP_MIN_CONTAINER_W,
  MINIMAP_W,
  buildMinimapBands,
  grabDyFor,
  minimapGeom,
  minimapMarks,
  scrubScrollTop,
  viewportBand,
  type MinimapBand,
  type MinimapGeom,
} from "@/lib/diffMinimap";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

/**
 * Tokens the gutter paints with. Read from `:root`, never restated — a custom
 * theme's accent and background carry through, and the mode-calibrated diff
 * colours (#61 B4) are inherited rather than duplicated.
 */
const TOKENS = [
  "--git-added",
  "--git-removed",
  "--git-modified",
  "--fg-3",
  "--bg-1",
  "--border-1",
  "--accent",
] as const;

type Token = (typeof TOKENS)[number];

/**
 * Used only when a token cannot be READ at all — jsdom, or a `:root` stripped of
 * the pre-hydration defaults. Tabulated per MODE for the same reason
 * `SEMANTIC_TOKENS` is: a dark-calibrated fallback over a light canvas is
 * washed out. The dark diff values are byte-identical to `SEMANTIC_TOKENS.dark`.
 */
const FALLBACK: Record<"dark" | "light", Record<Token, string>> = {
  dark: {
    "--git-added": "oklch(0.72 0.15 155)",
    "--git-removed": "oklch(0.68 0.18 25)",
    "--git-modified": "oklch(0.75 0.14 75)",
    "--fg-3": "#656b77",
    "--bg-1": "#1e222a",
    "--border-1": "#393f4b",
    "--accent": "#5aa8e8",
  },
  light: {
    "--git-added": "oklch(0.55 0.16 155)",
    "--git-removed": "oklch(0.54 0.20 25)",
    "--git-modified": "oklch(0.58 0.14 75)",
    "--fg-3": "#8c959f",
    "--bg-1": "#f6f8fa",
    "--border-1": "#afb8c1",
    "--accent": "#0969da",
  },
};

/**
 * How MUCH of each token to lay down, per theme MODE — and this table is the one
 * thing the gutter genuinely has to calibrate for light mode itself.
 *
 * The tokens are already mode-calibrated (`SEMANTIC_TOKENS`, #61 B4) and the
 * gutter inherits that. What does NOT carry over is the ALPHA: dark mode lays a
 * light `--fg-3` over a near-black gutter, where a third of it is plenty of
 * contrast; light mode lays a mid-grey over near-white, where the same third is
 * almost invisible. MEASURED on a rendered light theme, not guessed — the first
 * light screenshot had a gutter that read as an empty white column.
 */
interface MinimapAlpha {
  /** Context texture. Quiet enough that changes stand out, loud enough to read. */
  ctx: number;
  /** Viewport band fill, idle and while scrubbing. */
  band: number;
  bandScrub: number;
  /** Viewport band outline. */
  bandEdge: number;
  /** A fold separator's full-width rule. */
  fold: number;
}

const ALPHA: Record<"dark" | "light", MinimapAlpha> = {
  dark: { ctx: 0.34, band: 0.2, bandScrub: 0.34, bandEdge: 0.85, fold: 0.9 },
  light: { ctx: 0.6, band: 0.26, bandScrub: 0.42, bandEdge: 1, fold: 0.95 },
};

export interface MinimapPalette {
  color: Record<Token, Rgba>;
  alpha: MinimapAlpha;
}

function readPalette(): MinimapPalette {
  const root = typeof document === "undefined" ? null : document.documentElement;
  const mode = root?.dataset.themeMode === "light" ? "light" : "dark";
  const computed = root ? getComputedStyle(root) : null;
  const color = {} as Record<Token, Rgba>;
  for (const token of TOKENS) {
    // A custom property computes to its declared TOKEN STREAM, so this returns
    // the literal `oklch(...)` on every engine — parsed or not — and
    // `parseCssColor` converts it before it can reach a canvas. See cssColor.ts
    // for why handing the raw string on would be a silent no-op on WebKitGTK.
    const raw = computed?.getPropertyValue(token) ?? "";
    color[token] = parseCssColor(raw) ?? parseCssColor(FALLBACK[mode][token])!;
  }
  return { color, alpha: ALPHA[mode] };
}

/**
 * The palette, re-read when the theme changes.
 *
 * A store subscription rather than an observer, and BOTH fields are needed:
 * `activeThemeId` covers switching theme, `customThemes` covers editing the live
 * theme's colours — which keeps the same id, so the id alone would miss it.
 * Density arrives separately, through the `rowH` prop.
 */
function useMinimapPalette(): MinimapPalette {
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const customThemes = useSettingsStore((s) => s.customThemes);
  return React.useMemo(
    () => readPalette(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeThemeId, customThemes],
  );
}

/**
 * Device pixel ratio, re-read on resize.
 *
 * Resize is what a move between displays of different density fires, and it is
 * universal — unlike a `matchMedia("(resolution: …)")` listener, which would have
 * to be re-registered at every new ratio.
 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = React.useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  React.useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return dpr;
}

export interface DiffMinimapProps {
  rows: DiffRow[];
  /** `rows.map(r => r.h)`, which every surface already holds. */
  heights: number[];
  /** Code-row pitch from `--diff-row-h`; sets the uncompressed minimap scale. */
  rowH: number;
  scrollTop: number;
  viewportH: number;
  /** The element the scrub scrolls. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Reports the CLAMPED result back, so the band never leads the content. */
  onScrollTop: (next: number) => void;
  /**
   * Measured width of the wrapper holding the scroll area AND this gutter.
   * 0 means "not measured yet" and must not read as "no space".
   */
  containerWidth: number;
  /** Measured height of that same wrapper — the gutter's height. */
  containerHeight: number;
  testId?: string;
}

export function DiffMinimap({
  rows,
  heights,
  rowH,
  scrollTop,
  viewportH,
  scrollRef,
  onScrollTop,
  containerWidth,
  containerHeight,
  testId = "diff-minimap",
}: DiffMinimapProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const palette = useMinimapPalette();
  const dpr = useDevicePixelRatio();
  const [scrubbing, setScrubbing] = React.useState(false);
  // Non-null for a drag that started ON the band; see grabDyFor.
  const grabDy = React.useRef<number | null>(null);
  /**
   * Set the first time a real `pointerdown` arrives, and the gate on the mouse
   * fallback below.
   *
   * MEASURED on the e2e target (WebKitGTK 605.1.15 / xvfb, the same webview CI
   * drives): a WebDriver pointer action there delivers `mousedown` and NO
   * `pointerdown`, even though `window.PointerEvent` is a function and
   * `"onpointerdown" in window` is true. So a pointer-events-only gesture is
   * dead on that stack — and the minimap is the one control whose whole purpose
   * IS the gesture, unlike `features/dnd`, where every drag has a keyboard
   * equivalent by rule.
   *
   * A compliant browser fires `pointerdown` BEFORE `mousedown` for the same
   * gesture, so this flag is already set by the time `mousedown` arrives and the
   * fallback declines — the two paths cannot both run for one press.
   */
  const sawPointer = React.useRef(false);
  /** True while the fallback owns the drag, so its document listeners attach. */
  const [mouseScrub, setMouseScrub] = React.useState(false);

  const contentH = React.useMemo(() => rowOffset(heights, heights.length), [heights]);
  const geom = React.useMemo(
    () => minimapGeom({ contentH, canvasH: containerHeight, rowH }),
    [contentH, containerHeight, rowH],
  );
  const marks = React.useMemo(() => minimapMarks(rows), [rows]);
  const bands = React.useMemo(
    () => buildMinimapBands({ marks, heights, geom, dpr }),
    [marks, heights, geom, dpr],
  );
  const band = viewportBand(geom, { scrollTop, viewportH });

  // 0 is "unmeasured", which is not the same as "too narrow" — the useElementSize
  // contract. Hiding on 0 would blank the gutter for a frame on every mount, and
  // forever on a webview where only the attach-time read lands.
  const tooNarrow = containerWidth > 0 && containerWidth < MINIMAP_MIN_CONTAINER_W;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // jsdom has no 2D context; a component test must not crash on that.
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    paintMinimap(ctx, {
      bands,
      geom,
      band,
      palette,
      dpr,
      width: MINIMAP_W,
      height: containerHeight,
      scrubbing,
    });
  }, [bands, geom, band.top, band.height, palette, dpr, containerHeight, scrubbing]);

  const scrubTo = React.useCallback(
    (clientY: number) => {
      const canvas = canvasRef.current;
      const el = scrollRef.current;
      if (!canvas || !el) return;
      const y = clientY - canvas.getBoundingClientRect().top;
      const next = scrubScrollTop(geom, heights, {
        y,
        grabDy: grabDy.current,
        viewportH,
      });
      el.scrollTop = next;
      // Report what the element ACTUALLY took: its own max may differ from ours by
      // a pane's padding, and the band must follow the content, not the intent.
      onScrollTop(el.scrollTop);
    },
    [geom, heights, viewportH, scrollRef, onScrollTop],
  );

  /** Begin a scrub from either input path: decide grab vs centre, then apply. */
  const beginScrub = React.useCallback(
    (el: HTMLCanvasElement, clientY: number) => {
      grabDy.current = grabDyFor(geom, {
        y: clientY - el.getBoundingClientRect().top,
        scrollTop,
        viewportH,
      });
      setScrubbing(true);
      scrubTo(clientY);
    },
    [geom, scrollTop, viewportH, scrubTo],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    sawPointer.current = true;
    // Left button only — a right-click belongs to whatever menu the pane has.
    if (e.button !== 0) return;
    // Captured, so the drag survives leaving the gutter. A scrub that dies when
    // the cursor strays 60px sideways is worse than none. Guarded on the id
    // because jsdom has no PointerEvent, so a component test's synthetic event
    // carries none — and capture is an enhancement, not the gesture.
    if (typeof e.pointerId === "number") {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    beginScrub(e.currentTarget, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!scrubbing) return;
    e.preventDefault();
    scrubTo(e.clientY);
  };

  /**
   * The fallback for a stack that delivers mouse events only (see `sawPointer`).
   * There is no pointer capture on this path, so the drag is followed on
   * `document` — the same shape `PGResizeHandle` uses for the same reason.
   */
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (sawPointer.current || e.button !== 0) return;
    e.preventDefault();
    setMouseScrub(true);
    beginScrub(e.currentTarget, e.clientY);
  };

  React.useEffect(() => {
    if (!mouseScrub) return;
    const move = (e: MouseEvent) => scrubTo(e.clientY);
    const up = () => {
      grabDy.current = null;
      setMouseScrub(false);
      setScrubbing(false);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [mouseScrub, scrubTo]);

  /**
   * Forward the wheel to the diff.
   *
   * The gutter is a SIBLING of the scroll container, not a child, so a wheel
   * event over it would otherwise reach no scrollable ancestor and the page would
   * sit still — the one place in the app where the wheel does nothing.
   */
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop += e.deltaY;
    onScrollTop(el.scrollTop);
  };

  const endScrub = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!scrubbing) return;
    if (typeof e.pointerId === "number") {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    grabDy.current = null;
    setScrubbing(false);
  };

  if (tooNarrow || rows.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      data-pg-minimap=""
      data-testid={testId}
      data-scrubbing={scrubbing ? "" : undefined}
      // Hidden from assistive tech on purpose, and it is not a gap: the gutter
      // adds no OPERATION, only a faster way to scroll, and the scroll container
      // beside it is labelled, focusable and fully keyboard-driven (arrows,
      // PageUp/Down, Home/End, F7 across hunks, the diff line cursor). A canvas
      // of painted rectangles has nothing to announce, and exposing it would put
      // an unreachable control in the tab order.
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      style={{
        width: MINIMAP_W,
        height: "100%",
        flexShrink: 0,
        borderLeft: "1px solid var(--border-0)",
        // The gutter is a scroll affordance, so it takes the cursor a scrollbar
        // would, and never the text cursor of the code beside it.
        cursor: scrubbing ? "grabbing" : "pointer",
        // A scrub is a pointer gesture; the browser must not claim it as a pan.
        touchAction: "none",
        userSelect: "none",
      }}
    />
  );
}

/**
 * Paint one frame. Thin on purpose — the arithmetic is `buildMinimapBands`, so
 * this is a loop over already-decided rectangles.
 *
 * Order matters: background, then CONTEXT, then CHANGES on top, then folds, then
 * the viewport indicator. Context under changes is what keeps a lone changed line
 * from being painted over by its neighbours.
 */
function paintMinimap(
  ctx: CanvasRenderingContext2D,
  o: {
    bands: MinimapBand[];
    geom: MinimapGeom;
    band: { top: number; height: number };
    palette: MinimapPalette;
    dpr: number;
    width: number;
    height: number;
    scrubbing: boolean;
  },
) {
  const { bands, band, dpr, width, height, scrubbing } = o;
  const c = o.palette.color;
  const a = o.palette.alpha;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  const canvas = ctx.canvas;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgbaCss(c["--bg-1"]);
  ctx.fillRect(0, 0, w, h);

  const colW = w / MINIMAP_COLS;
  const minChangedW = w * MINIMAP_MIN_CHANGED_FRAC;
  const bar = (from: number, to: number, y: number, minW: number) => {
    const x = Math.min(from * colW, w - minW);
    const wide = Math.max(minW, (to - from) * colW);
    ctx.fillRect(Math.max(0, x), y, Math.min(wide, w - Math.max(0, x)), 1);
  };

  // Context: shape only. Kept deliberately faint — at any real compression
  // adjacent lines land in the same device pixel, so a high alpha merges the
  // whole file into one opaque slab and the changes stop standing out against it.
  ctx.fillStyle = rgbaCss(c["--fg-3"], a.ctx);
  for (let p = 0; p < bands.length; p++) {
    const cx = bands[p].ctx;
    if (cx) bar(cx.from, cx.to, p, Math.max(1, colW));
  }

  // Changes: full strength, and never narrower than the floor — a change marker
  // that can be missed is not a marker.
  for (let p = 0; p < bands.length; p++) {
    const ch = bands[p].change;
    if (!ch) continue;
    ctx.fillStyle = rgbaCss(
      ch.kind === "add"
        ? c["--git-added"]
        : ch.kind === "rem"
          ? c["--git-removed"]
          : c["--git-modified"],
    );
    bar(ch.from, ch.to, p, minChangedW);
  }

  // A fold separator hides a run of the file; draw the discontinuity full width so
  // the miniature does not read as continuous where it is not.
  ctx.fillStyle = rgbaCss(c["--border-1"], a.fold);
  for (let p = 0; p < bands.length; p++) {
    if (bands[p].fold) ctx.fillRect(0, p, w, 1);
  }

  // The on-screen slice. Derived from scrollTop in every state, scrubbing
  // included — see viewportBand. Scrubbing changes emphasis only.
  if (band.height > 0) {
    const by = Math.round(band.top * dpr);
    const bh = Math.max(Math.round(dpr), Math.round(band.height * dpr));
    ctx.fillStyle = rgbaCss(c["--fg-3"], scrubbing ? a.bandScrub : a.band);
    ctx.fillRect(0, by, w, bh);
    // The idle outline is `--fg-3`, not `--border-1`: a border token sits close
    // to the background it borders, which is right for a 1px rule between panes
    // and invisible around a translucent band inside a dim gutter.
    ctx.strokeStyle = rgbaCss(
      scrubbing ? c["--accent"] : c["--fg-3"],
      scrubbing ? 1 : a.bandEdge,
    );
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    const inset = ctx.lineWidth / 2;
    ctx.strokeRect(inset, by + inset, w - ctx.lineWidth, Math.max(0, bh - ctx.lineWidth));
  }
}
