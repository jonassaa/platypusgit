// PGPane — wraps a focusable region. Registers its element with the focus store
// (geometry drives Alt+Arrow traversal), renders a focus ring via
// data-pg-focused, and grabs focus on click.
//
// On gaining focus it delegates DOM focus to an inner `.focusable` element if
// present (so a pane's own arrow-key handler receives events), else focuses the
// wrapper. Any focus landing inside the pane syncs the store, keeping the ring
// in step with real DOM focus.

import React from "react";
import { useFocusStore } from "./useFocusStore";

export function PGPane({
  id,
  children,
  className,
  style,
  isBar,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Marks the activity bar: never auto-grabs focus, excluded from content. */
  isBar?: boolean;
}) {
  const focused = useFocusStore((s) => s.focused === id);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    return useFocusStore.getState().register(id, ref.current, {
      isBar,
      autoFocus: !isBar,
    });
  }, [id, isBar]);

  // Move real DOM focus to the pane's inner focusable target (or the wrapper)
  // whenever this pane becomes the focused pane — unless focus is already inside.
  React.useEffect(() => {
    const el = ref.current;
    if (!focused || !el) return;
    if (el.contains(document.activeElement)) return;
    const target =
      el.querySelector<HTMLElement>(".focusable, [data-pg-focus-target]") ?? el;
    target.focus({ preventScroll: false });
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
      onFocusCapture={() => useFocusStore.getState().focus(id)}
    >
      {children}
    </div>
  );
}
