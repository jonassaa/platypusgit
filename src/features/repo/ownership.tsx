import { pgConfirm } from "@/design";
import { DUBIOUS_OWNERSHIP_HELP } from "@/lib/errors";

/**
 * Ask before writing a `safe.directory` exception for `path`.
 *
 * Kept out of the store on purpose: the store's tests can then decide the
 * answer without mounting a dialog host, and the copy sits beside the help
 * text rather than inside a state machine.
 */
export async function confirmTrust(path: string): Promise<boolean> {
  return pgConfirm({
    title: "Trust this repository?",
    body: (
      <>
        <div className="mono break-all">{path}</div>
        <p className="mt-2">{DUBIOUS_OWNERSHIP_HELP}</p>
      </>
    ),
    confirmLabel: "Trust and open",
  });
}
