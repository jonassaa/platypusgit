import {
  PGBranchPill,
  PGButton,
  PGEmpty,
  PGIcon,
  PGRemoteRow,
  PGSectionHeader,
  pgFlash,
  remoteMenuItems,
  useContextMenu,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, totalAheadBehind } from "@/lib/derive";
import type { RemoteInfo } from "@/lib/types";

export function RemoteScreen() {
  const branches = useRepoStore((s) => s.branches);
  const remotes = useRepoStore((s) => s.remotes);
  const store = useRepoStore();

  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);

  // Derive default remote/branch for pull and push from HEAD's upstream.
  // upstream is like "origin/main" → split on first "/".
  const [defaultRemote, defaultBranch] = (() => {
    if (!head?.upstream) return [null, null];
    const idx = head.upstream.indexOf("/");
    if (idx < 0) return [head.upstream, head.name];
    return [head.upstream.slice(0, idx), head.upstream.slice(idx + 1)];
  })();

  const handleFetchAll = () => store.fetchAll();

  const handlePull = () => {
    if (!defaultRemote || !defaultBranch) {
      pgFlash("No upstream configured for current branch");
      return;
    }
    store.pull(defaultRemote, defaultBranch);
  };

  const handlePush = () => {
    if (!defaultRemote || !defaultBranch) {
      pgFlash("No upstream configured — run git push -u origin <branch> first");
      return;
    }
    store.push(defaultRemote, defaultBranch);
  };

  const handleAddRemote = () => {
    const name = window.prompt("Remote name (e.g. origin)");
    if (!name) return;
    const url = window.prompt("Remote URL");
    if (!url) return;
    store.addRemote(name, url);
  };

  const { onContextMenu: onRemoteCtx, menu: remoteMenu } =
    useContextMenu<RemoteInfo>((r) => remoteMenuItems(r));

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
              onClick={handleFetchAll}
            >
              Fetch all remotes
            </PGButton>
            <PGButton
              variant="outline"
              icon="pull"
              onClick={handlePull}
            >
              Pull {behind ? `↓${behind}` : ""}
            </PGButton>
            <PGButton
              variant="primary"
              icon="push"
              onClick={handlePush}
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
                onClick={handleAddRemote}
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
              data-remote={r.name}
              onContextMenu={(e) => onRemoteCtx(e, r)}
              ahead={0}
              behind={0}
              onFetch={() => store.fetch(r.name)}
              onPull={() => {
                // Pull the current branch from this remote (uses HEAD branch name).
                const branch = head?.name;
                if (!branch) {
                  pgFlash("No branch checked out");
                  return;
                }
                store.pull(r.name, branch);
              }}
              onPush={() => {
                const branch = head?.name;
                if (!branch) {
                  pgFlash("No branch checked out");
                  return;
                }
                store.push(r.name, branch);
              }}
            />
          ))}
        </div>
      </div>
      {remoteMenu}
    </div>
  );
}
