import React from "react";

/**
 * Drag handle for resizing a sibling pane. Call `usePaneWidth(initial, storageKey?)`
 * in the parent, apply `width` to the pane, and render `<PGResizeHandle onDrag={onDrag} />`
 * immediately after it.
 */
export function PGResizeHandle({
  onDrag,
  onActiveChange,
  side = "right",
  orientation = "horizontal",
}: {
  onDrag: (deltaPx: number) => void;
  /** Called when the drag starts/stops. Useful to suspend CSS transitions. */
  onActiveChange?: (active: boolean) => void;
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
      onMouseDown={(e) => {
        e.preventDefault();
        start.current = vertical ? e.clientY : e.clientX;
        setActive(true);
      }}
      style={{
        flexShrink: 0,
        width: vertical ? "auto" : 4,
        height: vertical ? 4 : "auto",
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

export function usePaneWidth(
  initial: number,
  opts?: { min?: number; max?: number; storageKey?: string },
) {
  const min = opts?.min ?? 160;
  const max = opts?.max ?? 800;
  const key = opts?.storageKey;

  const [width, setWidth] = React.useState<number>(() => {
    if (!key) return initial;
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : initial;
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    if (!key) return;
    try {
      localStorage.setItem(key, String(width));
    } catch {
      // quota errors are non-fatal
    }
  }, [width, key]);

  const resize = React.useCallback(
    (delta: number) =>
      setWidth((w) => Math.min(max, Math.max(min, w + delta))),
    [min, max],
  );

  return { width, resize };
}
