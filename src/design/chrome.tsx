import React, { type CSSProperties, type ReactNode } from "react";
import { PGIcon, type IconName } from "./icons";
import { PGLogo } from "./logo";
import { PGTooltip } from "./primitives";
import { usePlatform } from "@/lib/platform";
import { PGWindowControls } from "./window-controls";

// ═════════════════════════════════════════════════════════
// WINDOW / TITLEBAR
// ═════════════════════════════════════════════════════════

export interface PGTitlebarProps {
  repoName?: string;
  branch?: ReactNode;
  dirty?: number;
  children?: ReactNode;
  rightSlot?: ReactNode;
}

export function PGTitlebar({
  repoName = "platypus-core",
  branch = "main",
  dirty = 0,
  children,
  rightSlot,
}: PGTitlebarProps) {
  const platform = usePlatform();
  // Treat first-render (undefined) as mac to avoid Win/Linux control flash.
  const isMac = platform === "macos" || platform === undefined;

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 38,
        background: "var(--bg-titlebar)",
        borderBottom: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        userSelect: "none",
        paddingLeft: isMac ? 80 : 12,
        paddingRight: isMac ? 12 : 0,
      }}
    >
      {isMac && (
        <div
          data-testid="pg-titlebar-mac-shim"
          style={{ width: 0, height: 38 }}
        />
      )}
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
        <PGLogo size={17} data-testid="pg-app-logo" title="PlatypusGit" />
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
      <div data-tauri-drag-region style={{ flex: 1, height: 38 }} />
      {children}
      {rightSlot}
      {!isMac && <PGWindowControls />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// REPOSITORY TAB STRIP
// ═════════════════════════════════════════════════════════

export interface PGTabItem {
  /** Stable key — the repository's workdir path. */
  id: string;
  label: string;
  /** Full path, shown as the row's tooltip. */
  title?: string;
  active?: boolean;
  /** Uncommitted-change count; renders a dot + number. */
  dirty?: number;
  /** Conflicted-file count; renders a conflict glyph + number. */
  conflicts?: number;
  /** True while this tab's repository is being opened. */
  loading?: boolean;
  /** The tab's open was rejected (path moved, deleted, refused). */
  failed?: boolean;
}

/**
 * The open-repository strip (#90). Its own row BELOW the titlebar, not inside
 * it: the titlebar already carries the logo, repo name, branch chip, dirty
 * badge, the drag region and five right-hand controls, and squeezing a
 * scrolling strip in there would eat `data-tauri-drag-region` on a narrow
 * window.
 *
 * Chrome, so a FIXED height — the UI-density token deliberately does not apply
 * (see CLAUDE.md's density rule). The strip owns its own `overflow-x`, and each
 * tab is `flexShrink: 0` with a max width, so a long tab list scrolls INSIDE
 * the strip and can never widen the window (the shell is a fixed frame).
 *
 * The `+` sits INSIDE that scroller, immediately after the last tab (issue 178),
 * where browsers and editors put it — not pinned to the far right, which is the
 * overflow layout applied unconditionally and leaves a window-wide gap at two
 * tabs. Consequence, accepted: once the tabs overflow, the button scrolls off
 * with them. It is then no less reachable than the tabs themselves — you are
 * already scrolling the strip to see those — and "Open repository…" also has
 * ⌘O, the palette and the Welcome screen, none of which the strip owns. The
 * alternative (pin it whenever the strip overflows) means measuring
 * `scrollWidth` vs `clientWidth` on every tab change and window resize to pick
 * between two layouts, on a webview with no `ResizeObserver` — a measurement
 * trap this codebase has paid for twice, for a button with three other doors.
 */
export function PGTabStrip({
  tabs,
  onSelect,
  onClose,
  onNew,
  onTabContextMenu,
  reorder,
}: {
  tabs: PGTabItem[];
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  onNew?: () => void;
  onTabContextMenu?: (id: string, e: React.MouseEvent) => void;
  /**
   * Drag-to-reorder wiring (#238). The strip stays dumb: the caller owns the
   * order and hands back `useRowReorder`'s handle plus the ref of the scroller
   * to autoscroll. Absent, the strip renders exactly as it did before.
   */
  reorder?: {
    registerTab: (id: string) => (el: HTMLElement | null) => void;
    onTabPointerDown: (id: string, e: React.PointerEvent) => void;
    draggingId: string | null;
    scrollRef: React.RefObject<HTMLDivElement | null>;
  };
}) {
  const activeRef = React.useRef<HTMLDivElement | null>(null);
  const newRef = React.useRef<HTMLButtonElement | null>(null);
  const activeId = tabs.find((t) => t.active)?.id ?? null;
  const lastId = tabs.length ? tabs[tabs.length - 1].id : null;
  // Keep the active tab reachable after a keyboard switch into an off-screen
  // tab. `inline: "nearest"` scrolls the strip, never the page.
  React.useEffect(() => {
    // The `+` lives INSIDE the scroller, after the last tab, so scrolling that
    // tab into view stops at its right edge and leaves the button clipped.
    // Aim at the button whenever the last tab is the active one: it is the
    // scroller's final child, so "make it visible" IS "scroll to the end",
    // which reveals the tab as well.
    const target =
      activeId !== null && activeId === lastId ? newRef.current : activeRef.current;
    // Optional call: jsdom has no scrollIntoView, and this is presentation —
    // unlike a viewport MEASUREMENT, skipping it changes nothing but the scroll
    // position (see CLAUDE.md on why measurements must not be guarded).
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId, lastId]);

  return (
    <div
      data-testid="repo-tab-strip"
      style={{
        height: 28,
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-titlebar)",
        borderBottom: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-11)",
        userSelect: "none",
      }}
    >
      <div
        ref={reorder?.scrollRef}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            // Two claims on one ref: the scroll-into-view effect wants the
            // active tab, the reorder hook wants every tab's box.
            ref={(el) => {
              if (t.active) activeRef.current = el;
              reorder?.registerTab(t.id)(el);
            }}
            data-testid="repo-tab"
            data-path={t.id}
            data-active={t.active ? "true" : "false"}
            data-dirty={t.dirty ?? 0}
            title={t.title ?? t.label}
            onClick={() => onSelect?.(t.id)}
            onAuxClick={(e) => {
              // Middle-click closes, as in every tabbed thing.
              if (e.button === 1) onClose?.(t.id);
            }}
            onContextMenu={(e) => onTabContextMenu?.(t.id, e)}
            onPointerDown={
              reorder ? (e) => reorder.onTabPointerDown(t.id, e) : undefined
            }
            style={{
              flexShrink: 0,
              maxWidth: 220,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px",
              cursor: reorder?.draggingId === t.id ? "grabbing" : "pointer",
              // Only where a drag can actually start, so a strip without the
              // gesture keeps touch-scrolling.
              touchAction: reorder ? "none" : undefined,
              position: "relative",
              background: t.active ? "var(--bg-0)" : "transparent",
              color: t.active ? "var(--fg-0)" : "var(--fg-2)",
              borderRight: "1px solid var(--border-0)",
              opacity: t.failed ? 0.55 : 1,
            }}
          >
            {t.active && (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 2,
                  background: "var(--accent)",
                }}
              />
            )}
            <PGIcon
              name={t.failed ? "warn" : "repo"}
              size={11}
              style={{
                color: t.failed
                  ? "var(--git-removed)"
                  : t.active
                    ? "var(--accent)"
                    : "var(--fg-3)",
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t.label}
            </span>
            {!!t.conflicts && (
              <span
                title={`${t.conflicts} conflict${t.conflicts === 1 ? "" : "s"}`}
                style={{ color: "var(--git-conflict)", fontSize: "var(--fs-10)" }}
              >
                ✕{t.conflicts}
              </span>
            )}
            {!t.conflicts && !!t.dirty && (
              <span
                title={`${t.dirty} changed`}
                style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
              >
                ●{t.dirty}
              </span>
            )}
            <button
              data-testid="repo-tab-close"
              data-path={t.id}
              title="Close repository"
              onClick={(e) => {
                e.stopPropagation();
                onClose?.(t.id);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--fg-3)",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              <PGIcon name="x" size={10} />
            </button>
          </div>
        ))}
        {/* Immediately after the last tab, INSIDE the scroller — see the
            component doc for why it scrolls away with the tabs rather than
            pinning to the right edge. No `borderLeft`: the tab it follows
            already draws a `borderRight`, and the two rendered a double line. */}
        <button
          ref={newRef}
          data-testid="repo-tab-new"
          title="Open repository…"
          onClick={onNew}
          style={{
            flexShrink: 0,
            width: 28,
            background: "transparent",
            border: "none",
            color: "var(--fg-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PGIcon name="plus" size={12} />
        </button>
      </div>
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
      // Named so a test can scope to the bar: its short labels ("1 conflict")
      // are substrings of copy elsewhere on screen, the operation bar included.
      data-testid="status-bar"
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
  testId,
}: {
  icon?: IconName | string;
  label?: ReactNode;
  tone?: "default" | "accent" | "success" | "warn" | "danger";
  onClick?: () => void;
  /**
   * A stable hook for the e2e suite. Threaded explicitly rather than spread
   * from `...rest`, like every other design-system row: a status item's own
   * label is prose, and a spec that waits on prose dies to a copy edit.
   */
  testId?: string;
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
      data-testid={testId}
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
  highlightIndex,
}: {
  value?: string;
  onChange?: (id: string) => void;
  items: ActivityBarItem[];
  settingsActive?: boolean;
  onSettingsClick?: () => void;
  /** Keyboard cursor position when the bar has focus (distinct from active). */
  highlightIndex?: number;
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
      {items.map((it, idx) => {
        const active = value === it.id;
        const highlighted = highlightIndex === idx;
        return (
          <PGTooltip
            key={it.id}
            content={it.label}
            shortcut={it.shortcut}
            placement="right"
          >
            <button
              onClick={() => onChange?.(it.id)}
              data-activity={it.id}
              style={{
                width: 44,
                height: 40,
                background: highlighted ? "var(--bg-3)" : "transparent",
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
          data-activity="settings"
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  actions?: ReactNode;
  count?: number;
  children?: ReactNode;
}

export function PGSidebarGroup({
  title,
  icon,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  actions,
  count,
  children,
}: PGSidebarGroupProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  // Optionally controlled: `open` omitted keeps today's local-state behaviour,
  // so no existing caller changes. A search needs to force groups with hits
  // open, which local state cannot express.
  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => {
    if (controlledOpen === undefined) setUncontrolledOpen(!open);
    onOpenChange?.(!open);
  };
  return (
    <div style={{ borderBottom: "1px solid var(--border-0)" }}>
      <div
        onClick={toggle}
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
  role?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler;
  ariaSelected?: boolean;
  dimmed?: boolean;
  testId?: string;
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
  role,
  tabIndex,
  onKeyDown,
  ariaSelected,
  dimmed,
  testId,
}: PGSidebarRowProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      aria-selected={ariaSelected}
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: "calc(22px + var(--row-step))",
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
        opacity: dimmed ? 0.45 : undefined,
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
