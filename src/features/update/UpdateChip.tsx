import { PGIcon } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { updatesManagedExternally, useUpdateStore } from "./useUpdateStore";

/** Titlebar chip shown whenever an update is available (even if dismissed). */
export function UpdateChip() {
  const available = useUpdateStore((s) => s.info?.available ?? false);
  const latest = useUpdateStore((s) => s.info?.latestVersion);
  const openPanel = useUpdateStore((s) => s.openPanel);
  const capability = useUpdateStore((s) => s.capability);
  const mode = useSettingsStore((s) => s.updateCheckMode);

  // A Microsoft Store install has no update surface, and the chip is the most
  // visible piece of it (#360): a version number in the titlebar, one click from
  // a panel pointing at a download. `check()` already refuses to produce `info`
  // there, so this is belt-and-braces — but it is cheap, and the alternative is
  // a titlebar element whose absence depends on a promise made two files away.
  if (updatesManagedExternally(capability)) return null;

  // "Never" is not only "make no request" (#237). A session that checked before
  // the user switched checks off still holds the result, and a chip whose only
  // action is a panel offering to update is the interruption they opted out of.
  // `manual` deliberately still shows it: that mode gates the REQUEST, not the
  // answer to a check the user asked for.
  if (mode === "never") return null;
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
