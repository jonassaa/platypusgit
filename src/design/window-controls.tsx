import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function ControlButton({
  label,
  onClick,
  closeTone,
  children,
}: {
  label: string;
  onClick: () => void;
  closeTone?: boolean;
  children: React.ReactNode;
}) {
  const [hover, setHover] = React.useState(false);
  const bg = hover
    ? closeTone
      ? "#e81123"
      : "var(--bg-2)"
    : "transparent";
  const fg = hover && closeTone ? "#fff" : "var(--fg-1)";
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 46,
        height: 38,
        background: bg,
        color: fg,
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

const iconProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
} as const;

function MinIcon() {
  return (
    <svg {...iconProps}>
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

function MaxIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <svg {...iconProps}>
      <rect x="1" y="3" width="6" height="6" />
      <rect x="3" y="1" width="6" height="6" />
    </svg>
  ) : (
    <svg {...iconProps}>
      <rect x="1" y="1" width="8" height="8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps}>
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </svg>
  );
}

export function PGWindowControls() {
  const win = React.useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    win.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    win.onResized(async () => {
      const v = await win.isMaximized();
      if (!cancelled) setMaximized(v);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [win]);

  return (
    <div style={{ display: "flex", height: 38 }}>
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <MinIcon />
      </ControlButton>
      <ControlButton label="Maximize" onClick={() => win.toggleMaximize()}>
        <MaxIcon maximized={maximized} />
      </ControlButton>
      <ControlButton label="Close" onClick={() => win.close()} closeTone>
        <CloseIcon />
      </ControlButton>
    </div>
  );
}
