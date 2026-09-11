// PGColorSwatch — a colour swatch that opens a real picker.
//
// It replaced `<input type="color">`, which was never a picker so much as a
// hand-off: whatever dialog the host webview felt like showing, if it showed
// one at all. That is a bad deal on three counts. The dialog is unstyled and
// unthemed, so choosing a dark theme's greys happens in a bright OS panel; it
// offers hex and an OS colour model but nothing that helps build a RAMP, which
// is what a theme actually is; and on WebKitGTK a native control of this shape
// is exactly the kind that quietly does nothing (see `lib/userFile.ts` and the
// `<a download>` story — a webview is not a browser).
//
// The arithmetic lives elsewhere on purpose. `lib/color.ts` owns the spaces and
// the channel registry, `colorWheel.ts` owns where things are, and both are
// pure — so what is left here is wiring, which is the only part jsdom can
// actually judge. See `color-picker.test.tsx`.
//
// Two rules this file inherits rather than invents:
//   * Escape comes through the keymap's `app.closeOverlay`, never a local
//     listener — the same registration PGSelect documents at length. Registered
//     always, DECLINING while closed, so a picker open inside the theme editor
//     eats Escape and the dialog survives, and a closed one gives the chord
//     back.
//   * The popover is `position: fixed` and portalled, placed by `selectPos.ts`,
//     because the shell is a fixed frame: a popup off the viewport is not ugly,
//     it is unreachable.

import React from "react";
import { createPortal } from "react-dom";

import { useAction } from "@/features/keymap/useAction";
import {
  COLOR_MODELS,
  colorModel,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  trackStops,
  type ColorChannel,
  type ColorModel,
  type Hsv,
} from "@/lib/color";
import { pressIsInsideMenu, useContextMenu } from "./context-menu";
import { PGIcon } from "./icons";
import { pgFlash } from "./ui-helpers";
import { selectPopoverPos } from "./selectPos";
import {
  paintWheelRgba,
  sliderFraction,
  sliderValue,
  wheelHueSatClamped,
  wheelPoint,
} from "./colorWheel";

/** One entry in the palette row. */
export interface ColorSwatchOption {
  hex: string;
  label: string;
}

export interface PGColorSwatchProps {
  /** The field this edits, for the trigger's accessible name. */
  label: string;
  value: string;
  /**
   * Every change, including each frame of a drag.
   *
   * Live on purpose: the theme editor's `patchColors` applies to `:root`, so
   * dragging repaints the actual application behind the dialog. That is the
   * feedback the old native dialog could not give at any price.
   */
  onChange: (hex: string) => void;
  /**
   * The colour the popover closed on, once, when it was KEPT.
   *
   * Separate from `onChange` because a recents list wants the colour someone
   * settled on, not the four hundred it passed through on the way.
   */
  onCommit?: (hex: string) => void;
  /** Colours to offer alongside the wheel — in the theme editor, the palette. */
  swatches?: ColorSwatchOption[];
  /** Recently chosen colours, newest first. */
  recent?: string[];
  /** A pair to measure while dragging, where a low ratio is still fixable. */
  contrast?: { against: string; label: string };
  /** Trailing content in the trigger row, e.g. a ratio badge. */
  title?: string;
}

const WHEEL_SIZE = 168;
const VALUE_W = 18;
const POPOVER_W = 268;

export function PGColorSwatch({
  label,
  value,
  onChange,
  onCommit,
  swatches,
  recent,
  contrast,
  title,
}: PGColorSwatchProps) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{
    left: number;
    top: number;
    bottom: number;
    width: number;
  } | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * The colour the popover opened on. Escape puts it back — a dismissal is not
   * an answer, the rule `pgConfirm` and the theme editor's own `close()` both
   * follow.
   */
  const opened = React.useRef(value);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
    opened.current = value;
    setPos(null);
    setOpen(true);
  };

  /** Close, keeping the colour. */
  const keep = React.useCallback(() => {
    setOpen(false);
    if (value !== opened.current) onCommit?.(value);
  }, [value, onCommit]);

  /** Close, putting the colour back where it was. */
  const revert = React.useCallback(() => {
    setOpen(false);
    if (value !== opened.current) onChange(opened.current);
  }, [value, onChange]);

  const menu = useContextMenu<void>(() => [
    {
      icon: "copy",
      label: `Copy ${value}`,
      onClick: () => {
        navigator.clipboard?.writeText(value);
        pgFlash(`copied ${value}`);
      },
    },
    {
      // No clipboard glyph in the set, and `test/iconSet.test.ts` fails the
      // build for a literal the union does not declare — a paste is an
      // incoming copy, so "download" is the honest one of what is there.
      icon: "download",
      label: "Paste colour",
      onClick: async () => {
        const text = await navigator.clipboard?.readText?.();
        const hex = text ? normalizeHex(text) : null;
        if (!hex) {
          pgFlash("clipboard holds no colour");
          return;
        }
        onChange(hex);
        onCommit?.(hex);
      },
    },
  ]);

  // Placed once the panel has a measured box, in a layout effect so the placed
  // position is what paints. The arithmetic is `selectPos.ts`'s, where it can be
  // tested with real numbers.
  React.useLayoutEffect(() => {
    if (!open || !anchor) return;
    const el = panelRef.current;
    if (!el) return;
    setPos(
      selectPopoverPos({
        anchor,
        listW: el.offsetWidth,
        listH: el.offsetHeight,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      }),
    );
  }, [open, anchor]);

  React.useEffect(() => {
    if (!open) return;
    // A context menu opened from the swatch is portalled onto `document.body`,
    // so `contains` reads a press on it as a press outside the popover: the
    // popover would close on mousedown, taking the menu with it, and the
    // entry's click would land on a detached node doing nothing (#422). Hence
    // `pressIsInsideMenu` — the guard every self-dismissing surface here owes.
    const inside = (t: Node | null) =>
      !!t &&
      !!(
        btnRef.current?.contains(t) ||
        panelRef.current?.contains(t) ||
        pressIsInsideMenu(t)
      );
    const outside = (e: Event) => {
      if (inside(e.target as Node | null)) return;
      keep();
    };
    // A fixed popup cannot follow a scrolling anchor or a resized window — both
    // detach it from the trigger, so close rather than chase. The panel has its
    // own scrollable rows, hence the inside() guard on a capture-phase listener.
    const onScroll = (e: Event) => {
      if (inside(e.target as Node | null)) return;
      keep();
    };
    // Deferred: the mousedown that OPENED the popover is still propagating when
    // this effect runs.
    const armed = window.setTimeout(() => {
      document.addEventListener("mousedown", outside);
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", keep);
    }, 0);
    return () => {
      window.clearTimeout(armed);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", keep);
    };
  }, [open, keep]);

  // See the file header: registered always, declining while closed.
  useAction(
    "app.closeOverlay",
    () => {
      if (!open) return false;
      revert();
      return true;
    },
    [open, revert],
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${label} — ${value}. Choose a colour`}
        aria-expanded={open}
        title={title}
        onClick={() => (open ? keep() : show())}
        onContextMenu={(e) => menu.onContextMenu(e, undefined)}
        style={{
          position: "relative",
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: "var(--r-3)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border-1)"}`,
          background: value,
          cursor: "pointer",
          flexShrink: 0,
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
        }}
      />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            data-pg-colorpicker=""
            role="dialog"
            aria-label={`${label} colour`}
            onKeyDown={(e) => {
              // Escape is the keymap's, but a component test mounts no
              // dispatcher — this is the same fallback PGSelect keeps.
              if (e.key === "Escape") {
                e.stopPropagation();
                revert();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: pos?.left ?? anchor?.left ?? 0,
              top: pos?.top ?? anchor?.bottom ?? 0,
              width: POPOVER_W,
              // Hidden until placed, so it never paints at the unplaced
              // position first — a 268px panel visibly jumping is worse than a
              // frame of nothing.
              visibility: pos ? "visible" : "hidden",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-3)",
              boxShadow: "var(--shadow-2)",
              padding: 12,
              // Above PGModal (100) and level with PGContextMenu: the theme
              // editor is a dialog, and this has to draw over its backdrop.
              zIndex: 100000,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--fs-12)",
              color: "var(--fg-0)",
              userSelect: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <PickerBody
              label={label}
              value={value}
              onChange={onChange}
              swatches={swatches}
              recent={recent}
              contrast={contrast}
            />
          </div>,
          document.body,
        )}
      {menu.menu}
    </>
  );
}

// ─── The popover's contents ──────────────────────────────────────────────────

function PickerBody({
  label,
  value,
  onChange,
  swatches,
  recent,
  contrast,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  swatches?: ColorSwatchOption[];
  recent?: string[];
  contrast?: { against: string; label: string };
}) {
  // HSV by default so the numeric row is the WHEEL's own two axes plus the
  // brightness slider beside it — the three controls above then agree instead
  // of offering two different lightnesses that move each other.
  const [modelId, setModelId] = React.useState<ColorModel["id"]>("hsv");
  const model = colorModel(modelId);

  /**
   * HSV is the state; the hex is derived.
   *
   * The other way round loses the wheel's position at both edges — a grey has
   * no hue and black has neither hue nor saturation — so dragging value to the
   * floor and back would come up on a different colour than the one you left.
   * `hexToHsv` carries the angle across; this ref is what gives it something to
   * carry, including across a change that came from OUTSIDE the popover (a
   * palette swatch, a typed hex, the theme editor's own Revert).
   */
  const hsvRef = React.useRef<Hsv>(hexToHsv(value));
  if (hsvToHex(hsvRef.current) !== value) {
    hsvRef.current = hexToHsv(value, hsvRef.current);
  }
  const hsv = hsvRef.current;

  const setHsv = (next: Hsv) => {
    hsvRef.current = next;
    onChange(hsvToHex(next));
  };

  /**
   * The selected model's channel values, held rather than re-derived.
   *
   * Re-reading them from the hex on every render quantizes them, and the error
   * ACCUMULATES: ten arrow presses on hue moved 10.14° instead of 10, and the
   * readout drifted a little further from the number it had just shown. So the
   * draft is authoritative while it still describes the current colour, and is
   * re-seeded the moment the colour arrives from anywhere else — the wheel, a
   * palette swatch, the hex field, or the theme editor's Revert.
   */
  const valuesRef = React.useRef<number[]>(model.read(value));
  const modelWas = React.useRef(modelId);
  if (modelWas.current !== modelId) {
    modelWas.current = modelId;
    valuesRef.current = model.read(value);
  } else if (model.write(valuesRef.current) !== value) {
    valuesRef.current = model.read(value);
  }
  const values = valuesRef.current;

  const setChannel = (index: number, next: number) => {
    const edited = [...values];
    edited[index] = next;
    valuesRef.current = edited;
    const hex = model.write(edited);
    // Back through hexToHsv so the wheel follows a slider from another model,
    // and so an achromatic result does not discard the angle.
    hsvRef.current = hexToHsv(hex, hsvRef.current);
    onChange(hex);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 10 }}>
        <ColorWheel
          hsv={hsv}
          onChange={(h, s) => setHsv({ ...hsv, h, s })}
          label={label}
        />
        <ValueSlider hsv={hsv} onChange={(v) => setHsv({ ...hsv, v })} />
      </div>

      <HexRow value={value} onChange={onChange} contrast={contrast} />

      <div
        role="group"
        aria-label="Colour model"
        style={{ display: "flex", gap: 2 }}
      >
        {COLOR_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={m.id === modelId}
            onClick={() => setModelId(m.id)}
            style={{
              flex: 1,
              padding: "3px 0",
              background: m.id === modelId ? "var(--bg-4)" : "transparent",
              color: m.id === modelId ? "var(--fg-0)" : "var(--fg-2)",
              border: "1px solid",
              borderColor: m.id === modelId ? "var(--border-2)" : "transparent",
              borderRadius: "var(--r-2)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-10)",
              letterSpacing: "0.03em",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {model.channels.map((ch, i) => (
          <ChannelSlider
            key={`${model.id}.${ch.key}`}
            channel={ch}
            model={model}
            values={values}
            index={i}
            onChange={(next) => setChannel(i, next)}
          />
        ))}
      </div>

      {!!swatches?.length && (
        <SwatchRow
          heading="This theme"
          items={swatches}
          current={value}
          onPick={onChange}
        />
      )}
      {!!recent?.length && (
        <SwatchRow
          heading="Recent"
          items={recent.map((hex) => ({ hex, label: hex }))}
          current={value}
          onPick={onChange}
        />
      )}
    </>
  );
}

// ─── The wheel ───────────────────────────────────────────────────────────────

function ColorWheel({
  hsv,
  onChange,
  label,
}: {
  hsv: Hsv;
  onChange: (h: number, s: number) => void;
  label: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  // The wheel is painted ONCE at full value and dimmed by compositing black
  // over it, which is exact: HSV's value scales all three channels linearly, so
  // `hsv(h, s, v)` IS `hsv(h, s, 1)` under black at alpha `1 - v`. Re-running
  // the per-pixel loop on every frame of a value drag would be ~28k pixels of
  // arithmetic per frame for a result identical to one composite.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(WHEEL_SIZE * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    // A webview without a 2D context must not crash the theme editor; the
    // sliders still work, the wheel is simply blank.
    if (!ctx?.createImageData) return;
    const img = ctx.createImageData(px, px);
    paintWheelRgba(img.data, px);
    ctx.putImageData?.(img, 0, 0);
  }, []);

  const radius = WHEEL_SIZE / 2;
  const cursor = wheelPoint(hsv.h, hsv.s, radius);

  /** Screen point → hue and saturation, clamped to the rim for a drag. */
  const pick = (clientX: number, clientY: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const { h, s } = wheelHueSatClamped(clientX - cx, clientY - cy, r.width / 2);
    onChange(h, s);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Pointer events with capture, the way `resizable.tsx` drags a pane —
    // never HTML5 drag and drop, and the keyboard equivalent is right below.
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pick(e.clientX, e.clientY);
  };

  const step = (dh: number, ds: number) =>
    onChange(
      ((hsv.h + dh) % 360 + 360) % 360,
      Math.min(1, Math.max(0, hsv.s + ds)),
    );

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      role="group"
      // The wheel is two axes at once, which `role="slider"` cannot describe.
      // Its keyboard equivalent is the arrow keys here plus the H and S
      // sliders below, which ARE these axes and carry the numbers.
      aria-label={`${label} hue and saturation wheel. Arrow keys adjust hue and saturation.`}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        pick(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") step(-big, 0);
        else if (e.key === "ArrowRight") step(big, 0);
        else if (e.key === "ArrowUp") step(0, 0.01 * big);
        else if (e.key === "ArrowDown") step(0, -0.01 * big);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "relative",
        width: WHEEL_SIZE,
        height: WHEEL_SIZE,
        flexShrink: 0,
        borderRadius: "50%",
        cursor: "crosshair",
        touchAction: "none",
        outlineOffset: 2,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          width: WHEEL_SIZE,
          height: WHEEL_SIZE,
          display: "block",
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
      {/* The value dim, as one composite over the painted wheel. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "#000",
          opacity: 1 - hsv.v,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: radius + cursor.x,
          top: radius + cursor.y,
          width: 12,
          height: 12,
          marginLeft: -6,
          marginTop: -6,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ─── Sliders ─────────────────────────────────────────────────────────────────

/**
 * The shared slider. Pointer-driven rather than an `<input type="range">`, for
 * the same reason the wheel is a canvas: the track has to be painted with the
 * colours it would actually pick, and a live gradient through a WebKit
 * `::-webkit-slider-runnable-track` is a fight with no upside.
 *
 * `role="slider"` with the full value trio, so what a screen reader gets is a
 * named channel with a range — not an unlabelled div.
 */
export function PGSlider({
  name,
  valueText,
  min,
  max,
  step,
  value,
  shownValue,
  vertical,
  trackCss,
  onChange,
}: {
  name: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /**
   * What `aria-valuenow` reports, when it differs from the exact `value`.
   *
   * The exact value is a float the readout rounds — announcing
   * "207.04225352112678 degrees" is noise, and the number a screen reader gives
   * should be the one on screen beside it.
   */
  shownValue?: number;
  vertical?: boolean;
  trackCss: string;
  onChange: (next: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Measured at event time rather than observed: a drag needs the rect as it is
  // under the pointer NOW, and the popover is `fixed` inside a scrollable
  // dialog, so a cached box is a stale box.
  const pick = (clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Vertical runs bottom-to-top: the maximum belongs at the TOP, which is
    // where every value slider in every picker puts it.
    const along = vertical ? r.bottom - clientY : clientX - r.left;
    const len = vertical ? r.height : r.width;
    onChange(sliderValue(along, len, min, max));
  };

  const nudge = (dir: number, big: boolean) =>
    onChange(Math.min(max, Math.max(min, value + dir * step * (big ? 10 : 1))));

  const frac = sliderFraction(value, min, max);

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shownValue ?? value}
      aria-valuetext={valueText}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pick(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        pick(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const back = vertical ? "ArrowDown" : "ArrowLeft";
        const fwd = vertical ? "ArrowUp" : "ArrowRight";
        if (e.key === back) nudge(-1, e.shiftKey);
        else if (e.key === fwd) nudge(1, e.shiftKey);
        else if (e.key === "Home") onChange(min);
        else if (e.key === "End") onChange(max);
        else if (e.key === "PageDown") nudge(-1, true);
        else if (e.key === "PageUp") nudge(1, true);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "relative",
        flex: vertical ? undefined : 1,
        width: vertical ? VALUE_W : undefined,
        height: vertical ? WHEEL_SIZE : 12,
        borderRadius: 999,
        border: "1px solid var(--border-1)",
        background: trackCss,
        cursor: vertical ? "ns-resize" : "ew-resize",
        touchAction: "none",
        outlineOffset: 2,
        minWidth: 0,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: vertical ? "50%" : `${frac * 100}%`,
          top: vertical ? `${(1 - frac) * 100}%` : "50%",
          width: vertical ? VALUE_W + 4 : 12,
          height: vertical ? 12 : 16,
          marginLeft: vertical ? -(VALUE_W + 4) / 2 : -6,
          marginTop: vertical ? -6 : -8,
          borderRadius: vertical ? 4 : 999,
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** A left-to-right gradient through the colours a track would pick. */
function gradient(stops: string[], vertical = false): string {
  return `linear-gradient(${vertical ? "to top" : "to right"}, ${stops.join(", ")})`;
}

/**
 * The wheel's third axis, as the tall slider beside it.
 *
 * Named "Brightness" rather than "Value" and that is not decoration: the HSV
 * model's own V channel is in the numeric row below, so two `role="slider"`
 * nodes would otherwise carry the identical accessible name and a screen
 * reader would offer the same control twice with no way to tell them apart.
 * Brightness is HSV's V under the name Photoshop's "B" has always used.
 */
function ValueSlider({ hsv, onChange }: { hsv: Hsv; onChange: (v: number) => void }) {
  const top = hsvToHex({ ...hsv, v: 1 });
  return (
    <PGSlider
      name="Brightness"
      valueText={`${Math.round(hsv.v * 100)}%`}
      min={0}
      max={1}
      step={0.01}
      value={hsv.v}
      vertical
      trackCss={gradient(["#000000", top], true)}
      onChange={onChange}
    />
  );
}

function ChannelSlider({
  channel,
  model,
  values,
  index,
  onChange,
}: {
  channel: ColorChannel;
  model: ColorModel;
  values: number[];
  index: number;
  onChange: (next: number) => void;
}) {
  // A chroma slider's real end is where sRGB runs out, not the model's nominal
  // maximum — otherwise the last third of the track picks nothing and the
  // per-channel clamp shifts the hue while it happens.
  const max = Math.min(channel.max, model.ceiling?.(values, index) ?? Infinity);
  const shown = (values[index] * channel.scale).toFixed(channel.places);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 12,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-10)",
          color: "var(--fg-2)",
        }}
      >
        {channel.label}
      </span>
      <PGSlider
        // Prefixed with the model, because four models are one click apart and
        // "Hue" alone does not say whether you are moving HSV's or OKLCh's —
        // which are different angles on the same colour.
        name={`${model.label} ${channel.name.toLowerCase()}`}
        valueText={`${shown}${channel.unit}`}
        min={channel.min}
        max={max}
        step={channel.step}
        value={Math.min(values[index], max)}
        shownValue={Number(shown) / channel.scale}
        trackCss={gradient(trackStops(model, values, index))}
        onChange={onChange}
      />
      <span
        style={{
          width: 38,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-10)",
          color: "var(--fg-1)",
        }}
      >
        {shown}
        {channel.unit}
      </span>
    </div>
  );
}

// ─── Hex + contrast ──────────────────────────────────────────────────────────

function HexRow({
  value,
  onChange,
  contrast,
}: {
  value: string;
  onChange: (hex: string) => void;
  contrast?: { against: string; label: string };
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const hex = normalizeHex(draft);
    if (hex) onChange(hex);
    else setDraft(value);
  };

  const ratio = contrast ? contrastOf(value, contrast.against) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        aria-label="Hex"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.stopPropagation();
          }
          // Every other key stays local: the popover lives inside a dialog and
          // the dispatcher must not read typing as chords.
          if (e.key !== "Escape") e.stopPropagation();
        }}
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-2)",
          outline: "none",
          color: "var(--fg-0)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          padding: "3px 6px",
        }}
      />
      {ratio !== null && (
        <span
          data-testid="colorpicker-contrast"
          title={`Contrast against ${contrast!.label}: ${ratio.toFixed(2)}:1`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-10)",
            color:
              ratio < 3
                ? "var(--git-removed)"
                : ratio < 4.5
                  ? "var(--git-modified)"
                  : "var(--fg-3)",
          }}
        >
          {ratio < 4.5 && <PGIcon name="warn" size={10} />}
          {ratio.toFixed(1)}:1
        </span>
      )}
    </div>
  );
}

/**
 * WCAG relative-luminance contrast, the same formula `theme/contrast.ts` uses.
 *
 * Duplicated rather than imported because `src/design/` does not reach into
 * `features/` for domain logic, and this is four lines of a published spec. The
 * theme editor's own findings still come from `theme/contrast.ts` — this only
 * decorates the popover.
 */
function contrastOf(a: string, b: string): number | null {
  const lum = (hex: string): number | null => {
    const norm = normalizeHex(hex);
    if (!norm) return null;
    const ch = [1, 3, 5].map((i) => Number.parseInt(norm.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const la = lum(a);
  const lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ─── Swatch rows ─────────────────────────────────────────────────────────────

function SwatchRow({
  heading,
  items,
  current,
  onPick,
}: {
  heading: string;
  items: ColorSwatchOption[];
  current: string;
  onPick: (hex: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-10)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--fg-3)",
          marginBottom: 4,
        }}
      >
        {heading}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {items.map((s, i) => (
          <button
            key={`${s.hex}-${i}`}
            type="button"
            aria-label={`${s.label}${s.label === s.hex ? "" : ` (${s.hex})`}`}
            title={`${s.label} — ${s.hex}`}
            onClick={() => onPick(s.hex)}
            style={{
              width: 16,
              height: 16,
              padding: 0,
              borderRadius: 3,
              background: s.hex,
              border:
                s.hex.toLowerCase() === current.toLowerCase()
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border-1)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
