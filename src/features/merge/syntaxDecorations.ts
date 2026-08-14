// Syntax highlighting for the editable result pane.
//
// The region decorations next door use EditorView.decorations.compute, which is
// synchronous. Tokenizing is not, so tokens arrive as a StateEffect into a field
// that maps its ranges through document changes — colours therefore shift with
// edits instead of smearing while the debounce is pending.
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { tokenizeFile, type SyntaxLine } from "@/lib/syntax";

/** Re-tokenizing on every keystroke is wasted work; one idle beat is enough. */
const DEBOUNCE_MS = 120;

const setSyntaxEffect = StateEffect.define<DecorationSet>();

export function buildSyntaxDecorations(
  state: EditorState,
  lines: SyntaxLine[],
): DecorationSet {
  const ranges = [];
  const total = state.doc.lines;
  for (let i = 0; i < lines.length && i < total; i++) {
    const line = state.doc.line(i + 1);
    for (const t of lines[i]) {
      const from = line.from + t.start;
      // Clamp to the line's own end: a token overrunning it would otherwise
      // bleed into the next line, and CodeMirror rejects zero-width marks.
      const to = Math.min(line.from + t.end, line.to);
      if (to <= from) continue;
      ranges.push(Decoration.mark({ class: t.cls }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
}

const syntaxField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = tr.docChanged ? deco.map(tr.changes) : deco;
    for (const e of tr.effects) if (e.is(setSyntaxEffect)) next = e.value;
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Highlight the result document, re-tokenizing on a debounce after each change.
 * A path whose language is unknown simply never produces decorations.
 */
export function syntaxHighlighting(path: string): Extension {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = (view: EditorView) => {
    const text = view.state.doc.toString();
    void tokenizeFile(path, text).then((lines) => {
      // Bail if the document moved on while tokenizing: the pending debounce
      // covers the newer text, and applying stale ranges would mis-colour it.
      if (!lines || view.state.doc.toString() !== text) return;
      view.dispatch({
        effects: setSyntaxEffect.of(buildSyntaxDecorations(view.state, lines)),
      });
    });
  };

  return [
    syntaxField,
    EditorView.updateListener.of((update) => {
      // viewportChanged catches the first measurement after mount, where there
      // is no document change to react to but the pane still needs colouring.
      if (!update.docChanged && !update.viewportChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh(update.view);
      }, DEBOUNCE_MS);
    }),
  ];
}
