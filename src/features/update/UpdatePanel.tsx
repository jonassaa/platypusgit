import { PGButton, PGIconButton } from "@/design";
import { usePlatform } from "@/lib/platform";
import { useUpdateStore } from "./useUpdateStore";

/** Dismissible panel with version, notes, and the primary update action. */
export function UpdatePanel() {
  const panelOpen = useUpdateStore((s) => s.panelOpen);
  const info = useUpdateStore((s) => s.info);
  const capability = useUpdateStore((s) => s.capability);
  const status = useUpdateStore((s) => s.status);
  const progress = useUpdateStore((s) => s.progress);
  const install = useUpdateStore((s) => s.install);
  const openReleasePage = useUpdateStore((s) => s.openReleasePage);
  const closePanel = useUpdateStore((s) => s.closePanel);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const platform = usePlatform();

  if (!panelOpen || !info) return null;

  const selfUpdate = capability === "self-update";
  const installing = status === "installing";

  return (
    <div
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
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
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
        <PGIconButton icon="x" title="Close" onClick={closePanel} />
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

      {!selfUpdate && platform === "macos" && (
        <code
          data-testid="pg-update-brew-hint"
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            background: "var(--bg-2)",
            borderRadius: "var(--r-2)",
            padding: "4px 8px",
          }}
        >
          brew upgrade platypusgit
        </code>
      )}

      {installing && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
          Downloading… {progress != null ? `${Math.round(progress * 100)}%` : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <PGButton
          size="sm"
          variant="default"
          data-testid="pg-update-dismiss"
          onClick={dismiss}
        >
          Later
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
