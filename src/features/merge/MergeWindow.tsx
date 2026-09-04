// MergeWindow — root component of the `merge` Tauri window (see main.tsx).
// Owns: which file is open, sides fetching, chooser fallback for
// binary/deleted conflicts, current-conflict selection, auto-advance. The
// 3-pane editor body renders in <MergeBody>; region states + body ref are
// held here for Task 6 (chords, footer, Apply).

import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import {
  PGButton,
  PGDialogHost,
  PGEmpty,
  PGIcon,
  PGResizeHandle,
  PGSpinner,
  pgConfirm,
  usePaneSize,
  usePreventBrowserContextMenu,
} from "@/design";
import { useElementSize } from "@/lib/useElementSize";
import { MergeFileList, type MergeFile } from "./FileList";
import {
  acceptOurs as acceptOursIpc,
  acceptTheirs as acceptTheirsIpc,
  conflictSides,
  getStatus,
  saveResolution,
} from "@/lib/tauri";
import type { ConflictSides, FileStatus } from "@/lib/types";
import { isConflicted } from "@/lib/derive";
import { appErrorMessage } from "@/lib/errors";
import { eventToChord, formatChord } from "@/features/keymap/chord";
import { ImageDiffView } from "@/features/diff/ImageDiffView";
import { buildMergeModel } from "./mergeModel";
import { MergeBody, type MergeBodyHandle } from "./MergeBody";
import type { RegionState } from "./resultEditor";

export function findNextConflict(status: FileStatus[], current: string): string | null {
  const next = status.find((s) => isConflicted(s) && s.path !== current);
  return next ? next.path : null;
}

export function MergeWindow() {
  // Each WINDOW needs its own listener — the hook is document-scoped and this
  // window has its own document, so `AppShell`'s call covers only the main one.
  // Without it WebKitGTK's native context menu was reachable throughout the
  // resolver, including on the editable result pane, where right-click also
  // opens spell-check and input-method SUBMENUS. On Linux that is a real
  // GtkMenu (a native GDK popup), so it is also the one surface in this window
  // that could take a toolkit grab mid-conflict-resolution.
  usePreventBrowserContextMenu();
  const params = new URLSearchParams(window.location.search);
  const [repoId, setRepoId] = React.useState(params.get("repoId") ?? "");
  const [path, setPath] = React.useState(params.get("path") ?? "");
  const [sides, setSides] = React.useState<ConflictSides | null>(null);
  const [loading, setLoading] = React.useState(true);
  // The sidebar's contents. `conflicted` is disk truth; `sessionResolved` keeps
  // files the user finished here listed anyway, so the list does not shrink out
  // from under them as they work down it.
  const [conflicted, setConflicted] = React.useState<string[]>([]);
  const [sessionResolved, setSessionResolved] = React.useState<string[]>([]);
  // Bumped when the open file changed on disk without being resolved (a
  // "Restart resolution" brings its markers back), to re-fetch its sides.
  const [reloadKey, setReloadKey] = React.useState(0);
  // The body beside the list is the three-pane resolver (ours | result | theirs),
  // so its floor is what three code columns need — but nothing caps the list
  // beyond that (#162).
  const layout = useElementSize();
  const listPane = usePaneSize(260, {
    axis: "width",
    container: layout,
    min: 180,
    siblingMin: 480,
    storageKey: "pg-merge-list-w",
  });

  const files: MergeFile[] = React.useMemo(() => {
    const open = new Set(conflicted);
    const all = Array.from(new Set([...conflicted, ...sessionResolved])).sort();
    return all.map((p) => ({ path: p, resolved: !open.has(p) }));
  }, [conflicted, sessionResolved]);
  const remaining = conflicted.length;

  /** Re-read which files are conflicted. Returns the raw status so callers can
   *  pick the next file from the same snapshot. */
  const refreshFiles = React.useCallback(async (): Promise<FileStatus[]> => {
    if (!repoId) return [];
    const status = await getStatus(repoId);
    setConflicted(status.filter(isConflicted).map((s) => s.path));
    return status;
  }, [repoId]);

  const bodyRef = React.useRef<MergeBodyHandle>(null);
  // Region states drive the footer counter + Apply gate. They are SEEDED from
  // the model synchronously during render (below) and then kept live by
  // MergeBody's onRegionsChange (fires on every edit / accept). We seed from
  // `model.resultRegions` — NOT `[]` — on a model change: a passive-effect
  // reset would run AFTER MergeBody's mount push and clobber the real regions
  // back to [], and `[].every(...) === true` would wrongly ENABLE Apply while
  // conflicts remain unresolved. Seeding with the real (all-unresolved) regions
  // means the gate is correct on the very first render (Apply disabled).
  const [regionStates, setRegionStates] = React.useState<RegionState[]>([]);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const model = React.useMemo(() => (sides ? buildMergeModel(sides) : null), [sides]);
  const [currentId, setCurrentId] = React.useState<number | null>(null);
  // Reset per-file interaction state whenever a new model loads. Done during
  // render (React's "reset state on identity change" pattern) so the Apply gate
  // and current-conflict selection are correct synchronously — before the first
  // paint of the body — rather than one passive-effect tick late.
  const [seededModel, setSeededModel] = React.useState<typeof model>(null);
  if (model !== seededModel) {
    setSeededModel(model);
    setRegionStates(
      model ? model.resultRegions.map((r) => ({ ...r, resolution: null })) : [],
    );
    setCurrentId(model && model.conflicts.length > 0 ? 0 : null);
    setApplyError(null);
  }

  // Keep the file list current, and choose a file when the window was opened on
  // the repository rather than on one (the operation bar's CTA, the status-bar
  // count, the ⌘5 chord — none of them name a file).
  React.useEffect(() => {
    if (!repoId) return;
    let stale = false;
    void refreshFiles()
      .then((status) => {
        if (stale) return;
        const first = status.filter(isConflicted)[0]?.path;
        setPath((cur) => cur || first || "");
        // Nothing to select and nothing to load: clear the spinner the sides
        // effect below would otherwise leave running forever.
        if (!first) setLoading(false);
      })
      .catch((e) => console.error("merge window file list failed", e));
    return () => {
      stale = true;
    };
  }, [repoId, reloadKey, refreshFiles]);

  // Load the open file's sides.
  React.useEffect(() => {
    if (!repoId || !path) return;
    let stale = false;
    setLoading(true);
    setSides(null);
    conflictSides(repoId, path)
      .then((s) => {
        if (stale) return;
        setSides(s);
      })
      .catch((e) => console.error("merge window load failed", e))
      .finally(() => !stale && setLoading(false));
    void getCurrentWindow().setTitle(`Resolve: ${path}`);
    return () => {
      stale = true;
    };
  }, [repoId, path, reloadKey]);

  /** After a file is resolved: notify main, load next conflict or close. */
  const advance = React.useCallback(async () => {
    const done = path;
    await emit("merge://resolved", { repoId, path: done });
    setSessionResolved((prev) => (prev.includes(done) ? prev : [...prev, done]));
    const status = await refreshFiles();
    const next = findNextConflict(status, done);
    if (next) setPath(next);
    else await getCurrentWindow().close();
  }, [repoId, path, refreshFiles]);

  /** A sidebar action took a file out of conflict (accept a side, mark
   *  resolved). The open file follows the same path Apply does. */
  const onFileResolved = React.useCallback(
    async (p: string) => {
      if (p === path) {
        await advance();
        return;
      }
      await emit("merge://resolved", { repoId, path: p });
      setSessionResolved((prev) => (prev.includes(p) ? prev : [...prev, p]));
      await refreshFiles();
    },
    [path, advance, repoId, refreshFiles],
  );

  /** A sidebar action changed a file that is still conflicted (a restart). */
  const onFileChanged = React.useCallback(
    async (p: string) => {
      await refreshFiles();
      // Its markers are back, so the loaded sides and the editor are stale.
      if (p === path) setReloadKey((k) => k + 1);
    },
    [path, refreshFiles],
  );

  const chooser = sides && (sides.binary || sides.ours == null || sides.theirs == null);

  // --- Footer / Apply gate ------------------------------------------------
  const total = regionStates.length;
  const resolvedCount = regionStates.filter((r) => r.resolution !== null).length;
  // A pure auto-merge file (zero conflicts) is applyable — [].every() is true.
  const allResolved = regionStates.every((r) => r.resolution !== null);
  const canApply = !loading && !!model && !chooser && allResolved;

  // --- Conflict navigation (F7 / ⇧F7) -------------------------------------
  const moveConflict = React.useCallback(
    (dir: 1 | -1) => {
      const regs = bodyRef.current?.regions() ?? regionStates;
      const n = regs.length;
      if (n === 0) return;
      const ids = regs.map((r) => r.id).sort((a, b) => a - b);
      const byId = new Map(regs.map((r) => [r.id, r]));
      const curIdx = currentId == null ? -1 : ids.indexOf(currentId);
      // Prefer the next/prev UNRESOLVED region, wrapping around.
      let target: number | null = null;
      for (let step = 1; step <= n; step++) {
        const idx = (((curIdx + dir * step) % n) + n) % n;
        if (byId.get(ids[idx])!.resolution === null) {
          target = ids[idx];
          break;
        }
      }
      // All resolved: plain next/prev id with wrap.
      if (target == null) {
        const idx =
          curIdx === -1 ? (dir === 1 ? 0 : n - 1) : (((curIdx + dir) % n) + n) % n;
        target = ids[idx];
      }
      setCurrentId(target);
      bodyRef.current?.reveal(target);
    },
    [regionStates, currentId],
  );

  // --- Accept a side for the current conflict, then auto-advance ----------
  const acceptCurrent = React.useCallback(
    (res: "ours" | "theirs" | "both") => {
      if (currentId == null) return;
      // Re-accepting an already-resolved region overwrites it (Rider behavior).
      bodyRef.current?.accept(currentId, res);
      // accept() dispatched synchronously into CM, so regions() is current.
      const regs = bodyRef.current?.regions() ?? [];
      const ids = regs.map((r) => r.id).sort((a, b) => a - b);
      const byId = new Map(regs.map((r) => [r.id, r]));
      const curIdx = ids.indexOf(currentId);
      for (let step = 1; step <= ids.length; step++) {
        const idx = (curIdx + step) % ids.length;
        if (byId.get(ids[idx])!.resolution === null) {
          setCurrentId(ids[idx]);
          bodyRef.current?.reveal(ids[idx]);
          break;
        }
      }
    },
    [currentId],
  );

  // --- Apply: save the resolved result + advance to next file -------------
  const applyFile = React.useCallback(async () => {
    if (!canApply) return;
    const body = bodyRef.current;
    if (!body) return;
    let text = body.resultText(); // CM doc is LF-separated (it stripped any \r)
    // Reattach the file's original eol so a CRLF file round-trips unchanged.
    if (model?.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
    if (model?.trailingNewline && text !== "" && !text.endsWith("\n")) text += model.eol;
    try {
      setApplyError(null);
      await saveResolution(repoId, path, text);
      await advance();
    } catch (e) {
      console.error("save resolution failed", e);
      // A rejected Tauri command is a plain `{ kind, message }` object, NOT an
      // Error, so the `instanceof` test always failed and this banner read
      // "[object Object]" for every failed apply (#146).
      setApplyError(appErrorMessage(e));
    }
  }, [canApply, model, repoId, path, advance]);

  // --- Unapplied progress: side picks, or edits to the result pane ---------
  const hasUnappliedProgress = React.useCallback(() => {
    const body = bodyRef.current;
    const regs = body?.regions() ?? regionStates;
    const editorText = body?.resultText();
    return (
      regs.some((r) => r.resolution !== null) ||
      (editorText != null && model != null && editorText !== model.initialResult)
    );
  }, [regionStates, model]);

  const confirmDiscard = () =>
    pgConfirm({
      title: "Discard this file's merge progress?",
      body: "Side picks and edits to the result pane are lost; the file stays conflicted.",
      danger: true,
      confirmLabel: "Discard",
    });

  // --- Close (confirm when this file has unsaved progress) ----------------
  const requestClose = React.useCallback(() => {
    if (!hasUnappliedProgress()) {
      void getCurrentWindow().close();
      return;
    }
    void (async () => {
      if (await confirmDiscard()) void getCurrentWindow().close();
    })();
  }, [hasUnappliedProgress]);

  // --- Switch files from the sidebar, or from a retarget event -------------
  // Same gate as closing: leaving a file mid-resolution loses the same work.
  const requestSwitchTo = React.useCallback(
    (p: string) => {
      if (!p || p === path) return;
      if (!hasUnappliedProgress()) {
        setPath(p);
        return;
      }
      void (async () => {
        if (await confirmDiscard()) setPath(p);
      })();
    },
    [path, hasUnappliedProgress],
  );

  // The main window can retarget an already-open resolver. A named file goes
  // through the same discard gate the sidebar uses — this used to switch
  // silently and drop unapplied work. A null path means "the user asked for the
  // resolver, not for a file": keep their place and just refresh the list.
  const switchRef = React.useRef(requestSwitchTo);
  switchRef.current = requestSwitchTo;
  React.useEffect(() => {
    const un = listen<{ repoId: string; path: string | null }>(
      "merge://open-file",
      (e) => {
        setRepoId(e.payload.repoId);
        if (e.payload.path) switchRef.current(e.payload.path);
        else setReloadKey((k) => k + 1);
      },
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Say which repository this window is on, whenever it changes (#256).
  //
  // Every repository window needs the answer, and only this window has it: the
  // `repoId` lives in this window's URL and no other webview can read it back.
  // Before multiple windows existed, the one window that could open a resolver
  // was also the one that had to guard against evicting its repository, so it
  // could just remember what it had asked for. Now the resolver may have been
  // opened by a window that is not the one closing a tab — and since each
  // window opens its OWN `RepoId` for a repository, closing a tab in a
  // different window cannot hurt this one. Broadcasting the id is what lets the
  // guard tell those two cases apart instead of confirming in both.
  React.useEffect(() => {
    if (!repoId) return;
    void emit("merge://holding", { repoId });
  }, [repoId]);

  // --- Chord table: window-level keydown, capture phase (beats CM keymap) --
  // Rebuilt each render so the listener always sees latest closures.
  const actions = React.useRef<Record<string, () => void>>({});
  actions.current = {
    F7: () => moveConflict(1),
    "Shift+F7": () => moveConflict(-1),
    "Mod+1": () => acceptCurrent("ours"),
    "Mod+2": () => acceptCurrent("theirs"),
    "Mod+3": () => acceptCurrent("both"),
    "Mod+Enter": () => void applyFile(),
    "Mod+W": () => void requestClose(),
    Escape: () => void requestClose(),
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const chord = eventToChord(e);
      const fn = chord ? actions.current[chord] : undefined;
      if (fn) {
        e.preventDefault();
        e.stopPropagation();
        fn();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      data-testid="merge-window"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-0)",
        color: "var(--fg-0)",
      }}
    >
      {/* Own host: this is a separate Tauri window, so it cannot share the
          main window's. */}
      <PGDialogHost />
      <div
        style={{
          padding: "10px 14px",
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border-0)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <PGIcon name="merge" size={16} />
        <span
          data-testid="merge-file-path"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)", flex: 1 }}
        >
          {path}
        </span>
        {/* Withheld until the first list fetch lands — an unqualified "0 files
            remaining" on mount would be a wrong statement, not a loading one. */}
        {files.length > 0 && (
          <span
            data-testid="merge-remaining"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
          >
            {remaining} file{remaining !== 1 ? "s" : ""} remaining
          </span>
        )}
      </div>

      <div ref={layout.ref} style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {files.length > 0 && (
          <>
            <MergeFileList
              files={files}
              current={path}
              repoId={repoId}
              width={listPane.size}
              onSelect={requestSwitchTo}
              onResolved={(p) => void onFileResolved(p)}
              onChanged={(p) => void onFileChanged(p)}
            />
            <PGResizeHandle onDrag={listPane.resize} onReset={listPane.reset} />
          </>
        )}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PGSpinner size={18} />
            </div>
          ) : chooser ? (
            <ChooserPanel
              sides={sides!}
              repoId={repoId}
              path={path}
              onResolved={advance}
              onError={setApplyError}
            />
          ) : model ? (
            <MergeBody
              key={path}
              ref={bodyRef}
              model={model}
              currentConflict={currentId}
              onRegionsChange={setRegionStates}
              // #104 PR2: the panes highlight by the file's extension.
              path={path}
            />
          ) : (
            <PGEmpty icon="conflict" title="Nothing to resolve">
              {path
                ? "This file has no conflict entry (it may already be resolved)."
                : "No conflicted files left in this repository."}
            </PGEmpty>
          )}
        </div>
      </div>

      {applyError && (
        <div
          role="alert"
          style={{
            padding: "6px 14px",
            fontSize: "var(--fs-12)",
            fontFamily: "var(--font-mono)",
            color: "var(--git-removed)",
            background: "oklch(0.68 0.18 25 / 0.1)",
            borderTop: "1px solid oklch(0.68 0.18 25 / 0.35)",
          }}
        >
          {applyError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border-0)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
          }}
        >
          <ShortcutHint chord="F7" label="Next" />
          <ShortcutHint chord="Mod+1" label="Ours" />
          <ShortcutHint chord="Mod+2" label="Theirs" />
          <ShortcutHint chord="Mod+3" label="Both" />
          <ShortcutHint chord="Mod+Enter" label="Apply" />
        </div>
        <span
          data-testid="merge-conflict-counter"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
        >
          {resolvedCount}/{total} resolved
        </span>
        <PGButton size="sm" variant="ghost" data-testid="merge-close" onClick={requestClose}>
          Close
        </PGButton>
        <PGButton
          size="sm"
          variant="primary"
          icon="check"
          data-testid="merge-apply"
          disabled={!canApply}
          onClick={() => void applyFile()}
        >
          Apply
        </PGButton>
      </div>
    </div>
  );
}

function ShortcutHint({ chord, label }: { chord: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <kbd
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          padding: "1px 5px",
          borderRadius: 4,
          background: "var(--bg-3)",
          border: "1px solid var(--border-1)",
          color: "var(--fg-2)",
        }}
      >
        {formatChord(chord)}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

// Binary or deleted-on-one-side conflicts: no 3-pane editor, just a choice.
function ChooserPanel({
  sides,
  repoId,
  path,
  onResolved,
  onError,
}: {
  sides: ConflictSides;
  repoId: string;
  path: string;
  onResolved: () => Promise<void>;
  /** Surface a failure in the window's shared banner; `null` clears it. */
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const oursLabel = sides.binary
    ? "Take ours"
    : sides.ours == null
      ? "Resolve as deleted (ours)"
      : "Keep our version";
  const theirsLabel = sides.binary
    ? "Take theirs"
    : sides.theirs == null
      ? "Resolve as deleted (theirs)"
      : "Keep their version";
  const pick = async (side: "ours" | "theirs") => {
    setBusy(true);
    try {
      onError(null);
      if (side === "ours") await acceptOursIpc(repoId, path);
      else await acceptTheirsIpc(repoId, path);
      await onResolved();
    } catch (e) {
      // These two buttons are the ONLY way to resolve a binary or deleted-side
      // conflict, so a console-only failure looks exactly like a dead button.
      // Same banner Apply uses, and `appErrorMessage` for the same reason: a
      // rejected command is a plain `{ kind, message }`, never an Error (#146).
      console.error("chooser resolution failed", e);
      onError(appErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="merge-chooser"
      style={{
        flex: 1,
        minHeight: 0,
        // The previews below can be taller than the pane; the buttons must stay
        // reachable rather than being pushed off the bottom.
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: "var(--fg-2)",
      }}
    >
      {/* Where a preview is worth the most (#224): the chooser is otherwise two
          buttons and no way to tell which side is which. `ours` and `theirs` are
          index stages 2 and 3 — neither is in any tree while the merge is
          unresolved, so nothing else can name them. Falls back to the icon this
          panel always showed when the conflict is not over an image. */}
      <div style={{ alignSelf: "stretch", minWidth: 0, maxWidth: 900, margin: "0 auto" }}>
        <ImageDiffView
          repoId={repoId}
          path={sides.binary ? path : null}
          sides={[
            {
              key: "ours",
              label: "Ours (current)",
              tone: "neutral",
              source: { kind: "stage", stage: 2 },
            },
            {
              key: "theirs",
              label: "Theirs (incoming)",
              tone: "neutral",
              source: { kind: "stage", stage: 3 },
            },
          ]}
          fallback={
            <div style={{ display: "flex", justifyContent: "center" }}>
              <PGIcon name="file" size={32} />
            </div>
          }
        />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-13)" }}>
        {sides.binary
          ? "Binary file — pick a side"
          : "File deleted on one side — pick an outcome"}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PGButton size="sm" variant="outline" icon="chevronLeft" disabled={busy}
          data-testid="chooser-take-ours" onClick={() => pick("ours")}>
          {oursLabel}
        </PGButton>
        <PGButton size="sm" variant="outline" icon="chevronRight" disabled={busy}
          data-testid="chooser-take-theirs" onClick={() => pick("theirs")}>
          {theirsLabel}
        </PGButton>
      </div>
    </div>
  );
}
