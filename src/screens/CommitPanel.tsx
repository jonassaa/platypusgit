import React from "react";
import {
  PGAvatar,
  PGBadge,
  PGButton,
  PGButtonGroup,
  PGChangeRow,
  PGCheckbox,
  PGEmpty,
  PGHunk,
  PGIconButton,
  PGInput,
  PGSideBySideDiff,
  PGSpinner,
  PGStatusMark,
  PGResizeHandle,
  PGTextarea,
  fileMenuItems,
  pgFlash,
  useContextMenu,
  usePaneWidth,
  type DiffLineData,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { currentBranch, isStaged, isUnstaged, statusMark } from "@/lib/derive";
import { getDiff } from "@/lib/tauri";
import type { DiffKind, FileDiff, FileStatus } from "@/lib/types";

interface FileSlot {
  path: string;
  status: FileStatus;
  side: "staged" | "unstaged";
}

export function CommitPanelScreen() {
  const repo = useRepoStore((s) => s.current);
  const status = useRepoStore((s) => s.status);
  const branches = useRepoStore((s) => s.branches);
  const remotes = useRepoStore((s) => s.remotes);
  const loading = useRepoStore((s) => s.loading);
  const stage = useRepoStore((s) => s.stage);
  const unstage = useRepoStore((s) => s.unstage);
  const commitAction = useRepoStore((s) => s.commit);
  const pushAction = useRepoStore((s) => s.push);
  const activity = useRepoStore((s) => s.activity);
  const setNavIntent = useNavStore((s) => s.setIntent);
  const [message, setMessage] = React.useState("");
  const [body, setBody] = React.useState("");
  const [amend, setAmend] = React.useState(false);
  const [signoff, setSignoff] = React.useState(false);
  const [diffMode, setDiffMode] = React.useState<"unified" | "split">("unified");
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const changesPane = usePaneWidth(320, {
    min: 220,
    max: 720,
    storageKey: "pg-commit-changes-w",
  });
  const composerPane = usePaneWidth(360, {
    min: 280,
    max: 640,
    storageKey: "pg-commit-composer-w",
  });
  const [diff, setDiff] = React.useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);

  const { onContextMenu: onFileCtx, menu: fileMenu } = useContextMenu<FileSlot>(
    (f) =>
      fileMenuItems({
        path: f?.path,
        staged: f?.side === "staged",
      }),
  );

  const moreMenu = useContextMenu<{ path: string; diff: FileDiff | null }>(
    (p) => [
      { __menuTitle: p?.path || "file" },
      {
        icon: "copy",
        label: "Copy path",
        onClick: () => {
          if (!p?.path) return;
          navigator.clipboard?.writeText(p.path);
          pgFlash("copied path");
        },
      },
      {
        icon: "copy",
        label: "Copy diff as text",
        onClick: () => {
          if (!p?.diff) return;
          const text = p.diff.hunks
            .map(
              (h) =>
                `${h.header}\n${h.lines
                  .map((ln) => {
                    const k = ln.kind.kind;
                    const prefix = k === "Addition" ? "+" : k === "Deletion" ? "-" : " ";
                    return `${prefix}${ln.content}`;
                  })
                  .join("")}`,
            )
            .join("\n");
          navigator.clipboard?.writeText(text);
          pgFlash("copied diff");
        },
      },
      { divider: true },
      {
        icon: "edit",
        label: "Open in editor",
        onClick: () => {
          if (p?.path) useRepoStore.getState().openInEditor(p.path);
        },
      },
      {
        icon: "history",
        label: "Show file history",
        onClick: () => {
          if (p?.path) setNavIntent({ kind: "file-history", path: p.path });
        },
      },
    ],
  );

  const staged = React.useMemo(
    () =>
      status
        .filter(isStaged)
        .map((s) => ({ path: s.path, status: s, side: "staged" as const })),
    [status],
  );
  const unstaged = React.useMemo(
    () =>
      status
        .filter(isUnstaged)
        .map((s) => ({ path: s.path, status: s, side: "unstaged" as const })),
    [status],
  );

  const selected = React.useMemo(() => {
    if (!selectedKey) return unstaged[0] ?? staged[0] ?? null;
    return (
      [...staged, ...unstaged].find((f) => keyOf(f) === selectedKey) ??
      unstaged[0] ??
      staged[0] ??
      null
    );
  }, [selectedKey, staged, unstaged]);

  React.useEffect(() => {
    if (!selected || !repo) {
      setDiff(null);
      return;
    }
    const kind: DiffKind =
      selected.side === "staged" ? "IndexToHead" : "WorktreeToIndex";
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    getDiff(repo.id, selected.path, kind)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setDiffError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.side, repo]);

  const headBranch = currentBranch(branches);
  const defaultRemote = remotes[0] ?? null;

  const stagedAdd = React.useMemo(
    () => staged.reduce((s, f) => s + countAdd(f.status), 0),
    [staged],
  );
  const stagedDel = React.useMemo(
    () => staged.reduce((s, f) => s + countDel(f.status), 0),
    [staged],
  );

  if (!loading && staged.length === 0 && unstaged.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <PGEmpty icon="check" title="Working tree clean">
          No changes to commit.
        </PGEmpty>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* Column 1: change list */}
      <div
        style={{
          width: changesPane.width,
          flexShrink: 0,
          background: "var(--bg-1)",
          borderRight: "1px solid var(--border-0)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div style={{ borderBottom: "1px solid var(--border-0)" }}>
          <Header
            title="STAGED"
            badge={<PGBadge tone="success">{staged.length}</PGBadge>}
            action={
              <PGButton
                size="xs"
                variant="ghost"
                onClick={() => unstage(staged.map((f) => f.path))}
                disabled={staged.length === 0}
              >
                Unstage all
              </PGButton>
            }
          />
          {staged.length === 0 && (
            <div
              style={{
                padding: 12,
                color: "var(--fg-3)",
                fontSize: "var(--fs-11)",
                textAlign: "center",
              }}
            >
              Nothing staged
            </div>
          )}
          {staged.map((f) => (
            <PGChangeRow
              key={`s:${f.path}`}
              path={f.path}
              status={statusMark(f.status)}
              staged
              additions={countAdd(f.status)}
              deletions={countDel(f.status)}
              selected={selectedKey === keyOf(f)}
              onClick={() => setSelectedKey(keyOf(f))}
              onContextMenu={(e) => onFileCtx(e, f)}
              onToggle={() => unstage([f.path])}
            />
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <Header
            title="CHANGES"
            badge={<PGBadge tone="warn">{unstaged.length}</PGBadge>}
            action={
              <div style={{ display: "flex", gap: 4 }}>
                <PGButton
                  size="xs"
                  variant="ghost"
                  onClick={() => stage(unstaged.map((f) => f.path))}
                  disabled={unstaged.length === 0}
                >
                  Stage all
                </PGButton>
                <PGButton
                  size="xs"
                  variant="ghost"
                  disabled={unstaged.length === 0 && staged.length === 0}
                  onClick={async () => {
                    const message = window.prompt("Stash message (optional)");
                    if (message === null) return;
                    await useRepoStore.getState().stashSave({
                      message: message || null,
                      includeUntracked: true,
                      keepIndex: false,
                    });
                  }}
                >
                  Stash
                </PGButton>
              </div>
            }
            border
          />
          {unstaged.map((f) => (
            <PGChangeRow
              key={`u:${f.path}`}
              path={f.path}
              status={statusMark(f.status)}
              staged={false}
              additions={countAdd(f.status)}
              deletions={countDel(f.status)}
              selected={selectedKey === keyOf(f)}
              onClick={() => setSelectedKey(keyOf(f))}
              onContextMenu={(e) => onFileCtx(e, f)}
              onToggle={() => stage([f.path])}
            />
          ))}
        </div>
      </div>
      <PGResizeHandle onDrag={changesPane.resize} />

      {/* Column 2: diff */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 32,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--bg-1)",
            borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
          }}
        >
          {selected && <PGStatusMark kind={statusMark(selected.status)} />}
          <span>{selected?.path ?? "no file selected"}</span>
          <div style={{ flex: 1 }} />
          <PGButtonGroup
            value={diffMode}
            onChange={(v) => setDiffMode(v as typeof diffMode)}
            options={[
              { value: "unified", label: "Unified" },
              { value: "split", label: "Split" },
            ]}
            size="sm"
          />
          <PGIconButton
            icon="more"
            size="sm"
            title="File actions"
            onClick={(e) => {
              if (!selected) return;
              moreMenu.openAt(e.clientX, e.clientY + 4, {
                path: selected.path,
                diff,
              });
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {diffLoading && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--fg-2)",
              }}
            >
              <PGSpinner size={14} />
            </div>
          )}
          {!diffLoading && diffError && (
            <div
              style={{
                padding: 20,
                color: "var(--git-removed)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
              }}
            >
              {diffError}
            </div>
          )}
          {!diffLoading && !diffError && diff && diff.binary && (
            <PGEmpty icon="file" title="Binary file">
              Binary diffs aren&apos;t shown.
            </PGEmpty>
          )}
          {!diffLoading && !diffError && diff && !diff.binary &&
            diff.hunks.length === 0 && (
              <PGEmpty icon="file" title="No diff">
                File is tracked but no hunks were produced.
              </PGEmpty>
            )}
          {!diffLoading && !diffError && diff && !diff.binary && diff.hunks.length > 0 &&
            diffMode === "unified" &&
            diff.hunks.map((h, i) => (
              <PGHunk
                key={i}
                header={h.header.replace(/^@@\s*|\s*@@$/g, "").trim()}
                lines={h.lines.map(toUiLine)}
                expanded={true}
                staged={selected?.side === "staged"}
                onStage={() => {
                  if (!selected) return;
                  if (selected.side === "staged") {
                    useRepoStore.getState().unstageHunk(selected.path, i);
                  } else {
                    useRepoStore.getState().stageHunk(selected.path, i);
                  }
                }}
                onDiscard={() => {
                  if (!selected) return;
                  if (window.confirm("Discard this hunk? The change will be lost.")) {
                    useRepoStore.getState().discardHunk(selected.path, i);
                  }
                }}
              />
            ))}
          {!diffLoading && !diffError && diff && !diff.binary && diff.hunks.length > 0 &&
            diffMode === "split" && (
              <PGSideBySideDiff {...diffToSplit(diff)} />
            )}
        </div>
        {moreMenu.menu}
      </div>

      <PGResizeHandle onDrag={(d) => composerPane.resize(-d)} side="left" />

      {/* Column 3: message composer */}
      <div
        style={{
          width: composerPane.width,
          flexShrink: 0,
          background: "var(--bg-1)",
          borderLeft: "1px solid var(--border-0)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <Header title="COMMIT MESSAGE" />
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: 1,
          }}
        >
          <div>
            <LabelRow
              label="Subject"
              right={
                <span
                  style={{
                    fontSize: "var(--fs-10)",
                    color:
                      message.length > 50
                        ? "var(--git-modified)"
                        : "var(--fg-3)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {message.length}/50
                </span>
              }
            />
            <PGInput value={message} onChange={setMessage} mono size="lg" />
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <LabelRow
              label="Body"
              right={
                <span
                  style={{
                    fontSize: "var(--fs-10)",
                    color: "var(--fg-3)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  wrap at 72
                </span>
              }
            />
            <PGTextarea
              value={body}
              onChange={setBody}
              rows={8}
              mono
              style={{ flex: 1 }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "8px 0",
              borderTop: "1px solid var(--border-0)",
              borderBottom: "1px solid var(--border-0)",
            }}
          >
            <PGCheckbox
              checked={amend}
              onChange={setAmend}
              label="Amend previous commit"
            />
            <PGCheckbox
              checked={signoff}
              onChange={setSignoff}
              label="Add Signed-off-by trailer"
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <PGAvatar name="you" size={14} />
            (signature will come from git config)
          </div>
          <div
            style={{
              fontSize: "var(--fs-11)",
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              padding: "6px 8px",
              background: "var(--bg-2)",
              borderRadius: "var(--r-3)",
            }}
          >
            {staged.length} file{staged.length !== 1 ? "s" : ""},{" "}
            <span style={{ color: "var(--git-added)" }}>+{stagedAdd}</span>{" "}
            <span style={{ color: "var(--git-removed)" }}>−{stagedDel}</span>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <PGButton
              variant="default"
              fullWidth
              disabled={(!amend && staged.length === 0) || !message.trim()}
              onClick={async () => {
                const full = buildMessage(message, body, signoff);
                const oid = await commitAction(full, amend);
                if (oid) {
                  setMessage("");
                  setBody("");
                  setAmend(false);
                }
              }}
            >
              {amend ? "Amend" : "Commit"}
            </PGButton>
            <PGButton
              variant="primary"
              icon="push"
              fullWidth
              loading={!!activity.push}
              disabled={
                !headBranch ||
                !defaultRemote ||
                (!amend && staged.length === 0) ||
                !message.trim()
              }
              title={
                !headBranch
                  ? "Detached HEAD — no branch to push"
                  : !defaultRemote
                    ? "No remote configured"
                    : `Commit then push to ${defaultRemote.name}/${headBranch.name}`
              }
              onClick={async () => {
                if (!headBranch || !defaultRemote) return;
                const full = buildMessage(message, body, signoff);
                const oid = await commitAction(full, amend);
                if (!oid) return;
                setMessage("");
                setBody("");
                setAmend(false);
                await pushAction(defaultRemote.name, headBranch.name);
              }}
            >
              Commit & Push
            </PGButton>
          </div>
        </div>
      </div>
      {fileMenu}
    </div>
  );
}

function keyOf(f: FileSlot): string {
  return `${f.side}:${f.path}`;
}

function buildMessage(subject: string, body: string, signoff: boolean): string {
  const parts: string[] = [subject];
  if (body.trim()) parts.push("", body.trim());
  if (signoff) {
    const head = useRepoStore.getState().commits[0];
    if (head?.author && head?.email) {
      parts.push("", `Signed-off-by: ${head.author} <${head.email}>`);
    }
  }
  return parts.join("\n");
}

function diffToSplit(d: FileDiff): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
  for (const h of d.hunks) {
    left.push({ kind: "info", text: h.header });
    right.push({ kind: "info", text: h.header });
    for (const ln of h.lines) {
      const k = ln.kind.kind;
      if (k === "Addition") {
        left.push({ kind: "empty", ln: "", text: "" });
        right.push({
          kind: "add",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      } else if (k === "Deletion") {
        left.push({
          kind: "rem",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({ kind: "empty", ln: "", text: "" });
      } else {
        left.push({
          kind: "ctx",
          ln: ln.oldLineno ?? undefined,
          text: ln.content,
        });
        right.push({
          kind: "ctx",
          ln: ln.newLineno ?? undefined,
          text: ln.content,
        });
      }
    }
  }
  return { left, right };
}

function countAdd(s: FileStatus): number {
  // We don't have per-file adds/dels from the status list — surface 0
  // unless the diff viewer exposes it. Keeping the slot keeps the UI tidy.
  return s.worktree.kind === "Added" || s.index.kind === "Added" ? 0 : 0;
}

function countDel(s: FileStatus): number {
  return s.worktree.kind === "Deleted" || s.index.kind === "Deleted" ? 0 : 0;
}

function toUiLine(l: {
  kind: { kind: string };
  oldLineno: number | null;
  newLineno: number | null;
  content: string;
}): DiffLineData {
  const k = l.kind.kind;
  if (k === "Addition")
    return { kind: "add", lnR: l.newLineno ?? undefined, text: l.content };
  if (k === "Deletion")
    return { kind: "rem", lnL: l.oldLineno ?? undefined, text: l.content };
  return {
    kind: "ctx",
    lnL: l.oldLineno ?? undefined,
    lnR: l.newLineno ?? undefined,
    text: l.content,
  };
}

function Header({
  title,
  badge,
  action,
  border,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      style={{
        height: 28,
        padding: "0 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-2)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-11)",
        color: "var(--fg-1)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        borderBottom: border ? "1px solid var(--border-0)" : undefined,
      }}
    >
      <span>{title}</span>
      {badge}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

function LabelRow({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {right}
    </div>
  );
}
