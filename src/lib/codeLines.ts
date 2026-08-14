/**
 * Split file text into display lines.
 *
 * A plain `text.split("\n")` gets two cases wrong, and both were visible in the
 * file preview: empty text yields `[""]` rather than no lines, so the "Empty
 * file" state never shows; and a file ending in a newline yields a trailing `""`
 * that renders as a phantom last line. The highlight.js path this replaced
 * handled both while re-splitting its HTML, so the rule lives here now instead of
 * being a side effect of highlighting.
 *
 * `splitLines` in features/merge/mergeModel.ts applies the same rule plus a CR
 * strip; that one belongs to the merge model's LF-space contract and stays there.
 */
export function splitCodeLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
