import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { pgFlash } from "@/design";
import { formatPatch } from "@/lib/tauri";
import { toAppError } from "@/lib/errors";
import { useRepoStore } from "@/features/repo/useRepoStore";

/**
 * Export commits as mailbox-format patch files into a directory the user picks.
 *
 * `oids` must be OLDEST-FIRST: the backend numbers the series in the order it
 * is given, so a reversed list produces `0001` for the newest commit and a
 * series that replays backwards.
 *
 * Lives here rather than in the menu for the usual reason — `src/design/`
 * imports no `@/lib/tauri`.
 *
 * The DIRECTORY picker, not a save-file picker: `format-patch` names its own
 * files (`0001-subject.patch`), and one commit can become several files, so
 * there is no single filename to offer. That also means no new Tauri
 * permission — `dialog:allow-open` is already granted and is the same call
 * Clone / Init / Worktree already make.
 */
export async function createPatch(oids: string[]): Promise<void> {
  const repo = useRepoStore.getState().current;
  if (!repo || oids.length === 0) return;

  const picked = await openDialog({
    directory: true,
    multiple: false,
    title: oids.length === 1 ? "Save patch to" : `Save ${oids.length} patches to`,
  });
  // A dismissed picker is "no answer", never a choice — the same contract the
  // pg* dialogs keep.
  if (typeof picked !== "string") return;

  try {
    const written = await formatPatch(repo.id, oids, picked);
    pgFlash(
      written.length === 1
        ? `wrote ${fileName(written[0])}`
        : `wrote ${written.length} patches to ${picked}`,
    );
  } catch (e) {
    // A refusal here is worth a banner rather than a flash: the user asked for
    // files and got none, and the reason (a merge in the selection, an
    // unwritable directory) is something they act on.
    useRepoStore.getState().setError(toAppError(e));
  }
}

/** Last path segment, for a message that names the file rather than its path. */
function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
