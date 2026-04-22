import React from "react";

/**
 * Drag handle for resizing a sibling pane. Call `usePaneWidth(initial, storageKey?)`
 * in the parent, apply `width` to the pane, and render `<PGResizeHandle onDrag={onDrag} />`
 * immediately after it.
 */
export function PGResizeHandle({
  onDrag,
  side = "right",
}: {
  onDrag: (deltaPx: number) => void;
  /** Which side of the owning pane the handle sits on. Affects cursor only. */
  side?: "left" | "right";
}) {
  const [active, setActive] = React.useState(false);
  const startX = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      if (startX.current === null) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onDrag(delta);
    };
    const onUp = () => {
      setActive(false);
      startX.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [active, onDrag]);

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        startX.current = e.clientX;
        setActive(true);
      }}
      style={{
        flexShrink: 0,
        width: 4,
        marginLeft: side === "right" ? -2 : 0,
        marginRight: side === "left" ? -2 : 0,
        cursor: "col-resize",
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
