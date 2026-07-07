// MergeBody — the visible 3-pane merge body: read-only OURS pane | editable
// RESULT (CodeMirror) | read-only THEIRS pane. Owns editor lifecycle (mount /
// destroy keyed on model identity) and cross-pane scroll sync. Selection
// (currentConflict) is owned by MergeWindow and passed in; accept/reveal are
// exposed imperatively for Task 6's keyboard + Apply layer.

import React from "react";
import { SidePane } from "./SidePane";
import { createResultEditor, type EditorHandle, type RegionState } from "./resultEditor";
import type { MergeModel } from "./mergeModel";

export interface MergeBodyHandle {
  accept(id: number, res: "ours" | "theirs" | "both"): void;
  reveal(id: number): void;
  /** Editor text + regions for Apply (Task 6). */
  resultText(): string;
  regions(): RegionState[];
}

export const MergeBody = React.forwardRef<
  MergeBodyHandle,
  {
    model: MergeModel;
    // Owned by MergeWindow; optional so tests can render without a selection.
    currentConflict?: number | null;
    onRegionsChange: (r: RegionState[]) => void;
  }
>(function MergeBody({ model, currentConflict = null, onRegionsChange }, ref) {
  const editorHost = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<EditorHandle | null>(null);
  const [regionStates, setRegionStates] = React.useState<RegionState[]>([]);
  const oursScroll = React.useRef<HTMLDivElement>(null);
  const theirsScroll = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!editorHost.current) return;
    const handle = createResultEditor({
      model,
      parent: editorHost.current,
      onChange: (r) => {
        setRegionStates(r);
        onRegionsChange(r);
      },
    });
    editor.current = handle;
    setRegionStates(handle.regions());
    onRegionsChange(handle.regions());
    return () => {
      handle.destroy();
      editor.current = null;
    };
    // model identity changes only when the file changes — full remount wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const accept = React.useCallback((id: number, res: "ours" | "theirs" | "both") => {
    editor.current?.accept(id, res);
  }, []);

  React.useImperativeHandle(ref, () => ({
    accept,
    reveal: (id) => editor.current?.reveal(id),
    resultText: () => editor.current?.view.state.doc.toString() ?? "",
    regions: () => editor.current?.regions() ?? [],
  }));

  // Scroll sync: piecewise-linear interpolation between conflict anchors.
  const syncing = React.useRef(false);
  const syncFrom = React.useCallback(
    (source: "ours" | "result" | "theirs") => {
      if (syncing.current) return;
      const view = editor.current?.view;
      if (!view) return;
      const firstRow = oursScroll.current?.querySelector("[data-line]");
      const lineH = firstRow?.getBoundingClientRect().height ?? 0;
      if (lineH <= 0) return; // jsdom / not laid out yet — nothing to sync
      const regions = editor.current!.regions();
      const resultLineOf = (from: number) => view.state.doc.lineAt(from).number - 1;
      // Anchor rows per pane: [0, …conflict starts…, lineCount] so interpolation
      // covers the whole document.
      const anchors = {
        ours: [0, ...model.conflicts.map((c) => c.ours.start), model.oursLines.length],
        theirs: [0, ...model.conflicts.map((c) => c.theirs.start), model.theirsLines.length],
        result: [0, ...regions.map((r) => resultLineOf(r.from)), view.state.doc.lines],
      };
      const tops = {
        ours: oursScroll.current?.scrollTop ?? 0,
        theirs: theirsScroll.current?.scrollTop ?? 0,
        result: view.scrollDOM.scrollTop,
      };
      const srcLine = tops[source] / lineH;
      const src = anchors[source];
      // Find surrounding anchor segment in the source pane.
      let seg = 0;
      while (seg < src.length - 2 && src[seg + 1] <= srcLine) seg++;
      const span = Math.max(1, src[seg + 1] - src[seg]);
      const frac = (srcLine - src[seg]) / span;
      const project = (target: number[]) =>
        (target[seg] + frac * Math.max(1, target[seg + 1] - target[seg])) * lineH;
      syncing.current = true;
      try {
        if (source !== "ours" && oursScroll.current)
          oursScroll.current.scrollTop = project(anchors.ours);
        if (source !== "theirs" && theirsScroll.current)
          theirsScroll.current.scrollTop = project(anchors.theirs);
        if (source !== "result") view.scrollDOM.scrollTop = project(anchors.result);
      } finally {
        // Release after the scroll events we just caused have fired.
        requestAnimationFrame(() => {
          syncing.current = false;
        });
      }
    },
    [model],
  );

  // Result-pane scroll listener (side panes wire onScroll via props below).
  React.useEffect(() => {
    const dom = editor.current?.view.scrollDOM;
    if (!dom) return;
    const onScroll = () => syncFrom("result");
    dom.addEventListener("scroll", onScroll);
    return () => dom.removeEventListener("scroll", onScroll);
    // editor.current is set by the model effect above; re-run with it.
  }, [model, syncFrom]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <SidePane
        side="ours"
        lines={model.oursLines}
        conflicts={model.conflicts}
        regionStates={regionStates}
        currentConflict={currentConflict ?? null}
        onAccept={(id) => accept(id, "ours")}
        scrollRef={oursScroll}
        onScroll={() => syncFrom("ours")}
      />
      <div style={{ width: 1, background: "var(--border-0)" }} />
      <div
        ref={editorHost}
        data-testid="merge-result"
        style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
      />
      <div style={{ width: 1, background: "var(--border-0)" }} />
      <SidePane
        side="theirs"
        lines={model.theirsLines}
        conflicts={model.conflicts}
        regionStates={regionStates}
        currentConflict={currentConflict ?? null}
        onAccept={(id) => accept(id, "theirs")}
        scrollRef={theirsScroll}
        onScroll={() => syncFrom("theirs")}
      />
    </div>
  );
});
