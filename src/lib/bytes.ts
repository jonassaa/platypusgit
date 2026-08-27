/**
 * Human-readable byte size.
 *
 * Lives in `lib/` rather than in the LFS store because three unrelated surfaces
 * now report a size — an LFS pointer's payload (#93), and both sides of an image
 * preview (#224) — and two spellings of "1.4 MB" in one window reads as a bug.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above — "1.4 MB", "512 MB".
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
