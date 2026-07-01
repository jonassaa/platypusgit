// FocusableScroll — a scroll region that's keyboard-focusable and scrolls with
// arrows / PageUp-Dn / Home-End when focused. Carries the `.focusable` class so
// PGPane delegates DOM focus to it. Used for content/preview/diff/viewer panes
// that have no selectable rows (scroll-only, per the keyboard-nav spec).
//
// Modifier+arrow combos are left alone so Alt+Arrow pane traversal still works.

import React from "react";

export function FocusableScroll({
  children,
  className,
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
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
      className={`focusable ${className ?? ""}`}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={{ outline: "none", overflow: "auto", ...style }}
    >
      {children}
    </div>
  );
}
