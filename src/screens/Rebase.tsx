import { PGButton, PGEmpty } from "@/design";

export function RebaseScreen() {
  return (
    <PGEmpty
      icon="rebase"
      title="Interactive rebase — not yet wired"
      action={
        <PGButton variant="outline" disabled>
          Coming soon
        </PGButton>
      }
    >
      Interactive rebase needs the write path (stage, commit, rewrite
      history) wired up. We&apos;ll turn this on once those land.
    </PGEmpty>
  );
}
