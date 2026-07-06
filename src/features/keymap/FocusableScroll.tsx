// FocusableScroll — a scroll region that's keyboard-focusable and scrolls with
// arrows / PageUp-Dn / Home-End when focused. Carries `data-pg-focus-target`
// so PGPane delegates DOM focus to it (`.focusable` is just the ring style).
// Used for content/preview/diff/viewer panes that have no selectable rows
// (scroll-only, per the keyboard-nav spec).
//
// Modifier+arrow combos are left alone so Alt+Arrow pane traversal still works.

import React from "react";

export function FocusableScroll({
  children,
  className,
  style,
  ariaLabel,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  /** Forwarded as data-testid — e2e specs select scroll regions by it. */
  testId?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The global dispatcher (capture phase) may have already routed this key
    // to a pane-list handler — don't also scroll.
    if (e.defaultPrevented) return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const el = ref.current;
    if (!el) return;
    const line = 40;
    const page = Math.max(40, el.clientHeight * 0.9);
    switch (e.key) {
      case "ArrowDown":
        el.scrollTop += line;
        break;
      case "ArrowUp":
        el.scrollTop -= line;
        break;
      case "ArrowRight":
        el.scrollLeft += line;
        break;
      case "ArrowLeft":
        el.scrollLeft -= line;
        break;
      case "PageDown":
        el.scrollTop += page;
        break;
      case "PageUp":
        el.scrollTop -= page;
        break;
      case "Home":
        el.scrollTop = 0;
        break;
      case "End":
        el.scrollTop = el.scrollHeight;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      data-pg-focus-target=""
      className={`focusable ${className ?? ""}`}
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={onKeyDown}
      style={{ outline: "none", overflow: "auto", ...style }}
    >
      {children}
    </div>
  );
}
