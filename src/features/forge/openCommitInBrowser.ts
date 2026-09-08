import { pgFlash } from "@/design";
import { forgeCommitUrl, openUrl } from "@/lib/tauri";
import { useForgeStore } from "./useForgeStore";
import { useRepoStore } from "@/features/repo/useRepoStore";

/**
 * Open one commit's page on the forge.
 *
 * Lives here rather than in the menu because `src/design/` imports no
 * `@/lib/tauri` — the same boundary that makes `PGErrorBanner` take an
 * `onReport` callback.
 *
 * **The entry is always enabled, and the answer arrives on click.** Whether a
 * page exists is a backend question (which remote, which host, is that host a
 * known forge), and building a menu must stay synchronous. Gating on
 * `useForgeStore`'s cached `detection` was the alternative and is worse: that
 * cache is filled when the Pull requests screen refreshes, so a user who has
 * never opened it would find this entry disabled on a perfectly ordinary GitHub
 * repository.
 *
 * A repository with no forge page therefore flashes instead of opening. That is
 * the honest trade — a sentence naming the reason, rather than an item whose
 * disabled state depends on which screen you visited earlier.
 */
export async function openCommitInBrowser(oid: string): Promise<void> {
  const repo = useRepoStore.getState().current;
  if (!repo) return;
  try {
    const url = await forgeCommitUrl(repo.id, oid, useForgeStore.getState().hostKinds);
    if (!url) {
      // No remote, an unparseable one, or a host that is neither GitHub nor
      // GitLab. Self-hosted becomes openable as soon as its host is mapped in
      // Settings, so the message points there.
      pgFlash("no forge page for this remote — map its host in Settings");
      return;
    }
    // Through `open_url`, the ONE validated opener path: https-only via
    // opener::safe_url. Nothing is sent — the app hands a url to the browser.
    await openUrl(url);
  } catch (e) {
    // A malformed host or a non-hex oid propagates as an error from the
    // builders. Report it where the user is looking rather than in the repo
    // error banner: they clicked a menu item, they did not run an operation.
    pgFlash(`could not open the commit page: ${String(e)}`);
  }
}
