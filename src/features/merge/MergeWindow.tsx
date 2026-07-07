// MergeWindow — root component of the `merge` Tauri window (see main.tsx).
// Owns: which file is open, sides fetching, chooser fallback for
// binary/deleted conflicts, current-conflict selection, auto-advance. The
// 3-pane editor body renders in <MergeBody>; region states + body ref are
// held here for Task 6 (chords, footer, Apply).

import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { PGButton, PGEmpty, PGIcon, PGSpinner } from "@/design";
import {
  acceptOurs as acceptOursIpc,
  acceptTheirs as acceptTheirsIpc,
  conflictSides,
  getStatus,
  saveResolution,
} from "@/lib/tauri";
import type { ConflictSides, FileStatus } from "@/lib/types";
import { eventToChord, formatChord } from "@/features/keymap/chord";
import { buildMergeModel } from "./mergeModel";
import { MergeBody, type MergeBodyHandle } from "./MergeBody";
import type { RegionState } from "./resultEditor";

function isConflicted(s: FileStatus): boolean {
  return s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted";
}

export function findNextConflict(status: FileStatus[], current: string): string | null {
  const next = status.find((s) => isConflicted(s) && s.path !== current);
  return next ? next.path : null;
}

export function MergeWindow() {
  const params = new URLSearchParams(window.location.search);
  const [repoId, setRepoId] = React.useState(params.get("repoId") ?? "");
  const [path, setPath] = React.useState(params.get("path") ?? "");
  const [sides, setSides] = React.useState<ConflictSides | null>(null);
  const [remaining, setRemaining] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

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

  // Load sides + remaining count whenever the target file changes.
  React.useEffect(() => {
    if (!repoId || !path) return;
    let stale = false;
    setLoading(true);
    setSides(null);
    Promise.all([conflictSides(repoId, path), getStatus(repoId)])
      .then(([s, status]) => {
        if (stale) return;
        setSides(s);
        setRemaining(status.filter(isConflicted).length);
      })
      .catch((e) => console.error("merge window load failed", e))
      .finally(() => !stale && setLoading(false));
    void getCurrentWindow().setTitle(`Resolve: ${path}`);
    return () => {
      stale = true;
    };
  }, [repoId, path]);

  // Main window can retarget an already-open resolver (user launches a
  // different conflicted file while this window is open).
  // Known limitation: a retarget switches files without a dirty-progress
  // confirm — unapplied in-editor resolutions for the current file are
  // dropped (the normal flow applies + auto-advances, so this only bites a
  // manual mid-resolution re-launch). Revisit with a confirm if it bites.
  React.useEffect(() => {
    const un = listen<{ repoId: string; path: string }>("merge://open-file", (e) => {
      setRepoId(e.payload.repoId);
      setPath(e.payload.path);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  /** After a file is resolved: notify main, load next conflict or close. */
  const advance = React.useCallback(async () => {
    await emit("merge://resolved", { repoId, path });
    const status = await getStatus(repoId);
    const next = findNextConflict(status, path);
    if (next) setPath(next);
    else await getCurrentWindow().close();
  }, [repoId, path]);

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
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }, [canApply, model, repoId, path, advance]);

  // --- Close (confirm when this file has unsaved progress) ----------------
  const requestClose = React.useCallback(() => {
    const body = bodyRef.current;
    const regs = body?.regions() ?? regionStates;
    const editorText = body?.resultText();
    const touched =
      regs.some((r) => r.resolution !== null) ||
      (editorText != null && model != null && editorText !== model.initialResult);
    if (!touched || window.confirm("Discard this file's merge progress?")) {
      void getCurrentWindow().close();
    }
  }, [regionStates, model]);

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
        <span
          data-testid="merge-remaining"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
        >
          {remaining} file{remaining !== 1 ? "s" : ""} remaining
        </span>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PGSpinner size={18} />
        </div>
      ) : chooser ? (
        <ChooserPanel sides={sides!} repoId={repoId} path={path} onResolved={advance} />
      ) : model ? (
        <MergeBody
          key={path}
          ref={bodyRef}
          model={model}
          currentConflict={currentId}
          onRegionsChange={setRegionStates}
        />
      ) : (
        <PGEmpty icon="conflict" title="Nothing to resolve">
          This file has no conflict entry (it may already be resolved).
        </PGEmpty>
      )}

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
}: {
  sides: ConflictSides;
  repoId: string;
  path: string;
  onResolved: () => Promise<void>;
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
      if (side === "ours") await acceptOursIpc(repoId, path);
      else await acceptTheirsIpc(repoId, path);
      await onResolved();
    } catch (e) {
      console.error("chooser resolution failed", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="merge-chooser"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: "var(--fg-2)",
      }}
    >
      <PGIcon name="file" size={32} />
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
