import React from "react";
import { readFileContent, readFileContentAtRev } from "@/lib/tauri";
import { useSyntax } from "./useSyntax";
import type { SyntaxLine } from "./tokenize";

/**
 * Where one side of a diff gets its text.
 *
 * Spelled out rather than overloading `null`, which would have to mean "the
 * worktree" on the new side and "there is no such side" on the old one — the same
 * sentinel with two meanings is how call sites get it wrong.
 */
export type SideSource =
  | { kind: "rev"; rev: string; path?: string | null }
  | { kind: "worktree" }
  | { kind: "none" };

export interface DiffSyntax {
  old: SyntaxLine[] | null;
  new: SyntaxLine[] | null;
}

/** No tokens for either side. Stable identity, so it is safe in a render path. */
const EMPTY: DiffSyntax = { old: null, new: null };

/**
 * Tokens for both sides of a file diff.
 *
 * Whole-file text per side, not hunk text: a hunk is a window into a file, and a
 * block comment or template literal opening above it would mis-colour every line
 * below.
 *
 * A `rev` source may carry its own `path`, which is what covers renames — HEAD has
 * no blob at the new path, so reading it there would leave every removed line
 * unhighlighted.
 *
 * A failed read yields no tokens for that side and those rows render plain: a
 * missing blob must never break a diff.
 *
 * Panes that diff against the INDEX (the commit panel) cannot ask for it — there
 * is no read_file_content_at_index — so they pass HEAD and the worktree. Those
 * agree with the index except on a partially staged file, where being off
 * mis-colours a line. It cannot affect what gets staged, because staging addresses
 * lines by changedIndex, never by these tokens.
 */
export function useDiffSyntax(o: {
  repoId: string | null;
  path: string | null;
  old: SideSource;
  new: SideSource;
}): DiffSyntax {
  const { repoId, path } = o;
  // Deps are primitives: the caller builds these objects inline every render, so
  // depending on their identity would refetch both files on every render.
  const oldKind = o.old.kind;
  const oldRev = o.old.kind === "rev" ? o.old.rev : null;
  const oldPath = (o.old.kind === "rev" ? o.old.path : null) ?? path;
  const newKind = o.new.kind;
  const newRev = o.new.kind === "rev" ? o.new.rev : null;

  const [texts, setTexts] = React.useState<{ old: string | null; new: string | null }>({
    old: null,
    new: null,
  });

  React.useEffect(() => {
    setTexts({ old: null, new: null });
    if (!repoId || !path) return;
    let cancelled = false;
    const read = (kind: SideSource["kind"], rev: string | null, p: string | null) => {
      if (kind === "none" || !p) return Promise.resolve(null);
      if (kind === "worktree") return readFileContent(repoId, p).catch(() => null);
      return rev ? readFileContentAtRev(repoId, rev, p).catch(() => null) : Promise.resolve(null);
    };
    Promise.all([read(oldKind, oldRev, oldPath), read(newKind, newRev, path)]).then(
      ([o2, n]) => {
        if (!cancelled) setTexts({ old: o2?.text ?? null, new: n?.text ?? null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repoId, path, oldKind, oldRev, oldPath, newKind, newRev]);

  const oldLines = useSyntax(path, texts.old);
  const newLines = useSyntax(path, texts.new);
  return React.useMemo(() => ({ old: oldLines, new: newLines }), [oldLines, newLines]);
}

export { EMPTY as EMPTY_DIFF_SYNTAX };
