import React, { type CSSProperties, type ReactNode } from "react";
import { PGIcon, type IconName } from "./icons";
import { PGTooltip } from "./primitives";

// ═════════════════════════════════════════════════════════
// WINDOW / TITLEBAR
// ═════════════════════════════════════════════════════════

export function PGTrafficLights({ onClose }: { onClose?: () => void }) {
  const cs = [
    { bg: "#ff5f57", border: "#e0443e" },
    { bg: "#febc2e", border: "#dea123" },
    { bg: "#28c840", border: "#1aab29" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "0 4px",
      }}
    >
      {cs.map((c, i) => (
        <div
          key={i}
          onClick={i === 0 ? onClose : undefined}
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: c.bg,
            border: `0.5px solid ${c.border}`,
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

export interface PGTitlebarProps {
  repoName?: string;
  branch?: ReactNode;
  dirty?: number;
  children?: ReactNode;
  onClose?: () => void;
  rightSlot?: ReactNode;
  showTrafficLights?: boolean;
}

export function PGTitlebar({
  repoName = "platypus-core",
  branch = "main",
  dirty = 0,
  children,
  onClose,
  rightSlot,
  showTrafficLights = true,
}: PGTitlebarProps) {
  return (
    <div
      style={{
        height: 38,
        background: "var(--bg-titlebar)",
        borderBottom: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 12,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {showTrafficLights && <PGTrafficLights onClose={onClose} />}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          color: "var(--fg-2)",
        }}
      >
        <PGIcon name="repo" size={13} />
        <span style={{ color: "var(--fg-0)", fontWeight: 600 }}>{repoName}</span>
        <span style={{ color: "var(--fg-3)" }}>/</span>
        {typeof branch === "string" ? (
          <>
            <PGIcon name="branch" size={12} />
            <span style={{ color: "var(--accent)" }}>{branch}</span>
          </>
        ) : (
          branch
        )}
        {dirty > 0 && (
          <span
            style={{
              fontSize: "var(--fs-10)",
              color: "var(--git-modified)",
              padding: "1px 5px",
              borderRadius: "var(--r-2)",
              border: "1px solid var(--git-modified)",
              opacity: 0.85,
            }}
          >
            ●{dirty}
          </span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {children}
      {rightSlot}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// STATUS BAR
// ═════════════════════════════════════════════════════════

export function PGStatusBar({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        height: 22,
        background: "var(--bg-titlebar)",
        borderTop: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: 12,
        fontSize: "var(--fs-11)",
        color: "var(--fg-2)",
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}
    >
      <div
        style={{ display: "flex", gap: 12, alignItems: "center", flex: 1 }}
      >
        {left}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {right}
      </div>
    </div>
  );
}

export function PGStatusItem({
  icon,
  label,
  tone = "default",
  onClick,
}: {
  icon?: IconName | string;
  label?: ReactNode;
  tone?: "default" | "accent" | "success" | "warn" | "danger";
  onClick?: () => void;
}) {
  const tones = {
    default: "var(--fg-2)",
    accent: "var(--accent)",
    success: "var(--git-added)",
    warn: "var(--git-modified)",
    danger: "var(--git-removed)",
  };
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        color: tones[tone],
        cursor: onClick ? "pointer" : "default",
        padding: "0 4px",
        height: 22,
        borderRadius: 2,
      }}
    >
      {icon && <PGIcon name={icon} size={11} />}
      <span>{label}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// ACTIVITY BAR + PRIMARY SIDEBAR
// ═════════════════════════════════════════════════════════

export interface ActivityBarItem {
  id: string;
  icon: IconName | string;
  label: string;
  shortcut?: string;
  badge?: boolean;
}

export function PGActivityBar({
  value,
  onChange,
  items,
  settingsActive,
  onSettingsClick,
}: {
  value?: string;
  onChange?: (id: string) => void;
  items: ActivityBarItem[];
  settingsActive?: boolean;
  onSettingsClick?: () => void;
}) {
  return (
    <div
      style={{
        width: 44,
        background: "var(--bg-titlebar)",
        borderRight: "1px solid var(--border-0)",
        display: "flex",
        flexDirection: "column",
        padding: "6px 0",
        flexShrink: 0,
      }}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <PGTooltip
            key={it.id}
            content={it.label}
            shortcut={it.shortcut}
            placement="right"
          >
            <button
              onClick={() => onChange?.(it.id)}
              style={{
                width: 44,
                height: 40,
                background: "transparent",
                border: "none",
                color: active ? "var(--accent)" : "var(--fg-2)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "var(--accent)",
                    borderRadius: 1,
                  }}
                />
              )}
              <PGIcon name={it.icon} size={18} />
              {it.badge && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 8,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--git-modified)",
                  }}
                />
              )}
            </button>
          </PGTooltip>
        );
      })}
      <div style={{ flex: 1 }} />
      <PGTooltip content="Settings" placement="right">
        <button
          onClick={onSettingsClick}
          style={{
            width: 44,
            height: 40,
            background: "transparent",
            border: "none",
            color: settingsActive ? "var(--accent)" : "var(--fg-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {settingsActive && (
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 8,
                bottom: 8,
                width: 2,
                background: "var(--accent)",
                borderRadius: 1,
              }}
            />
          )}
          <PGIcon name="settings" size={16} />
        </button>
      </PGTooltip>
    </div>
  );
}

export function PGPrimarySidebar({
  width = 260,
  children,
  style,
}: {
  width?: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border-0)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface PGSidebarGroupProps {
  title: ReactNode;
  icon?: IconName | string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  count?: number;
  children?: ReactNode;
}

export function PGSidebarGroup({
  title,
  icon,
  defaultOpen = true,
  actions,
  count,
  children,
}: PGSidebarGroupProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-0)" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 26,
          padding: "0 8px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--fg-1)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <PGIcon
          name={open ? "chevronDown" : "chevronRight"}
          size={10}
          style={{ color: "var(--fg-3)" }}
        />
        {icon && (
          <PGIcon name={icon} size={11} style={{ color: "var(--fg-2)" }} />
        )}
        <span>{title}</span>
        {count != null && (
          <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-10)" }}>
            ({count})
          </span>
        )}
        <div style={{ flex: 1 }} />
        {actions && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2 }}>
            {actions}
          </div>
        )}
      </div>
      {open && <div style={{ padding: "2px 0 6px" }}>{children}</div>}
    </div>
  );
}

export interface PGSidebarRowProps {
  icon?: IconName | string;
  label: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  meta?: ReactNode;
  accent?: string;
  indent?: number;
  status?: ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function PGSidebarRow({
  icon,
  label,
  selected,
  onClick,
  meta,
  accent,
  indent = 0,
  status,
  onContextMenu,
}: PGSidebarRowProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: `0 8px 0 ${8 + indent * 12}px`,
        background: selected
          ? "var(--bg-selection)"
          : hover
            ? "var(--bg-2)"
            : "transparent",
        fontSize: "var(--fs-12)",
        fontFamily: "var(--font-mono)",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 3,
            bottom: 3,
            width: 2,
            background: "var(--accent)",
            borderRadius: 1,
          }}
        />
      )}
      {icon && (
        <PGIcon
          name={icon}
          size={12}
          style={{ color: accent || "var(--fg-2)" }}
        />
      )}
      <span
        style={{
          flex: 1,
          color: accent || "var(--fg-0)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      {status}
      {meta && (
        <span style={{ fontSize: "var(--fs-10)", color: "var(--fg-3)" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

export function PGToolbar({
  children,
  left,
  right,
  style,
}: {
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        height: 36,
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: 8,
        flexShrink: 0,
        ...style,
      }}
    >
      {left}
      {children}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
