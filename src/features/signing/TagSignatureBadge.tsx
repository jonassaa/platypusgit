import { useRepoStore } from "@/features/repo/useRepoStore";
import { verifyTag } from "@/lib/tauri";
import { SignatureBadgeView, useLazyVerification } from "./SignatureBadge";

/**
 * Signature status of one tag (#132).
 *
 * Rendered for the **selected** tag only, in the Branches inspector — never per
 * row. The Branches screen lists every tag at once, so a verdict per row would
 * be one `git verify-tag` process per row on every refresh, which is exactly
 * what `SignatureBadge` refuses to do to the log. The rows instead show
 * `TagInfo.signed`, which is read straight off the object and costs nothing.
 *
 * `verify_tag` still answers an unsigned or lightweight tag without a
 * subprocess, so mounting this for one is free.
 */
export function TagSignatureBadge({ name }: { name: string }) {
  const repoId = useRepoStore((s) => s.current?.id ?? null);
  const status = useLazyVerification(
    repoId && name ? `${repoId}:${name}` : null,
    repoId && name ? () => verifyTag(repoId, name) : null,
  );
  return <SignatureBadgeView status={status} testId="tag-signature-badge" />;
}
