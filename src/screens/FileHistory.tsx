import React from "react";
import { PGButton, PGEmpty, PGIcon, PGSpinner } from "@/design";
import { useRepoStore, setActivity } from "@/features/repo/useRepoStore";
import { ShallowNotice } from "@/features/repo/ShallowNotice";
import { useNavStore } from "@/features/nav/useNavStore";
import { cancelWalk, fileHistory, FILE_HISTORY_LIMIT } from "@/lib/tauri";
import { appErrorMessage, isCancelledError } from "@/lib/errors";
import { fileHistoryNotice } from "@/lib/derive";
import { DeepViewHeader } from "@/features/nav/DeepViewHeader";
import { PGPane, FocusableScroll, usePaneList } from "@/features/keymap";
import type { FileHistory } from "@/lib/types";

/**
 * What bounded the search, and the way past it (#474).
 *
 * The sentence is `fileHistoryNotice`; this is only its layout, and it is
 * deliberately the same layout as `ShallowNotice` next to it — both are "the
 * list below you is not the whole truth, and here is why", and two strips that
 * can stack on one screen must not look like two different kinds of thing.
 *
 * The button is the blob ceiling's "diff it anyway" in another place: a cap is
 * a guess about intent, it is usually right, and when it is wrong the user has
 * to be able to say so. Waiving it asks for the walk that takes 135 s on the
 * kernel — which is why it is a click and not the default, and why it is
 * cancellable once running.
 */
function HistoryLimitNotice({
  history,
  searching,
  onSearchAll,
}: {
  history: FileHistory | null;
  searching: boolean;
  onSearchAll: () => void;
}) {
  const notice = fileHistoryNotice(history);
  if (!notice) return null;
  return (
    <div
      data-testid="history-limit-notice"
      data-stopped-at={history?.stoppedAt}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid var(--border-0)",
        background: "var(--bg-1)",
        fontSize: "var(--fs-11)",
        flexShrink: 0,
      }}
    >
      <PGIcon
        name="warn"
        size={12}
        style={{ color: "var(--git-modified)", flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--git-modified)" }}>{notice.title}</div>
        <div style={{ color: "var(--fg-3)" }}>{notice.detail}</div>
      </div>
      {notice.canSearchAll && (
        <PGButton
          size="sm"
          data-testid="history-search-all"
          disabled={searching}
          title="Walk the rest of history for changes to this file — slow on a large repository, and cancellable"
          onClick={onSearchAll}
        >
          {searching ? "Searching…" : "Search all of history"}
        </PGButton>
      )}
    </div>
  );
}

export function FileHistoryScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  const setNavIntent = useNavStore((s) => s.setIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<FileHistory | null>(null);
  const [selected, setSelected] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The user asked for the visit cap to be waived for THIS path. */
  const [searchAll, setSearchAll] = React.useState(false);
  /** Bumped to re-run the same search — the way back from a cancelled one. */
  const [attempt, setAttempt] = React.useState(0);
  const [cancelled, setCancelled] = React.useState(false);

  const commits = history?.commits ?? [];

  React.useEffect(() => {
    if (intent?.kind === "file-history") {
      setPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  /**
   * A cancel this screen has asked for and not yet seen land.
   *
   * `cancel_walk` addresses the REPOSITORY, not one walk — deliberately, so the
   * status bar's Cancel button needs nothing to point at. The cost is that a
   * cancel still in flight would reach whatever is registered when it arrives,
   * including the walk started for the file the user just switched TO. So the
   * next search waits for it: one extra round trip, and only when a walk was
   * actually running.
   */
  const pendingCancel = React.useRef<Promise<unknown> | null>(null);

  // A new file is a new question: the previous answer's waiver and its
  // cancellation do not carry over.
  React.useEffect(() => {
    setSearchAll(false);
    setCancelled(false);
    setHistory(null);
  }, [path]);

  React.useEffect(() => {
    if (!repo || !path) return;
    const repoId = repo.id;
    let live = true;
    let inFlight = true;
    setLoading(true);
    setError(null);
    setCancelled(false);
    // `RepoActivity`, not a private spinner: this is the app's one answer to
    // "what is running and can I stop it", and a walk that keeps its own busy
    // flag gets neither the status line nor the Cancel button (#474).
    setActivity(
      repoId,
      "history",
      searchAll ? `Searching all history for ${path}…` : `Searching history for ${path}…`,
    );

    const cancelFirst = pendingCancel.current ?? Promise.resolve();
    cancelFirst
      .then(() => fileHistory(repoId, path, FILE_HISTORY_LIMIT, searchAll))
      .then((h) => {
        if (!live) return;
        setHistory(h);
        setSelected(0);
      })
      .catch((e) => {
        if (!live) return;
        // A cancellation is an answer, not a failure: the user asked for the
        // walk to stop. A red banner would report their own click as a fault.
        if (isCancelledError(e)) setCancelled(true);
        else setError(appErrorMessage(e));
      })
      .finally(() => {
        inFlight = false;
        if (!live) return;
        setActivity(repoId, "history", null);
        setLoading(false);
      });

    return () => {
      live = false;
      // Leaving the screen, or asking about a different file, must not leave a
      // walk running: it costs a blocking thread and, on a large repository,
      // seconds of tree comparisons for an answer nobody will read.
      if (inFlight) pendingCancel.current = cancelWalk(repoId).catch(() => {});
      // Cleared here as well as in `finally`, and it has to be BOTH: this runs
      // before the next effect sets its own label, so the order is clear →
      // set, while `finally` is what clears a walk that simply ended.
      setActivity(repoId, "history", null);
    };
  }, [repo?.id, path, searchAll, attempt]);

  // Keyboard: arrows move the commit selection, Enter opens the commit's diff.
  usePaneList({
    paneId: "fileHistory.list",
    count: commits.length,
    selectedIndex: selected,
    onSelect: setSelected,
    onActivate: (i) => {
      const c = commits[i];
      if (c) setNavIntent({ kind: "commit-vs-wt", oid: c.oid });
    },
    searchText: (i) => commits[i]?.summary ?? "",
  });

  if (!path) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <DeepViewHeader crumbs={["File history"]} />
        <PGEmpty icon="history" title="No file selected">
          Right-click a file and choose "File history".
        </PGEmpty>
      </div>
    );
  }

  return (
    <PGPane id="fileHistory.list" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <DeepViewHeader crumbs={[`History — ${path}`]} />
      {/* A file's history ends at the shallow boundary too, and the list gives
          no sign of it: it simply has fewer rows (#255). */}
      <ShallowNotice surface="fileHistory" />
      {/* …and it ends at the search's own limits, which is a different claim
          with a different remedy (#474). */}
      <HistoryLimitNotice
        history={history}
        searching={loading}
        onSearchAll={() => setSearchAll(true)}
      />
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      {cancelled && !loading && (
        <div
          data-testid="history-search-cancelled"
          style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, fontSize: "var(--fs-12)" }}
        >
          <span style={{ color: "var(--fg-3)" }}>
            Search stopped. Nothing below it was searched.
          </span>
          <PGButton
            size="sm"
            data-testid="history-search-again"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Search again
          </PGButton>
        </div>
      )}
      {!loading && !error && !cancelled && commits.length === 0 && (
        <PGEmpty icon="history" title="No commits touched this file" />
      )}
      <FocusableScroll style={{ flex: 1 }}>
        {commits.map((c, i) => (
          <div
            key={c.oid}
            onClick={() => setSelected(i)}
            data-pg-row=""
            data-selected={selected === i ? "" : undefined}
            style={{
              display: "flex",
              gap: 10,
              padding: "calc(6px * var(--row-scale) + var(--row-step) / 2) 12px",
              borderBottom: "1px solid var(--border-0)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-12)",
              cursor: "pointer",
            }}
          >
            <span style={{ color: "var(--fg-3)" }}>{c.shortOid}</span>
            <span style={{ flex: 1 }}>{c.summary}</span>
            <span style={{ color: "var(--fg-3)" }}>{c.author}</span>
          </div>
        ))}
      </FocusableScroll>
    </PGPane>
  );
}
