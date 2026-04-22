import {
  PGBranchPill,
  PGButton,
  PGEmpty,
  PGIcon,
  PGRemoteRow,
  PGSectionHeader,
  pgFlash,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, totalAheadBehind } from "@/lib/derive";

export function RemoteScreen() {
  const branches = useRepoStore((s) => s.branches);
  const remotes = useRepoStore((s) => s.remotes);
  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div
        style={{
          padding: 16,
          maxWidth: 1100,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            padding: 14,
            border: "1px solid var(--border-0)",
            borderRadius: "var(--r-4)",
            background: "var(--bg-1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <PGIcon name="sync" size={16} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
              Sync status
            </span>
            {head ? (
              <PGBranchPill name={head.name} tone="accent" active />
            ) : (
              <span style={{ color: "var(--fg-3)" }}>(detached)</span>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            {[
              {
                label: "Ahead",
                value: String(ahead),
                color: "var(--git-added)",
                sub: "commits to push",
              },
              {
                label: "Behind",
                value: String(behind),
                color: "var(--git-modified)",
                sub: "commits to pull",
              },
              {
                label: "Upstream",
                value: head?.upstream ?? "—",
                color: head?.upstream ? "var(--accent)" : "var(--fg-3)",
                sub: head?.upstream ? "tracking" : "not tracking",
              },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  padding: 10,
                  background: "var(--bg-2)",
                  borderRadius: "var(--r-3)",
                  border: "1px solid var(--border-0)",
                }}
              >
                <div
                  style={{
                    fontSize: "var(--fs-10)",
                    color: "var(--fg-2)",
                    fontFamily: "var(--font-mono)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4,
                  }}
                >
                  {m.label}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-20)",
                    fontFamily: "var(--font-mono)",
                    color: m.color,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.value}
                </div>
                <div
                  style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}
                >
                  {m.sub}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <PGButton
              variant="outline"
              icon="fetch"
              disabled
              onClick={() => pgFlash("fetch is not wired up yet")}
            >
              Fetch all remotes
            </PGButton>
            <PGButton
              variant="outline"
              icon="pull"
              disabled
              onClick={() => pgFlash("pull is not wired up yet")}
            >
              Pull {behind ? `↓${behind}` : ""}
            </PGButton>
            <PGButton
              variant="primary"
              icon="push"
              disabled
              onClick={() => pgFlash("push is not wired up yet")}
            >
              Push {ahead ? `↑${ahead}` : ""}
            </PGButton>
          </div>
        </div>

        <div>
          <PGSectionHeader
            actions={
              <PGButton
                size="xs"
                variant="ghost"
                icon="plus"
                disabled
                onClick={() => pgFlash("add remote is not wired up yet")}
              >
                Add remote
              </PGButton>
            }
          >
            REMOTES ({remotes.length})
          </PGSectionHeader>
          {remotes.length === 0 && (
            <PGEmpty icon="link" title="No remotes configured">
              Add a remote with{" "}
              <span className="mono">git remote add</span>, then reopen the
              repository.
            </PGEmpty>
          )}
          {remotes.map((r) => (
            <PGRemoteRow
              key={r.name}
              name={r.name}
              url={r.url ?? "(no url)"}
              ahead={0}
              behind={0}
              onFetch={() => pgFlash("fetch is not wired up yet")}
              onPull={() => pgFlash("pull is not wired up yet")}
              onPush={() => pgFlash("push is not wired up yet")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
