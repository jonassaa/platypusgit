// PGPane — wraps a focusable region. Registers itself with the focus store,
// renders a focus ring via data-pg-focused (styled in index.css), and grabs
// focus on click. Pane-scoped actions (list.*, pane.*) target the focused pane.

import React from "react";
import { useFocusStore, type Neighbors } from "./useFocusStore";

export function PGPane({
  id,
  neighbors,
  children,
  className,
  style,
}: {
  id: string;
  neighbors: Neighbors;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const focused = useFocusStore((s) => s.focused === id);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(
    () => useFocusStore.getState().register(id, neighbors),
    // Re-register when identity or any neighbor edge changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, neighbors.left, neighbors.right, neighbors.up, neighbors.down],
  );

  // Mirror logical focus onto the DOM: when this pane gains focus (e.g. via
  // Alt+Arrow), move DOM focus into it — unless focus is already inside, so we
  // don't steal it from an inner input. Keeps existing per-pane key handlers
  // (tree arrows, etc.) receiving events that match the visible focus ring.
  React.useEffect(() => {
    const el = ref.current;
    if (focused && el && !el.contains(document.activeElement)) el.focus();
  }, [focused]);

  return (
    <div
      ref={ref}
      data-pg-pane={id}
      data-pg-focused={focused ? "" : undefined}
      tabIndex={-1}
      className={className}
      style={style}
      onMouseDown={() => useFocusStore.getState().focus(id)}
    >
      {children}
    </div>
  );
}
