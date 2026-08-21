/**
 * What a select-all-and-copy over `root` would put on the clipboard.
 *
 * jsdom applies no stylesheet and implements no selection, so a test cannot ask
 * it what a drag would pick up. This walks the tree the way the engine does
 * instead: a text node counts unless something between it and `root` switches
 * selection off.
 *
 * Deliberately models INLINE `user-select` only. That is what the diff rows use
 * for their gutters (`git-components.tsx`), and it keeps the helper honest about
 * its own limits: a rule that lives in a stylesheet is invisible here, so the
 * class that GRANTS selection (`.pg-selectable`) is asserted separately, and the
 * end-to-end proof lives in the e2e suite against a real WebKit.
 */
export function selectionText(root: Element): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if ((node as HTMLElement).style?.userSelect === "none") return;
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return out;
}
