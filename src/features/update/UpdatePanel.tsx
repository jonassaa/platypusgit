import React from "react";

import { PGButton, PGIconButton } from "@/design";
import { usePlatform } from "@/lib/platform";
import { packageHint } from "./packageHint";
import { useUpdateStore } from "./useUpdateStore";

/** Dismissible panel with version, notes, and the primary update action. */
export function UpdatePanel() {
  const panelOpen = useUpdateStore((s) => s.panelOpen);
  const info = useUpdateStore((s) => s.info);
  const capability = useUpdateStore((s) => s.capability);
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const message = useUpdateStore((s) => s.message);
  const install = useUpdateStore((s) => s.install);
  const openReleasePage = useUpdateStore((s) => s.openReleasePage);
  const closePanel = useUpdateStore((s) => s.closePanel);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const platform = usePlatform();
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Click-outside to close, matching BranchPicker's popover pattern. Escape is
  // handled by the keymap's `app.closeOverlay` action (features/keymap), not a
  // local listener, so it stays in the cheat-sheet and honours rebinding.
  React.useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      const panel = panelRef.current;
      if (panel && t && panel.contains(t)) return;
      closePanel();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panelOpen, closePanel]);

  // `!info.available` matters on a RE-check: a deleted/yanked release would
  // otherwise leave an "Update available" panel open while the chip vanishes.
  if (!panelOpen || !info || !info.available) return null;

  const selfUpdate = capability === "self-update";
  const hint = packageHint(capability, platform);

  return (
    <div
      ref={panelRef}
      data-testid="pg-update-panel"
      role="dialog"
      aria-label="Update available"
      style={{
        position: "absolute",
        top: 44,
        right: 12,
        width: 360,
        zIndex: 50,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        boxShadow: "var(--shadow-3)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--fg-0)" }}>
          Update available — {info.latestVersion}
        </span>
        <PGIconButton
          icon="x"
          title="Close (ask again later)"
          onClick={closePanel}
        />
      </div>

      <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
        You have {info.currentVersion}.
      </div>

      {info.notes && (
        <pre
          style={{
            maxHeight: 160,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            background: "var(--bg-2)",
            borderRadius: "var(--r-2)",
            padding: 8,
            margin: 0,
          }}
        >
          {info.notes}
        </pre>
      )}

      {/* The notify path's only actionable content. This used to be a bare
          macOS-gated `brew` line, so a Linux .deb install got "View release"
          and no explanation at all. */}
      {hint && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
            {hint.note}
          </span>
          <code
            data-testid="pg-update-pkg-hint"
            style={{
              fontSize: "var(--fs-11)",
              color: "var(--fg-1)",
              background: "var(--bg-2)",
              borderRadius: "var(--r-2)",
              padding: "4px 8px",
            }}
          >
            {hint.command}
          </code>
        </div>
      )}

      {installing && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
          Downloading… {progress != null ? `${Math.round(progress * 100)}%` : ""}
        </div>
      )}

      {message && (
        <div
          data-testid="pg-update-message"
          style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
        >
          {message}
        </div>
      )}

      {/* Without this a failed download just stopped the spinner — a silent
          dead button with no way to tell what went wrong. */}
      {error && (
        <div
          data-testid="pg-update-error"
          role="alert"
          style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {/* "Skip this version" persists suppression for this version forever;
            the x above only closes. They used to be presented identically. */}
        <PGButton
          size="sm"
          variant="default"
          data-testid="pg-update-dismiss"
          title={`Never prompt again for ${info.latestVersion}`}
          onClick={dismiss}
        >
          Skip this version
        </PGButton>
        <PGButton
          size="sm"
          variant="primary"
          data-testid="pg-update-action"
          loading={installing}
          onClick={selfUpdate ? install : openReleasePage}
        >
          {selfUpdate ? "Install & restart" : "View release"}
        </PGButton>
      </div>
    </div>
  );
}
