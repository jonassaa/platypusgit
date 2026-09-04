import React from "react";
import ReactDOM from "react-dom";
import {
  PGIcon,
  PGSearchInput,
  PGIconButton,
  useContextMenu,
  branchMenuItems,
  remoteBranchMenuItems,
} from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import type { BranchInfo } from "@/lib/types";
import { orderBranches } from "./orderBranches";
import {
  branchLeafRows,
  branchTreeRowsWithPins,
  parentFolderPath,
  type BranchTreeRow,
} from "./branchTree";
import { useBranchFolders } from "./useBranchFolders";
import { usePinSet } from "./usePinSet";

interface BranchPickerProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

type Row = BranchInfo & { kind: "local" | "remote" };
type TreeRow = BranchTreeRow<Row>;

const WIDTH = 400;
const MAX_HEIGHT = 480;
/** Pixels a nesting level indents a row by — the Branches screen's step. */
const INDENT = 14;

export function BranchPicker({ anchor, open, onClose }: BranchPickerProps) {
  const branches = useRepoStore((s) => s.branches);
  const repoPath = useRepoStore((s) => s.current?.path ?? null);
  const pins = usePinSet();
  // The SAME fold set the Branches screen writes (#244), keyed by repository:
  // one repository has one notion of which folders are folded, and a picker
  // that disagreed with the screen would be a second answer to one question.
  const folders = useBranchFolders(repoPath);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const createAndSwitchBranch = useRepoStore((s) => s.createAndSwitchBranch);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const { onContextMenu: onLocalCtx, openAt: openLocal, menu: localMenu } =
    useContextMenu<BranchInfo>((b) =>
      branchMenuItems({
        name: b?.name,
        current: b?.isHead,
        upstream: b?.upstream,
      }),
    );
  const { onContextMenu: onRemoteCtx, openAt: openRemote, menu: remoteMenu } =
    useContextMenu<BranchInfo>((b) =>
      remoteBranchMenuItems({ name: b?.name }),
    );

  // Filter FIRST, order SECOND (#135). `orderBranches` only permutes, so
  // neither the pinned default nor a user pin (#238) can come back once the
  // query has excluded it.
  const local: Row[] = React.useMemo(
    () =>
      orderBranches(
        branches
          .filter((b) => !b.isRemote && b.name.includes(query))
          .map((b) => ({ ...b, kind: "local" as const })),
        pins,
      ),
    [branches, query, pins],
  );
  const remote: Row[] = React.useMemo(
    () =>
      orderBranches(
        branches
          .filter((b) => b.isRemote && b.name.includes(query))
          .map((b) => ({ ...b, kind: "remote" as const })),
        pins,
      ),
    [branches, query, pins],
  );

  // Filter, order, then GROUP — grouping last, so it only ever moves ordered
  // rows into folders (#244). Each section trees on its own, which is why
  // folding `origin` cannot fold the local `feat` beside it: the paths differ.
  const filtering = query.length > 0;
  const localRows = React.useMemo<TreeRow[]>(
    () =>
      filtering
        ? branchLeafRows(local)
        : branchTreeRowsWithPins(local, pins, folders.collapsed),
    [local, filtering, pins, folders.collapsed],
  );
  const remoteRows = React.useMemo<TreeRow[]>(
    () =>
      filtering
        ? branchLeafRows(remote)
        : branchTreeRowsWithPins(remote, pins, folders.collapsed),
    [remote, filtering, pins, folders.collapsed],
  );

  /** Every rendered row, in render order — what the cursor indexes into. */
  const flat = React.useMemo(
    () => [...localRows, ...remoteRows],
    [localRows, remoteRows],
  );

  // True once the user has aimed the cursor themselves (arrows or hover). The
  // resting rule below must then stop moving it, or a late `list_branches`
  // arrival would yank the cursor out from under them.
  const aimed = React.useRef(false);
  const aim = (next: number) => {
    aimed.current = true;
    setActiveIndex(next);
  };
  /**
   * Claim the cursor without moving it.
   *
   * Enter, → and ← all act on the row the cursor is ON, and a fold changes the
   * row set — so the resting rule would re-park the cursor on HEAD the instant
   * a folder opens, yanking it out from under the key that just opened it.
   * Acting on a row is the user aiming at it (#244).
   */
  const claim = () => {
    aimed.current = true;
  };

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // The user's aim is dropped when the popover opens and whenever the query
  // changes — both are moments where the row set is rebuilt under them. Runs
  // before the resting effect below (effects fire in declaration order), so a
  // query change re-parks the cursor in the same commit.
  React.useEffect(() => {
    aimed.current = false;
  }, [open, query]);

  // Where the cursor rests before the user moves it. Enter checks out the
  // active row, so with an empty query it sits on the CURRENT branch — the one
  // row `checkout()` refuses to act on — rather than on whatever sorts first,
  // which since #135 is the pinned default branch. Once a query is typed the
  // top match IS the target, so it moves to row 0.
  //
  // `flat` is in the deps on purpose: the popover can be opened before
  // `list_branches` resolves, and an effect keyed only on [open, query] would
  // run once against an EMPTY list, land on 0, and leave the cursor on the
  // pinned default once the branches arrived — the exact accident this rule
  // exists to prevent. `aimed` is what keeps re-running harmless.
  //
  // Resetting on every query change also fixes a latent bug: the index used to
  // survive typing and was only clamped to the new length, leaving the cursor
  // on an unrelated row.
  React.useEffect(() => {
    if (!open || aimed.current) return;
    if (query) {
      setActiveIndex(0);
      return;
    }
    const head = flat.findIndex(
      (r) => r.kind === "branch" && r.branch.kind === "local" && r.branch.isHead,
    );
    if (head >= 0) {
      setActiveIndex(head);
      return;
    }
    // HEAD can be folded away (#244). Then the cursor rests on the FOLDER
    // holding it — the first match is the outermost rendered one, since a
    // collapsed folder renders none of its children. Enter there opens the
    // folder instead of checking anything out, which keeps the rule the
    // resting position exists for: a stray Enter must be a no-op.
    const headName = branches.find((b) => !b.isRemote && b.isHead)?.name;
    const holding = headName
      ? flat.findIndex(
          (r) => r.kind === "folder" && headName.startsWith(`${r.path}/`),
        )
      : -1;
    setActiveIndex(holding >= 0 ? holding : 0);
  }, [open, query, flat, branches]);

  // Clamp a cursor left past the end by a shrinking list. The UPDATER form is
  // load-bearing: the resting effect above runs in the same commit, and a
  // clamp reading `activeIndex` out of this render's closure would overwrite
  // the position that effect just chose with a stale one. (Typing a query
  // shrinks the list and re-parks the cursor at once — which is exactly when
  // the two effects collide.)
  React.useEffect(() => {
    setActiveIndex((i) => (i >= flat.length ? Math.max(0, flat.length - 1) : i));
  }, [flat.length]);

  // Keep the cursor visible. The resting position can start below the fold in a
  // long list, and arrowing past the visible area never scrolled either. These
  // rows are plainly mapped, not windowed, so the DOM route is sound here.
  // Optional call: jsdom has no scrollIntoView, and this is presentation only.
  React.useEffect(() => {
    if (!open) return;
    // `[data-picker-row]` and not `[data-branch-row]`: folder rows are part of
    // the cursor's order, so anything indexed by position has to count them.
    const rows =
      popoverRef.current?.querySelectorAll<HTMLElement>("[data-picker-row]");
    rows?.[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, flat.length]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      const popover = popoverRef.current;
      if (popover && t && popover.contains(t)) return;
      if (anchor && t && anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, onClose, anchor]);

  const requestCreate = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    onClose();
    void createAndSwitchBranch(name, { autoStash: true });
  };

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - WIDTH - 8),
  );
  const top = rect.bottom + 4;

  const checkout = (r: Row) => {
    if (r.kind === "local" && r.isHead) return;
    void checkoutBranch(r.name);
    onClose();
  };

  // The popover stays open across a fold: folding is navigation, not an answer.
  const toggleFolder = (path: string) => {
    if (folders.collapsed.has(path)) folders.expand([path]);
    else folders.collapse([path]);
  };

  /** Move the cursor onto a folder row by path, if it is rendered. */
  const aimAtFolder = (path: string) => {
    const i = flat.findIndex((r) => r.kind === "folder" && r.path === path);
    if (i >= 0) aim(i);
  };

  const activate = (row: TreeRow) => {
    if (row.kind === "folder") {
      // Folding the folder the cursor sits in would otherwise leave it on a
      // row that is still rendered — it is the folder — so nothing to fix up.
      toggleFolder(row.path);
      return;
    }
    checkout(row.branch);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      aim(Math.min(flat.length - 1, activeIndex + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      aim(Math.max(0, activeIndex - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (flat.length === 0) {
        requestCreate(query.trim() || "main");
        return;
      }
      const row = flat[activeIndex];
      if (!row) return;
      claim();
      activate(row);
      return;
    }
    // → opens a folded folder, and on a branch keeps opening its actions menu.
    // ← folds an open folder, and on anything else climbs to the folder the
    // row sits in — the same pair the Branches screen's tree answers.
    if (e.key === "ArrowLeft") {
      const row = flat[activeIndex];
      if (!row) return;
      e.preventDefault();
      claim();
      if (row.kind === "folder" && !folders.collapsed.has(row.path)) {
        folders.collapse([row.path]);
        return;
      }
      const parent = parentFolderPath(flat, activeIndex);
      if (parent) aimAtFolder(parent);
      return;
    }
    if (e.key === "ArrowRight") {
      const row = flat[activeIndex];
      if (!row) return;
      e.preventDefault();
      claim();
      if (row.kind === "folder") {
        if (folders.collapsed.has(row.path)) folders.expand([row.path]);
        return;
      }
      const rowEls =
        popoverRef.current?.querySelectorAll<HTMLElement>("[data-picker-row]");
      const rowEl = rowEls?.[activeIndex];
      const r = rowEl?.getBoundingClientRect() ?? anchor.getBoundingClientRect();
      const x = r.right - 24;
      const y = r.bottom;
      if (row.branch.kind === "local") openLocal(x, y, row.branch);
      else openRemote(x, y, row.branch);
      return;
    }
  };

  const renderFolder = (row: Extract<TreeRow, { kind: "folder" }>, idx: number) => {
    const active = idx === activeIndex;
    return (
      <div
        key={`folder:${row.path}`}
        data-picker-row
        data-picker-folder={row.path}
        data-active={active ? "true" : "false"}
        // The whole row folds, like the Branches screen's folder rows: a branch
        // folder is not a git object, so folding is the only reason it is here.
        onClick={() => {
          aim(idx);
          toggleFolder(row.path);
        }}
        onMouseEnter={() => aim(idx)}
        title={`${row.path}/`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "calc(26px + var(--row-step))",
          padding: "0 10px",
          paddingLeft: 10 + row.depth * INDENT,
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          // A folder row is a control, not text: a stray drag across it must
          // not select "feat (12)".
          userSelect: "none",
        }}
      >
        <PGIcon
          name={row.collapsed ? "chevronRight" : "chevronDown"}
          size={10}
          style={{ color: "var(--fg-3)", flexShrink: 0 }}
        />
        <PGIcon
          name={row.collapsed ? "folder" : "folderOpen"}
          size={12}
          style={{ color: "var(--fg-2)", flexShrink: 0 }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fg-0)",
          }}
        >
          {row.label}
        </span>
        <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-10)" }}>
          ({row.count})
        </span>
      </div>
    );
  };

  const renderBranch = (
    row: Extract<TreeRow, { kind: "branch" }>,
    idx: number,
  ) => {
    const r = row.branch;
    const active = idx === activeIndex;
    const handler = r.kind === "local" ? onLocalCtx : onRemoteCtx;
    return (
      <div
        key={`${r.kind}:${r.name}`}
        data-branch-row
        data-picker-row
        // The full name, whatever the row's label shows: the tree renders only
        // the segments a row owns, and the tests and the drag both need the ref.
        data-branch-name={r.name}
        data-active={active ? "true" : "false"}
        onClick={() => checkout(r)}
        onContextMenu={(e) => handler(e, r)}
        onMouseEnter={() => aim(idx)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "calc(26px + var(--row-step))",
          padding: "0 10px",
          // Indented like the screen's tree, plus the width of the chevron a
          // folder row spends there, so nested names line up under the label.
          paddingLeft: 10 + row.depth * INDENT + (row.depth > 0 ? 16 : 0),
          background: active ? "var(--bg-selection)" : "transparent",
          cursor: r.kind === "local" && r.isHead ? "default" : "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
        }}
      >
        <PGIcon
          name="branch"
          size={12}
          style={{ color: r.isHead ? "var(--accent)" : "var(--fg-2)" }}
        />
        <span
          title={r.name}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: r.isHead ? "var(--accent)" : "var(--fg-0)",
          }}
        >
          {row.label}
        </span>
        {r.isHead && (
          <span
            style={{
              fontSize: "var(--fs-10)",
              color: "var(--accent)",
              padding: "0 4px",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-2)",
            }}
          >
            HEAD
          </span>
        )}
        {r.kind === "local" && r.upstream && !r.isHead && (
          <span
            style={{
              color: "var(--fg-3)",
              fontSize: "var(--fs-10)",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.upstream}
          </span>
        )}
        {r.ahead > 0 && (
          <span style={{ color: "var(--git-added)", fontSize: "var(--fs-10)" }}>
            ↑{r.ahead}
          </span>
        )}
        {r.behind > 0 && (
          <span
            style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
          >
            ↓{r.behind}
          </span>
        )}
        <PGIconButton
          icon="more"
          size="sm"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation();
            handler(e, r);
          }}
        />
      </div>
    );
  };

  const renderRow = (row: TreeRow, idx: number) =>
    row.kind === "folder" ? renderFolder(row, idx) : renderBranch(row, idx);

  const sectionHeader = (label: string, count: number) => (
    <div
      style={{
        padding: "6px 10px 2px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-10)",
        color: "var(--fg-2)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {label} <span style={{ color: "var(--fg-3)" }}>({count})</span>
    </div>
  );

  const content = (
    <>
      <div
        ref={popoverRef}
        onKeyDown={onKeyDown}
        style={{
          position: "fixed",
          left,
          top,
          width: WIDTH,
          maxHeight: MAX_HEIGHT,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "var(--r-3)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
          <PGSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Switch to branch…"
            inputRef={inputRef}
          />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {local.length === 0 && remote.length === 0 ? (
            <div
              style={{
                padding: 12,
                fontSize: "var(--fs-12)",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {query
                ? `No branches match "${query}".`
                : "No branches in this repo."}
              <div style={{ marginTop: 8 }}>
                <span
                  data-testid="branch-create"
                  onClick={() => requestCreate(query.trim() || "main")}
                  style={{
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {query.trim()
                    ? `Create branch "${query.trim()}" from HEAD`
                    : `Create branch "main" from HEAD`}
                </span>
              </div>
            </div>
          ) : (
            <>
              {local.length > 0 && (
                <>
                  {sectionHeader("Local", local.length)}
                  {localRows.map((r, i) => renderRow(r, i))}
                </>
              )}
              {remote.length > 0 && (
                <>
                  {sectionHeader("Remote", remote.length)}
                  {remoteRows.map((r, i) => renderRow(r, localRows.length + i))}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {localMenu}
      {remoteMenu}
    </>
  );

  return ReactDOM.createPortal(content, document.body);
}
