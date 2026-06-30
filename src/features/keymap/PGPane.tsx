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

  React.useEffect(
    () => useFocusStore.getState().register(id, neighbors),
    // Re-register when identity or any neighbor edge changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, neighbors.left, neighbors.right, neighbors.up, neighbors.down],
  );

  return (
    <div
      data-pg-pane={id}
      data-pg-focused={focused ? "" : undefined}
      className={className}
      style={style}
      onMouseDown={() => useFocusStore.getState().focus(id)}
    >
      {children}
    </div>
  );
}
