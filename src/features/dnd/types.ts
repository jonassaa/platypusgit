/**
 * What a drag carries. A discriminated union so a zone's `accepts` doubles as a
 * type guard and a screen can never mistake one surface's payload for another's.
 */

/**
 * Files being moved across the staging boundary.
 *
 * `paths` is ALREADY the actionable bucket for `side`: the source screen builds
 * it with `splitFileSelection` (`lib/selection.ts`) and its own
 * `FileSelectionSource` — the same call the checkbox path makes — so a directory
 * row is expanded to its files and an embedded repo is excluded before the drag
 * starts. Nothing downstream re-derives it, which is what keeps drag and
 * checkbox from drifting.
 */
export interface FilesPayload {
  kind: "files";
  side: "staged" | "unstaged";
  paths: string[];
  label: string;
}

/**
 * A ref pill. `ref` is the name git knows (`main`, `origin/main`), never the
 * display string `mapCommitRefs` produces for HEAD (`HEAD→main`).
 */
export interface RefPayload {
  kind: "ref";
  ref: string;
  isHead: boolean;
  label: string;
}

export interface CommitPayload {
  kind: "commit";
  oid: string;
  label: string;
}

export type DragPayload = FilesPayload | RefPayload | CommitPayload;

/**
 * What the element under the pointer resolved to inside a delegated zone.
 * `el` is the element to mark with `data-pg-drop-over`; `key` is handed back to
 * `onDrop`. `reason` makes the resolution a *rejection*: it is shown on the
 * ghost and the drop does nothing.
 */
export interface DropResolution {
  key: string;
  el: HTMLElement;
  reason?: string;
}
