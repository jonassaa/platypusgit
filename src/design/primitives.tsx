import React, {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { PGIcon, type IconName } from "./icons";

type Tone = "default" | "accent" | "success" | "warn" | "danger" | "violet" | "muted";

const toneColors: Record<string, string> = {
  accent: "var(--accent)",
  success: "var(--git-added)",
  warn: "var(--git-modified)",
  danger: "var(--git-removed)",
};

// ═════════════════════════════════════════════════════════
// BUTTONS
// ═════════════════════════════════════════════════════════

export interface PGButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: "default" | "primary" | "ghost" | "outline" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
  children?: ReactNode;
  icon?: IconName | string;
  iconRight?: IconName | string;
  disabled?: boolean;
  loading?: boolean;
  tone?: "accent" | "success" | "warn" | "danger";
  fullWidth?: boolean;
  style?: CSSProperties;
}

export function PGButton({
  variant = "default",
  size = "md",
  children,
  icon,
  iconRight,
  disabled,
  loading,
  tone,
  fullWidth,
  style,
  ...rest
}: PGButtonProps) {
  const sizes = {
    xs: { h: 20, px: 6, fs: "var(--fs-11)", gap: 4 },
    sm: { h: 24, px: 8, fs: "var(--fs-12)", gap: 5 },
    md: { h: 28, px: 10, fs: "var(--fs-12)", gap: 6 },
    lg: { h: 32, px: 14, fs: "var(--fs-13)", gap: 7 },
  } as const;
  const s = sizes[size];

  const variants = {
    default: {
      bg: "var(--bg-2)",
      fg: "var(--fg-0)",
      border: "var(--border-1)",
      hover: "var(--bg-3)",
    },
    primary: {
      bg: tone ? toneColors[tone] : "var(--accent)",
      fg: "var(--accent-ink)",
      border: "transparent",
      hover: tone ? toneColors[tone] : "var(--accent)",
    },
    ghost: {
      bg: "transparent",
      fg: tone ? toneColors[tone] : "var(--fg-0)",
      border: "transparent",
      hover: "var(--bg-2)",
    },
    outline: {
      bg: "transparent",
      fg: tone ? toneColors[tone] : "var(--fg-0)",
      border: tone ? toneColors[tone] : "var(--border-2)",
      hover: "var(--bg-2)",
    },
    danger: {
      bg: "var(--git-removed)",
      fg: "white",
      border: "transparent",
      hover: "var(--git-removed)",
    },
  } as const;
  const v = variants[variant];

  const [hover, setHover] = React.useState(false);

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="focusable"
      style={{
        height: s.h,
        padding: `0 ${s.px}px`,
        fontSize: s.fs,
        fontFamily: "var(--font-sans)",
        fontWeight: variant === "primary" ? 600 : 500,
        color: v.fg,
        background: hover && !disabled ? v.hover : v.bg,
        border: `1px solid ${v.border}`,
        borderRadius: "var(--r-3)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--t-fast), border-color var(--t-fast)",
        whiteSpace: "nowrap",
        boxShadow: variant === "default" ? "var(--shadow-inset)" : undefined,
        width: fullWidth ? "100%" : undefined,
        ...style,
      }}
    >
      {loading && (
        <span className="pg-spin" style={{ display: "inline-flex" }}>
          <PGIcon name="sync" size={12} />
        </span>
      )}
      {!loading && icon && <PGIcon name={icon} size={size === "lg" ? 14 : 12} />}
      {children && <span>{children}</span>}
      {iconRight && <PGIcon name={iconRight} size={size === "lg" ? 14 : 12} />}
    </button>
  );
}

export interface PGIconButtonProps {
  icon: IconName | string;
  size?: "sm" | "md" | "lg";
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  active?: boolean;
  tone?: string;
  style?: CSSProperties;
}

export function PGIconButton({
  icon,
  size = "md",
  onClick,
  title,
  active,
  tone,
  style,
}: PGIconButtonProps) {
  const sizes = { sm: 20, md: 24, lg: 28 } as const;
  const sz = sizes[size];
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="focusable"
      style={{
        width: sz,
        height: sz,
        background: active ? "var(--bg-3)" : hover ? "var(--bg-2)" : "transparent",
        border: "1px solid transparent",
        borderColor: active ? "var(--border-1)" : "transparent",
        borderRadius: "var(--r-3)",
        color: tone || (active ? "var(--accent)" : "var(--fg-1)"),
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background var(--t-fast), color var(--t-fast)",
        ...style,
      }}
    >
      <PGIcon name={icon} size={size === "lg" ? 16 : 14} />
    </button>
  );
}

export interface PGButtonGroupOption {
  value: string;
  label: string;
  icon?: IconName | string;
}

export interface PGButtonGroupProps {
  options: PGButtonGroupOption[];
  value?: string;
  onChange?: (v: string) => void;
  size?: "sm" | "md" | "lg";
}

export function PGButtonGroup({ options, value, onChange, size = "md" }: PGButtonGroupProps) {
  const sizes = { sm: 22, md: 26, lg: 30 } as const;
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        padding: 2,
        gap: 1,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            aria-pressed={active}
            onClick={() => onChange?.(opt.value)}
            className="focusable"
            style={{
              height: sizes[size] - 4,
              padding: "0 8px",
              fontSize: "var(--fs-11)",
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              color: active ? "var(--fg-0)" : "var(--fg-2)",
              background: active ? "var(--bg-3)" : "transparent",
              border: "none",
              borderRadius: "var(--r-2)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              transition: "background var(--t-fast), color var(--t-fast)",
            }}
          >
            {opt.icon && <PGIcon name={opt.icon} size={11} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// INPUTS
// ═════════════════════════════════════════════════════════

export interface PGInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onChange" | "style"> {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  icon?: IconName | string;
  size?: "sm" | "md" | "lg";
  mono?: boolean;
  error?: boolean;
  style?: CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function PGInput({
  value,
  onChange,
  placeholder,
  icon,
  size = "md",
  mono,
  error,
  style,
  inputRef,
  ...rest
}: PGInputProps) {
  const sizes = { sm: 24, md: 28, lg: 32 } as const;
  const [focus, setFocus] = React.useState(false);
  return (
    <div
      style={{
        height: sizes[size],
        display: "flex",
        alignItems: "center",
        background: "var(--bg-1)",
        border: `1px solid ${
          error
            ? "var(--git-removed)"
            : focus
              ? "var(--accent)"
              : "var(--border-1)"
        }`,
        borderRadius: "var(--r-3)",
        padding: "0 8px",
        gap: 6,
        transition: "border-color var(--t-fast)",
        boxShadow: focus ? "0 0 0 3px oklch(0.72 0.15 235 / 0.15)" : "none",
        ...style,
      }}
    >
      {icon && <PGIcon name={icon} size={13} style={{ color: "var(--fg-3)" }} />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fg-0)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: "var(--fs-12)",
          height: "100%",
        }}
        {...rest}
      />
    </div>
  );
}

export interface PGSearchInputProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  shortcut?: string;
  style?: CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function PGSearchInput({
  value,
  onChange,
  placeholder = "Search",
  shortcut,
  style,
  inputRef,
}: PGSearchInputProps) {
  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <PGInput
        inputRef={inputRef}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        icon="search"
        style={{
          width: "100%",
          paddingRight: shortcut ? 48 : undefined,
        }}
      />
      {shortcut && (
        <div
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: 2,
          }}
        >
          {shortcut.split("+").map((k, i) => (
            <kbd key={i}>{k}</kbd>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PGTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "style"> {
  value?: string;
  onChange?: (v: string) => void;
  mono?: boolean;
  rows?: number;
  style?: CSSProperties;
}

export function PGTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  mono,
  style,
  ...rest
}: PGTextareaProps) {
  const [focus, setFocus] = React.useState(false);
  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        width: "100%",
        resize: "vertical",
        background: "var(--bg-1)",
        border: `1px solid ${focus ? "var(--accent)" : "var(--border-1)"}`,
        borderRadius: "var(--r-3)",
        padding: 8,
        color: "var(--fg-0)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "var(--fs-13)",
        lineHeight: "var(--lh-body)",
        outline: "none",
        transition: "border-color var(--t-fast)",
        boxShadow: focus ? "0 0 0 3px oklch(0.72 0.15 235 / 0.15)" : "none",
        ...style,
      }}
      {...rest}
    />
  );
}

export interface PGCheckboxProps {
  checked?: boolean;
  onChange?: (v: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
}

export function PGCheckbox({
  checked,
  onChange,
  label,
  indeterminate,
  disabled,
}: PGCheckboxProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: "var(--fs-12)",
        userSelect: "none",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "var(--r-2)",
          background: checked || indeterminate ? "var(--accent)" : "var(--bg-1)",
          border: `1px solid ${
            checked || indeterminate ? "var(--accent)" : "var(--border-2)"
          }`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all var(--t-fast)",
          flexShrink: 0,
        }}
      >
        {checked && (
          <PGIcon
            name="check"
            size={10}
            style={{ color: "var(--accent-ink)" }}
            strokeWidth={2.5}
          />
        )}
        {indeterminate && !checked && (
          <PGIcon
            name="minus"
            size={10}
            style={{ color: "var(--accent-ink)" }}
            strokeWidth={2.5}
          />
        )}
      </span>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        disabled={disabled}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export interface PGToggleProps {
  checked?: boolean;
  onChange?: (v: boolean) => void;
  label?: ReactNode;
}

export function PGToggle({ checked, onChange, label }: PGToggleProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontSize: "var(--fs-12)",
      }}
      onClick={() => onChange?.(!checked)}
    >
      <span
        style={{
          width: 28,
          height: 16,
          borderRadius: 8,
          background: checked ? "var(--accent)" : "var(--bg-3)",
          position: "relative",
          transition: "background var(--t-fast)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: checked ? "var(--accent-ink)" : "var(--fg-1)",
            top: 2,
            left: checked ? 14 : 2,
            transition: "left var(--t-med)",
          }}
        />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export interface PGSelectOption {
  value: string;
  label: string;
}

export interface PGSelectProps {
  value?: string;
  onChange?: (v: string) => void;
  options: PGSelectOption[];
  size?: "sm" | "md" | "lg";
  style?: CSSProperties;
}

export function PGSelect({
  value,
  onChange,
  options,
  size = "md",
  style,
}: PGSelectProps) {
  const sizes = { sm: 24, md: 28, lg: 32 } as const;
  return (
    <div
      style={{
        height: sizes[size],
        display: "inline-flex",
        alignItems: "center",
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        padding: "0 4px 0 8px",
        gap: 4,
        position: "relative",
        ...style,
      }}
    >
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--fg-0)",
          fontSize: "var(--fs-12)",
          fontFamily: "var(--font-sans)",
          paddingRight: 16,
          cursor: "pointer",
          height: "100%",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <PGIcon
        name="chevronDown"
        size={11}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--fg-2)",
        }}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// BADGES / PILLS
// ═════════════════════════════════════════════════════════

export interface PGBadgeProps {
  children?: ReactNode;
  tone?: Tone;
  icon?: IconName | string;
  dot?: boolean;
  outline?: boolean;
  style?: CSSProperties;
}

export function PGBadge({
  children,
  tone = "default",
  icon,
  dot,
  outline,
  style,
}: PGBadgeProps) {
  const tones: Record<string, { bg: string; fg: string; border: string }> = {
    default: { bg: "var(--bg-3)", fg: "var(--fg-1)", border: "var(--border-1)" },
    accent: {
      bg: "oklch(0.72 0.15 235 / 0.18)",
      fg: "var(--accent)",
      border: "oklch(0.72 0.15 235 / 0.35)",
    },
    success: {
      bg: "oklch(0.72 0.15 155 / 0.18)",
      fg: "var(--git-added)",
      border: "oklch(0.72 0.15 155 / 0.35)",
    },
    warn: {
      bg: "oklch(0.75 0.14 75 / 0.18)",
      fg: "var(--git-modified)",
      border: "oklch(0.75 0.14 75 / 0.35)",
    },
    danger: {
      bg: "oklch(0.68 0.18 25 / 0.18)",
      fg: "var(--git-removed)",
      border: "oklch(0.68 0.18 25 / 0.35)",
    },
    violet: {
      bg: "oklch(0.72 0.15 295 / 0.18)",
      fg: "var(--git-untracked)",
      border: "oklch(0.72 0.15 295 / 0.35)",
    },
    muted: { bg: "transparent", fg: "var(--fg-2)", border: "var(--border-1)" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        height: 18,
        fontSize: "var(--fs-10)",
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        color: t.fg,
        background: outline ? "transparent" : t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--r-2)",
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: t.fg,
          }}
        />
      )}
      {icon && <PGIcon name={icon} size={10} />}
      {children}
    </span>
  );
}

export interface PGBranchPillProps {
  name: string;
  tone?: "accent" | "violet" | "green" | "amber" | "red";
  icon?: IconName | string;
  remote?: string;
  onClick?: () => void;
  active?: boolean;
  maxWidth?: number;
}

export function PGBranchPill({
  name,
  tone = "accent",
  icon = "branch",
  remote,
  onClick,
  active,
  maxWidth,
}: PGBranchPillProps) {
  const tones = {
    accent: "var(--accent)",
    violet: "var(--accent-2)",
    green: "var(--accent-3)",
    amber: "var(--accent-4)",
    red: "var(--accent-5)",
  } as const;
  const c = tones[tone];
  const fullName = (remote ? `${remote}/` : "") + name;
  return (
    <div
      onClick={onClick}
      title={fullName}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        maxWidth: maxWidth || undefined,
        padding: "0 6px 0 4px",
        fontSize: "var(--fs-11)",
        fontFamily: "var(--font-mono)",
        color: active ? "var(--accent-ink)" : c,
        background: active ? c : "transparent",
        border: `1px solid ${c}`,
        borderRadius: "var(--r-2)",
        cursor: onClick ? "pointer" : "default",
        minWidth: 0,
      }}
    >
      <PGIcon name={icon} size={10} style={{ flexShrink: 0 }} />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {remote && <span style={{ opacity: 0.7 }}>{remote}/</span>}
        {name}
      </span>
    </div>
  );
}

export function PGStatusMark({
  kind,
  size = 14,
}: {
  kind: string;
  size?: number;
}) {
  const map: Record<string, { c: string; label: string }> = {
    M: { c: "var(--git-modified)", label: "M" },
    A: { c: "var(--git-added)", label: "A" },
    D: { c: "var(--git-removed)", label: "D" },
    R: { c: "var(--git-renamed)", label: "R" },
    "?": { c: "var(--git-untracked)", label: "?" },
    U: { c: "var(--git-conflict)", label: "U" },
    C: { c: "var(--git-conflict)", label: "C" },
    I: { c: "var(--git-ignored)", label: "I" },
  };
  const v = map[kind] || map.M;
  return (
    <span
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: size > 12 ? 10 : 9,
        fontWeight: 700,
        color: v.c,
        border: `1px solid ${v.c}`,
        borderRadius: "var(--r-2)",
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {v.label}
    </span>
  );
}

export function PGAvatar({
  name = "?",
  size = 20,
  style,
}: {
  name?: string;
  size?: number;
  style?: CSSProperties;
}) {
  const hues = [235, 295, 155, 65, 25, 355, 195];
  const hue = hues[(name.charCodeAt(0) || 0) % hues.length];
  const c = `oklch(0.72 0.15 ${hue})`;
  const initial = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-2)",
        background: `oklch(0.72 0.15 ${hue} / 0.22)`,
        border: `1px solid oklch(0.72 0.15 ${hue} / 0.4)`,
        color: c,
        fontSize: size > 20 ? 10 : 9,
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        letterSpacing: 0,
        flexShrink: 0,
        ...style,
      }}
    >
      {initial}
    </span>
  );
}

// ═════════════════════════════════════════════════════════
// PANELS / SECTIONS / DIVIDERS
// ═════════════════════════════════════════════════════════

export interface PGPanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  flush?: boolean;
  scroll?: boolean;
}

export function PGPanel({
  title,
  actions,
  children,
  style,
  bodyStyle,
  flush,
  scroll,
}: PGPanelProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-4)",
        overflow: "hidden",
        minHeight: 0,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            height: 28,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px",
            background: "var(--bg-2)",
            borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          <span>{title}</span>
          {actions && (
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: flush ? 0 : 10,
          overflow: scroll ? "auto" : "visible",
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function PGSectionHeader({
  children,
  actions,
  small,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  small?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: small ? 20 : 24,
        padding: "0 8px",
        fontFamily: "var(--font-mono)",
        fontSize: small ? "var(--fs-10)" : "var(--fs-11)",
        color: "var(--fg-2)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
      }}
    >
      <span>{children}</span>
      {actions && <div style={{ display: "flex", gap: 2 }}>{actions}</div>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// TOOLTIP
// ═════════════════════════════════════════════════════════

export interface PGTooltipProps {
  children: ReactNode;
  content: ReactNode;
  shortcut?: string;
  placement?: "top" | "bottom" | "left" | "right";
}

export function PGTooltip({
  children,
  content,
  shortcut,
  placement = "bottom",
}: PGTooltipProps) {
  const [show, setShow] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const ref = React.useRef<HTMLSpanElement>(null);

  const onEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({
        top:
          placement === "bottom"
            ? r.bottom + 6
            : placement === "top"
              ? r.top - 6
              : r.top + r.height / 2,
        left:
          placement === "right"
            ? r.right + 6
            : placement === "left"
              ? r.left - 6
              : r.left + r.width / 2,
      });
    }
    setShow(true);
  };

  const tooltip =
    show && pos
      ? createPortal(
          <div
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 99999,
              transform:
                placement === "bottom"
                  ? "translate(-50%, 0)"
                  : placement === "top"
                    ? "translate(-50%, -100%)"
                    : placement === "right"
                      ? "translate(0, -50%)"
                      : "translate(-100%, -50%)",
              background: "var(--bg-4)",
              border: "1px solid var(--border-2)",
              borderRadius: "var(--r-3)",
              padding: "4px 8px",
              fontSize: "var(--fs-11)",
              color: "var(--fg-0)",
              whiteSpace: "nowrap",
              boxShadow: "var(--shadow-2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            {content}
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {children}
      {tooltip}
    </span>
  );
}

// ═════════════════════════════════════════════════════════
// PROGRESS / SPINNER / ALERT
// ═════════════════════════════════════════════════════════

export function PGProgressBar({
  value = 0,
  max = 100,
  indeterminate,
  tone = "accent",
  style,
  height = 4,
}: {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  tone?: "accent" | "success" | "warn" | "danger";
  style?: CSSProperties;
  height?: number;
}) {
  const tones = {
    accent: "var(--accent)",
    success: "var(--git-added)",
    warn: "var(--git-modified)",
    danger: "var(--git-removed)",
  };
  return (
    <div
      style={{
        width: "100%",
        height,
        background: "var(--bg-3)",
        borderRadius: height / 2,
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <div
        style={{
          height: "100%",
          background: tones[tone],
          width: indeterminate ? "35%" : `${(value / max) * 100}%`,
          borderRadius: height / 2,
          animation: indeterminate
            ? "pg-indeterminate 1.4s ease-in-out infinite"
            : undefined,
          transition: "width var(--t-med)",
        }}
      />
    </div>
  );
}

export function PGSpinner({
  size = 14,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      className="pg-spin"
      style={{
        display: "inline-flex",
        color: "var(--fg-2)",
        ...style,
      }}
    >
      <PGIcon name="sync" size={size} />
    </span>
  );
}
