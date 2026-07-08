import { PGIcon } from "@/design";
import { useUpdateStore } from "./useUpdateStore";

/** Titlebar chip shown whenever an update is available (even if dismissed). */
export function UpdateChip() {
  const available = useUpdateStore((s) => s.info?.available ?? false);
  const latest = useUpdateStore((s) => s.info?.latestVersion);
  const openPanel = useUpdateStore((s) => s.openPanel);

  if (!available) return null;

  return (
    <button
      type="button"
      data-testid="pg-update-chip"
      onClick={openPanel}
      title={`Update available: ${latest}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--fs-11)",
        color: "var(--accent)",
        background: "transparent",
        border: "1px solid var(--accent)",
        borderRadius: "var(--r-2)",
        padding: "1px 7px",
        cursor: "pointer",
      }}
    >
      <PGIcon name="download" size={12} />
      {latest}
    </button>
  );
}
