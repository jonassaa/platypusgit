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
  multiFileMenuItems,
  pgFlash,
  useContextMenu,
  usePaneWidth,
  type DiffLineData,
  type SideLine,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { PGPane, FocusableScroll, usePaneList, useAction } from "@/features/keymap";
import { currentBranch, isStaged, isUnstaged, statusMark } from "@/lib/derive";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  type Selection,
} from "@/lib/selection";
import { getDiff } from "@/lib/tauri";
import type { CommitInfo, DiffKind, FileDiff, FileStatus } from "@/lib/types";

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
  const commits = useRepoStore((s) => s.commits);
  const setNavIntent = useNavStore((s) => s.setIntent);
  const addSignoff = useSettingsStore((s) => s.addSignoff);
  const setSetting = useSettingsStore((s) => s.set);
  const diffContextLines = useSettingsStore((s) => s.diffContextLines);
  const [message, setMessage] = React.useState("");
  const [body, setBody] = React.useState("");
  const [amend, setAmend] = React.useState(false);
  // Sign-off toggle seeds from the persisted preference; toggling it writes back.
  const [signoff, setSignoff] = React.useState(addSignoff);
  const [diffMode, setDiffMode] = React.useState<"unified" | "split">("unified");
  const [sel, setSel] = React.useState<Selection>(emptySelection);
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
    (f) => {
      if (f && sel.keys.length > 1 && sel.keys.includes(keyOf(f))) {
        return multiFileMenuItems(splitByKeys(sel.keys, staged, unstaged));
      }
      return fileMenuItems({
        path: f?.path,
        staged: f?.side === "staged",
      });
    },
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

  // Recent commit messages, newest-first, deduped by full message. Sourced from
  // the already-loaded log so no extra backend round-trip is needed.
  const recentMessages = React.useMemo(() => recentCommitMessages(commits), [
    commits,
  ]);

  const applyRecent = React.useCallback((r: RecentMessage) => {
    setMessage(r.subject);
    setBody(r.body);
  }, []);

  const recentsMenu = useContextMenu<void>(() =>
    recentMessages.length === 0
      ? [{ __menuTitle: "No recent messages" }]
      : [
          { __menuTitle: "Recent messages" },
          ...recentMessages.map((r) => ({
            icon: "commit" as const,
            label: r.subject,
            onClick: () => applyRecent(r),
          })),
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

  // Visible row order (staged block above changes block) — shift-click ranges
  // extend over this order and may cross the staged/unstaged boundary.
  const rowOrder = React.useMemo(
    () => [...staged.map(keyOf), ...unstaged.map(keyOf)],
    [staged, unstaged],
  );
  const selectedKeys = React.useMemo(() => new Set(sel.keys), [sel]);

  // Selection is local state keyed by side:path — reset on repo switch and
  // prune keys whose rows disappeared (refresh, stage/unstage moving files).
  React.useEffect(() => {
    setSel(emptySelection);
  }, [repo?.id]);
  React.useEffect(() => {
    const valid = new Set(rowOrder);
    setSel((s) => pruneSelection(s, valid));
  }, [rowOrder]);

  const onRowClick = (f: FileSlot) => (e: React.MouseEvent) => {
    setSel((s) =>
      clickSelection(rowOrder, s, keyOf(f), {
        toggle: e.metaKey || e.ctrlKey,
        range: e.shiftKey,
      }),
    );
  };

  // Right-click inside the multi-selection acts on it; outside collapses the
  // selection to the clicked row first (standard desktop-list behavior).
  const onRowContextMenu = (f: FileSlot) => (e: React.MouseEvent) => {
    const key = keyOf(f);
    if (!(sel.keys.length > 1 && sel.keys.includes(key))) {
      setSel({ keys: [key], anchor: key });
    }
    onFileCtx(e, f);
  };

  // Checkbox on a row inside the multi-selection stages/unstages every
  // selected row on that side; on an unselected row it stays single-file.
  const togglePaths = (f: FileSlot): string[] => {
    if (sel.keys.length > 1 && sel.keys.includes(keyOf(f))) {
      const split = splitByKeys(sel.keys, staged, unstaged);
      const paths = f.side === "staged" ? split.stagedPaths : split.unstagedPaths;
      if (paths.length > 0) return paths;
    }
    return [f.path];
  };

  const primaryKey = primarySelectedKey(sel);
  const selected = React.useMemo(() => {
    if (!primaryKey) return unstaged[0] ?? staged[0] ?? null;
    return (
      [...staged, ...unstaged].find((f) => keyOf(f) === primaryKey) ??
      unstaged[0] ??
      staged[0] ??
      null
    );
  }, [primaryKey, staged, unstaged]);

  // Row highlight: explicit selection when present, else the derived primary
  // (first unstaged file) so the keyboard always has a visible anchor.
  const effectiveKeys = React.useMemo(() => {
    if (sel.keys.length > 0) return selectedKeys;
    return new Set(selected ? [keyOf(selected)] : []);
  }, [sel.keys.length, selectedKeys, selected]);

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
    getDiff(repo.id, selected.path, kind, diffContextLines)
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
  }, [selected?.path, selected?.side, repo, diffContextLines]);

  const headBranch = currentBranch(branches);
  const defaultRemote = remotes[0] ?? null;

  const stagedAdd = React.useMemo(
    () => staged.reduce((s, f) => s + f.status.additions, 0),
    [staged],
  );
  const stagedDel = React.useMemo(
    () => staged.reduce((s, f) => s + f.status.deletions, 0),
    [staged],
  );

  // Keyboard: one selection across both sections (staged first, matching the
  // rendered order). Space stages/unstages the selected file, Rider-style.
  const combined = React.useMemo(() => [...staged, ...unstaged], [staged, unstaged]);
  const combinedIndex = Math.max(
    0,
    combined.findIndex((f) => selected && keyOf(f) === keyOf(selected)),
  );
  usePaneList({
    paneId: "commit.files",
    count: combined.length,
    selectedIndex: combinedIndex,
    onSelect: (i) => {
      const f = combined[i];
      if (f) setSel({ keys: [keyOf(f)], anchor: keyOf(f) });
    },
    onToggle: (i) => {
      const f = combined[i];
      if (!f) return;
      // Space acts on the whole multi-selection when the row is part of it.
      if (f.side === "staged") unstage(togglePaths(f));
      else stage(togglePaths(f));
    },
    searchText: (i) => combined[i]?.path ?? "",
  });

  // Commit chords (⌘↵ / ⌘⇧↵ / ⌘⇧M). Shared with the two buttons below so the
  // chord and click paths cannot drift. Handlers decline exactly when the
  // matching button is disabled, letting the chord fall through.
  const canCommit = (amend || staged.length > 0) && !!message.trim();
  const canCommitAndPush = canCommit && !!headBranch && !!defaultRemote;
  // Guards against a second commit firing before the first resolves and clears
  // the message/staged state — key auto-repeat (holding ⌘↵) and double-taps
  // both re-dispatch the chord while canCommit is still true.
  const committingRef = React.useRef(false);
  const doCommit = async (): Promise<string | null> => {
    if (committingRef.current) return null;
    committingRef.current = true;
    try {
      const full = buildMessage(message, body);
      const oid = await commitAction(full, amend, signoff);
      if (oid) {
        setMessage("");
        setBody("");
        setAmend(false);
      }
      return oid;
    } finally {
      committingRef.current = false;
    }
  };
  const doCommitAndPush = async (): Promise<void> => {
    if (!headBranch || !defaultRemote) return;
    const oid = await doCommit();
    if (!oid) return;
    await pushAction(defaultRemote.name, headBranch.name);
  };
  useAction(
    "commit.commit",
    () => {
      if (!canCommit) return false;
      void doCommit();
      return true;
    },
    [canCommit, message, body, amend, signoff],
  );
  useAction(
    "commit.commitAndPush",
    () => {
      if (!canCommitAndPush) return false;
      void doCommitAndPush();
      return true;
    },
    [canCommitAndPush, message, body, amend, signoff, headBranch, defaultRemote],
  );
  useAction(
    "commit.toggleAmend",
    () => {
      setAmend((a) => !a);
      return true;
    },
    [],
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
      <PGPane
        id="commit.files"
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
        <div
          data-testid="staged-list"
          style={{ borderBottom: "1px solid var(--border-0)" }}
        >
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
              additions={f.status.additions}
              deletions={f.status.deletions}
              selected={effectiveKeys.has(keyOf(f))}
              onClick={onRowClick(f)}
              onContextMenu={onRowContextMenu(f)}
              onToggle={() => unstage(togglePaths(f))}
            />
          ))}
        </div>
        <FocusableScroll
          testId="changes-list"
          style={{ flex: 1 }}
          ariaLabel="Changed files"
        >
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
              additions={f.status.additions}
              deletions={f.status.deletions}
              selected={effectiveKeys.has(keyOf(f))}
              onClick={onRowClick(f)}
              onContextMenu={onRowContextMenu(f)}
              onToggle={() => stage(togglePaths(f))}
            />
          ))}
        </FocusableScroll>
      </PGPane>
      <PGResizeHandle onDrag={changesPane.resize} />

      {/* Column 2: diff */}
      <PGPane
        id="commit.diff"
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
        <FocusableScroll style={{ flex: 1 }} ariaLabel="Diff">
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
        </FocusableScroll>
        {moreMenu.menu}
      </PGPane>

      <PGResizeHandle onDrag={(d) => composerPane.resize(-d)} side="left" />

      {/* Column 3: message composer */}
      <PGPane
        id="commit.message"
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
        <Header
          title="COMMIT MESSAGE"
          action={
            <PGButton
              size="xs"
              variant="ghost"
              icon="history"
              disabled={recentMessages.length === 0}
              title="Insert a recent commit message"
              onClick={(e) => {
                const r = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                recentsMenu.openAt(r.left, r.bottom + 4, undefined);
              }}
            >
              Recent
            </PGButton>
          }
        />
        {recentsMenu.menu}
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
            <PGInput value={message} onChange={setMessage} mono size="lg" data-testid="commit-subject" />
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
              data-pg-focus-target=""
              className="focusable"
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
              onChange={(v) => {
                setSignoff(v);
                setSetting("addSignoff", v);
              }}
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
              disabled={!canCommit}
              onClick={() => void doCommit()}
              data-testid="commit-button"
            >
              {amend ? "Amend" : "Commit"}
            </PGButton>
            <PGButton
              variant="primary"
              icon="push"
              fullWidth
              loading={!!activity.push}
              disabled={!canCommitAndPush}
              title={
                !headBranch
                  ? "Detached HEAD — no branch to push"
                  : !defaultRemote
                    ? "No remote configured"
                    : `Commit then push to ${defaultRemote.name}/${headBranch.name}`
              }
              onClick={() => void doCommitAndPush()}
            >
              Commit & Push
            </PGButton>
          </div>
        </div>
      </PGPane>
      {fileMenu}
    </div>
  );
}

function keyOf(f: FileSlot): string {
  return `${f.side}:${f.path}`;
}

/** Split the selected row keys into staged/unstaged path arrays for multi-file ops. */
function splitByKeys(
  keys: string[],
  staged: FileSlot[],
  unstaged: FileSlot[],
): { stagedPaths: string[]; unstagedPaths: string[] } {
  const set = new Set(keys);
  return {
    stagedPaths: staged.filter((f) => set.has(keyOf(f))).map((f) => f.path),
    unstagedPaths: unstaged.filter((f) => set.has(keyOf(f))).map((f) => f.path),
  };
}

function buildMessage(subject: string, body: string): string {
  const parts: string[] = [subject];
  if (body.trim()) parts.push("", body.trim());
  return parts.join("\n");
}

export interface RecentMessage {
  subject: string;
  body: string;
}

/**
 * Recent commit messages for the dropdown, newest-first, deduped by full
 * message text. Strips any `Signed-off-by:` trailer so re-selecting a message
 * doesn't carry a stale sign-off (the toggle re-adds it on commit). Drops
 * merge commits, which rarely make useful templates.
 */
export function recentCommitMessages(
  commits: CommitInfo[],
  limit = 15,
): RecentMessage[] {
  const out: RecentMessage[] = [];
  const seen = new Set<string>();
  for (const c of commits) {
    if (c.parents.length > 1) continue; // skip merge commits
    const subject = c.summary.trim();
    if (!subject) continue;
    const body = stripSignoff(c.body ?? "").trim();
    const dedupeKey = `${subject}\n${body}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ subject, body });
    if (out.length >= limit) break;
  }
  return out;
}

function stripSignoff(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^Signed-off-by:\s/i.test(line.trim()))
    .join("\n");
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
