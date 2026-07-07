// resultEditor — CodeMirror 6 editor for the merge resolver's middle "result"
// pane. Each conflict region is tracked as editable text plus a resolution
// status; accept() replaces a region and marks it resolved, hand-edits inside
// an unresolved region mark it "manual", and CM6 undo restores both text and
// status (the region field special-cases history transactions).

import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  resolutionLines,
  type ChunkResolution,
  type ConflictRegion,
  type MergeModel,
} from "./mergeModel";

export interface RegionState {
  id: number;
  from: number;
  to: number;
  resolution: ChunkResolution | null;
}

export interface EditorHandle {
  view: EditorView;
  /** Replace region text with the side's lines and mark it resolved. */
  accept(id: number, res: "ours" | "theirs" | "both"): void;
  /** Current region states (position-mapped). */
  regions(): RegionState[];
  /** Scroll region into view + move cursor to its start. */
  reveal(id: number): void;
  destroy(): void;
}

// Set on accept transactions so the field knows the doc change is programmatic
// (an accept), not a user hand-edit that should mark the region "manual".
const programmaticAccept = Annotation.define<boolean>();

// Carries explicit new offsets so a region survives its own replacement text
// (position mapping alone would collapse a shrinking/growing region).
const setRegionEffect = StateEffect.define<{
  id: number;
  resolution: ChunkResolution;
  from: number;
  to: number;
}>();

const regionsField = StateField.define<RegionState[]>({
  create: () => [],
  update(regions, tr) {
    if (!tr.docChanged && !hasSetRegionEffect(tr)) {
      return regions;
    }
    const isAccept = tr.annotation(programmaticAccept) === true;
    const userEvent = tr.annotation(Transaction.userEvent);
    let next = regions.map((r) => {
      // Overlap test against PRE-map offsets.
      let touched = false;
      if (tr.docChanged) {
        tr.changes.iterChangedRanges((fromA, toA) => {
          if (fromA <= r.to && toA >= r.from) touched = true;
        });
      }
      const from = tr.changes.mapPos(r.from, 1);
      const to = Math.max(from, tr.changes.mapPos(r.to, -1));
      let resolution = r.resolution;
      if (touched && !isAccept) {
        // Undo of an accept clears the region back to unresolved; a hand-edit
        // (or redo) on an unresolved region marks it manually resolved.
        if (userEvent === "undo") resolution = null;
        else if (r.resolution === null) resolution = "manual";
      }
      return { ...r, from, to, resolution };
    });
    for (const e of tr.effects) {
      if (e.is(setRegionEffect)) {
        next = next.map((r) =>
          r.id === e.value.id
            ? {
                ...r,
                from: e.value.from,
                to: e.value.to,
                resolution: e.value.resolution,
              }
            : r,
        );
      }
    }
    return next;
  },
});

class UnresolvedMarker extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "merge-empty-marker";
    span.textContent = "◆ unresolved conflict";
    return span;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const regions = state.field(regionsField);
  const ranges = regions.map((r) => {
    if (r.from === r.to) {
      // Zero-length placeholder (e.g. both-added conflict): mark with a widget.
      return Decoration.widget({ widget: new UnresolvedMarker(), side: 1 }).range(
        r.from,
      );
    }
    const cls = r.resolution === null ? "merge-unresolved" : "merge-resolved";
    return Decoration.mark({ class: cls }).range(r.from, r.to);
  });
  return Decoration.set(ranges, true);
}

const theme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-12)",
    height: "100%",
  },
  ".merge-unresolved": { backgroundColor: "oklch(0.72 0.15 325 / 0.14)" },
  ".merge-resolved": { backgroundColor: "oklch(0.72 0.15 155 / 0.08)" },
});

function hasSetRegionEffect(tr: Transaction): boolean {
  return tr.effects.some((e) => e.is(setRegionEffect));
}

export function createResultEditor(opts: {
  model: MergeModel;
  parent: HTMLElement;
  onChange: (regions: RegionState[]) => void;
}): EditorHandle {
  const { model, parent, onChange } = opts;
  const conflictById = new Map<number, ConflictRegion>(
    model.conflicts.map((c) => [c.id, c]),
  );

  const state = EditorState.create({
    doc: model.initialResult,
    extensions: [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      regionsField.init(() =>
        model.resultRegions.map((r) => ({ ...r, resolution: null })),
      ),
      EditorView.decorations.compute([regionsField], buildDecorations),
      EditorView.updateListener.of((update) => {
        if (
          update.docChanged ||
          update.transactions.some(hasSetRegionEffect)
        ) {
          onChange(update.state.field(regionsField));
        }
      }),
      theme,
    ],
  });

  const view = new EditorView({ state, parent });

  const regions = () => view.state.field(regionsField);

  function accept(id: number, res: "ours" | "theirs" | "both"): void {
    const conflict = conflictById.get(id);
    if (!conflict) return;
    const region = regions().find((r) => r.id === id);
    if (!region) return;
    const { from, to } = region;
    const content = resolutionLines(conflict, res).join("\n");
    let prefix = "";
    let suffix = "";
    if (from === to) {
      // Inserting into an empty placeholder: pad with separators so the
      // inserted lines don't fuse with the surrounding text.
      const doc = view.state.doc;
      prefix = from > 0 && doc.sliceString(from - 1, from) !== "\n" ? "\n" : "";
      suffix = to < doc.length && doc.sliceString(to, to + 1) !== "\n" ? "\n" : "";
    }
    const insert = prefix + content + suffix;
    // Track only the CONTENT span, excluding any padding separators — so a
    // re-accept (from !== to now) replaces just the content and leaves the
    // separator newlines intact instead of deleting them and fusing lines.
    const contentFrom = from + prefix.length;
    view.dispatch({
      changes: { from, to, insert },
      effects: setRegionEffect.of({
        id,
        resolution: res,
        from: contentFrom,
        to: contentFrom + content.length,
      }),
      annotations: programmaticAccept.of(true),
    });
  }

  function reveal(id: number): void {
    const region = regions().find((r) => r.id === id);
    if (!region) return;
    view.dispatch({
      selection: { anchor: region.from },
      effects: EditorView.scrollIntoView(region.from, { y: "center" }),
    });
  }

  function destroy(): void {
    view.destroy();
  }

  return { view, accept, regions, reveal, destroy };
}
