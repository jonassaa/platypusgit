/**
 * What the app is reading from the repository right now (#296 gap 8).
 *
 * `refreshAll` is TEN backend reads behind one `Promise.all`, and it had one
 * boolean to describe all of them. On a fast local repository that is fine and
 * nobody ever sees it; on the setups where it is not — a `/mnt/c` repository
 * under WSL (#274), a repository with tens of thousands of refs — "syncing…"
 * told the user nothing about which of the ten was the slow one, which is the
 * single most useful fact when a launch takes nine seconds.
 *
 * So each read registers a task while it is in flight. The status bar names the
 * longest-running one and counts the rest; expanding it lists them all with
 * their own clocks.
 *
 * **This is deliberately NOT `RepoActivity`.** An activity entry is an operation
 * the USER started, and it earns a Cancel button. A loading task is the app
 * reading its own state, cannot be cancelled, and is usually over in under a
 * tenth of a second. Merging them would put a Cancel button on `listing tags`.
 */

/** One backend read in flight. */
export interface LoadingTask {
  /**
   * Stable key for the read, unique within a repository. Two reads with the
   * same id are the same read — a refresh that starts while another is still
   * running replaces rather than duplicates, which is what keeps the count
   * honest when refreshes overlap.
   */
  id: string;
  /**
   * Lowercase gerund, as it reads inside "Loading: …" — "fetching remotes",
   * not "Fetch remotes" or "Remotes".
   */
  label: string;
  startedAt: number;
}

/**
 * The task to name when the indicator is collapsed: the one running longest.
 *
 * Not the first registered, and not the most recent. As the fast reads drop
 * off, the name settles onto the one actually holding the refresh up — which is
 * the whole question this feature exists to answer. Ties break on `id` so the
 * label cannot flap between two reads that started in the same millisecond.
 */
export function primaryTask(tasks: LoadingTask[]): LoadingTask | null {
  if (tasks.length === 0) return null;
  return tasks.reduce((oldest, t) =>
    t.startedAt < oldest.startedAt ||
    (t.startedAt === oldest.startedAt && t.id < oldest.id)
      ? t
      : oldest,
  );
}

/** `Loading: fetching remotes + 5 others`, or null when nothing is in flight. */
export function loadingSummary(tasks: LoadingTask[]): string | null {
  const primary = primaryTask(tasks);
  if (!primary) return null;
  const others = tasks.length - 1;
  if (others <= 0) return `Loading: ${primary.label}`;
  return `Loading: ${primary.label} + ${others} other${others === 1 ? "" : "s"}`;
}

/** Longest-running first — the order the expanded list reads best in. */
export function byAge(tasks: LoadingTask[]): LoadingTask[] {
  return [...tasks].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
}
