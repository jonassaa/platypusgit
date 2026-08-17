import React from "react";
import { type ElementSize } from "@/lib/useElementSize";
import { clampPaneSize, DEFAULT_SIBLING_MIN, PANE_HANDLE_PX } from "./paneSize";

export {
  clampPaneSize,
  DEFAULT_SIBLING_MIN,
  PANE_HANDLE_PX,
  paneMaxSize,
} from "./paneSize";
export type { PaneClamp } from "./paneSize";

/**
 * Drag handle for resizing a sibling pane. Measure the container with
 * `useElementSize`, call `usePaneSize(initial, { axis, container, … })` in the
 * parent, apply `size` to the pane, and render
 * `<PGResizeHandle onDrag={pane.resize} onReset={pane.reset} />` immediately
 * after it.
 */
export function PGResizeHandle({
  onDrag,
  onReset,
  onActiveChange,
  side = "right",
  orientation = "horizontal",
  testId,
}: {
  onDrag: (deltaPx: number) => void;
  /**
   * Double-click the handle to put the pane back to its `initial` — the standard
   * editor gesture, and the recovery net for a persisted size that outlived the
   * layout which produced it (#162).
   */
  onReset?: () => void;
  /** Called when the drag starts/stops. Useful to suspend CSS transitions. */
  onActiveChange?: (active: boolean) => void;
  /** `data-testid` for the handle — the drag target has no text to query by. */
  testId?: string;
  /** Which side of the owning pane the handle sits on. Affects cursor only. */
  side?: "left" | "right" | "top" | "bottom";
  /**
   * Drag axis. `horizontal` (default) reports the X delta for width resizing;
   * `vertical` reports the Y delta for height resizing (e.g. a panel below).
   */
  orientation?: "horizontal" | "vertical";
}) {
  const vertical = orientation === "vertical";
  const [active, setActive] = React.useState(false);
  const start = React.useRef<number | null>(null);

  React.useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  React.useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      if (start.current === null) return;
      const pos = vertical ? e.clientY : e.clientX;
      const delta = pos - start.current;
      start.current = pos;
      onDrag(delta);
    };
    const onUp = () => {
      setActive(false);
      start.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [active, onDrag, vertical]);

  return (
    <div
      data-testid={testId}
      data-pg-resize-handle=""
      title={onReset ? "Drag to resize · double-click to reset" : undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        start.current = vertical ? e.clientY : e.clientX;
        setActive(true);
      }}
      // `preventDefault` on mousedown suppresses selection and focus, not the
      // click pair the UA derives from it, so dblclick still arrives here.
      onDoubleClick={onReset}
      style={{
        flexShrink: 0,
        width: vertical ? "auto" : PANE_HANDLE_PX,
        height: vertical ? PANE_HANDLE_PX : "auto",
        marginLeft: side === "right" ? -2 : 0,
        marginRight: side === "left" ? -2 : 0,
        marginTop: side === "bottom" ? -2 : 0,
        marginBottom: side === "top" ? -2 : 0,
        cursor: vertical ? "row-resize" : "col-resize",
        background: active ? "var(--accent)" : "transparent",
        transition: active ? "none" : "background var(--t-fast)",
        zIndex: 1,
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLDivElement).style.background =
            "var(--border-2)";
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    />
  );
}

export type PaneSizeOptions = {
  /**
   * Which container dimension bounds this pane. Named rather than inferred: the
   * hook is used for HEIGHTS as well (History's bottom detail panel, Compare's
   * commit lists), and reading the wrong axis is exactly the bug the old
   * `usePaneWidth` name hid.
   */
  axis: "width" | "height";
  /** The measured flex container this pane and its sibling share. */
  container: Pick<ElementSize, "width" | "height">;
  /** Floor for this pane. */
  min?: number;
  /** Floor for the flexible sibling that shares the container. */
  siblingMin?: number;
  /** Other fixed-size panes in the same container + their handles, in px. */
  reserve?: number;
  /** Handle thickness, if a call site differs from `PANE_HANDLE_PX`. */
  handle?: number;
  /** `localStorage` key for the user's preferred size. */
  storageKey?: string;
};

export type PaneSize = {
  /** What to render: the preference, clamped to what the container allows. */
  size: number;
  /** Apply a drag delta. */
  resize: (delta: number) => void;
  /** Back to `initial` — the handle's double-click. */
  reset: () => void;
};

/**
 * A resizable pane's size: the user's PREFERENCE, persisted, and the EFFECTIVE
 * size it renders at once the container has been measured (#162).
 *
 * Those two are deliberately separate values, and the split is what makes the
 * container-relative clamp safe:
 *
 * - the effective size is derived during render, so a container that changed
 *   (window resized, moved to a smaller display, panel opened beside it) is
 *   honoured on the very next paint with no effect, no second render pass, and
 *   no chance of two panes oscillating against each other's clamp;
 * - only a drag or a reset writes the preference, so opening a 720px-wide panel
 *   on a 1280px laptop shows it narrowed but does NOT overwrite the size the
 *   external monitor earned. Nothing derived from a measurement is ever stored.
 *
 * While the container is unmeasured (0 — see `useElementSize`) the ceiling is
 * `Infinity`: only the floor applies, and the stored value is left exactly as it
 * was read. That is the one case that must not guess, because a clamp against 0
 * is a clamp to `min` for every pane at once.
 */
export function usePaneSize(
  initial: number,
  opts: PaneSizeOptions,
): PaneSize {
  const {
    axis,
    container,
    min = 160,
    siblingMin = DEFAULT_SIBLING_MIN,
    reserve = 0,
    handle = PANE_HANDLE_PX,
    storageKey,
  } = opts;
  const containerSize = container[axis];
  const clamp = React.useMemo(
    () => ({ min, siblingMin, reserve, handle, container: containerSize }),
    [min, siblingMin, reserve, handle, containerSize],
  );

  // The PREFERENCE. Read from storage floored at `min` only — never capped,
  // because no measurement exists this early and capping against 0 would both
  // collapse the pane and (via the persist effect) destroy the stored value.
  const [preferred, setPreferred] = React.useState<number>(() => {
    if (!storageKey) return initial;
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? Math.max(min, n) : initial;
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(Math.round(preferred)));
    } catch {
      // quota errors are non-fatal
    }
  }, [preferred, storageKey]);

  const size = clampPaneSize(preferred, clamp);

  // A drag starts from what is ON SCREEN (the clamped size), not from a
  // preference the container is currently overruling.
  const resize = React.useCallback(
    (delta: number) =>
      setPreferred((prev) => clampPaneSize(clampPaneSize(prev, clamp) + delta, clamp)),
    [clamp],
  );

  const reset = React.useCallback(
    () => setPreferred(initial),
    [initial],
  );

  return { size, resize, reset };
}
