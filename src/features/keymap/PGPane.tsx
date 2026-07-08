// PGPane — wraps a focusable region. Registers its element with the focus store
// (geometry drives Alt+Arrow traversal), renders a focus ring via
// data-pg-focused, and grabs focus on click.
//
// On gaining focus it delegates DOM focus to an inner `[data-pg-focus-target]`
// element if present (so a pane's own arrow-key handler receives events), else
// focuses the wrapper. The `.focusable` CLASS is only focus-ring styling and
// deliberately not a delegation marker — buttons carry it too, and delegating
// to a button makes the interactive-element guard swallow Tab pane-cycling.
// Any focus landing inside the pane syncs the store, keeping the ring in step
// with real DOM focus.

import React from "react";
import { useFocusStore } from "./useFocusStore";
import { useSpeedSearchStore } from "./useSpeedSearchStore";

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
  const speedQuery = useSpeedSearchStore((s) => s.queries[id] ?? "");
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
    if (!el.contains(document.activeElement)) {
      const target = el.querySelector<HTMLElement>("[data-pg-focus-target]") ?? el;
      target.focus({ preventScroll: false });
    }
    // A `[data-pg-focus-target]` may mount AFTER the pane is already focused
    // (e.g. History's detail once a commit is selected). With no target at
    // focus time the wrapper took focus; delegate to the target once it
    // appears — but only while focus still sits on the wrapper, so we never
    // yank it off a control the user tabbed to.
    const obs = new MutationObserver(() => {
      const node = ref.current;
      if (!node || document.activeElement !== node) return;
      const target = node.querySelector<HTMLElement>("[data-pg-focus-target]");
      if (target) target.focus({ preventScroll: false });
    });
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [focused]);

  return (
    <div
      ref={ref}
      data-pg-pane={id}
      data-pg-focused={focused ? "" : undefined}
      tabIndex={-1}
      className={className}
      style={{ position: "relative", ...style }}
      onMouseDown={() => useFocusStore.getState().focus(id)}
      onFocusCapture={() => useFocusStore.getState().focus(id)}
    >
      {children}
      {focused && speedQuery && (
        <div
          data-pg-speed-query=""
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            zIndex: 5,
            padding: "2px 8px",
            borderRadius: "var(--r-3)",
            background: "var(--bg-3)",
            border: "1px solid var(--border-1)",
            color: "var(--fg-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            pointerEvents: "none",
          }}
        >
          {speedQuery}
        </div>
      )}
    </div>
  );
}
