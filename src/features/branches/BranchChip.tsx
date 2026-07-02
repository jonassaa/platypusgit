import React from "react";
import { PGIcon, useContextMenu, branchMenuItems } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch, totalAheadBehind } from "@/lib/derive";
import type { BranchInfo } from "@/lib/types";

interface BranchChipProps {
  onClick: (anchor: HTMLElement) => void;
}

export function BranchChip({ onClick }: BranchChipProps) {
  const branches = useRepoStore((s) => s.branches);
  const repo = useRepoStore((s) => s.current);
  const head = currentBranch(branches);
  const { ahead, behind } = totalAheadBehind(branches);
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement | null>(null);

  const { onContextMenu, menu } = useContextMenu<BranchInfo | null>((b) =>
    branchMenuItems({
      name: b?.name,
      current: true,
      upstream: b?.upstream,
    }),
  );

  if (!repo) return null;

  const label = head ? head.name : "(detached)";
  const detail = head ? null : repo.head?.slice(0, 7) ?? null;

  return (
    <>
      <button
        ref={ref}
        data-testid="branch-chip"
        onClick={() => ref.current && onClick(ref.current)}
        onContextMenu={(e) => onContextMenu(e, head ?? null)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: hover ? "var(--bg-2)" : "transparent",
          border: "1px solid transparent",
          borderColor: hover ? "var(--border-0)" : "transparent",
          borderRadius: "var(--r-2)",
          padding: "2px 6px",
          cursor: "pointer",
          color: "var(--accent)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          maxWidth: 280,
        }}
        title={label}
      >
        <PGIcon name="branch" size={12} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {detail && (
          <span style={{ color: "var(--fg-3)", fontSize: "var(--fs-11)" }}>
            {detail}
          </span>
        )}
        {ahead > 0 && (
          <span style={{ color: "var(--git-added)", fontSize: "var(--fs-10)" }}>
            ↑{ahead}
          </span>
        )}
        {behind > 0 && (
          <span
            style={{ color: "var(--git-modified)", fontSize: "var(--fs-10)" }}
          >
            ↓{behind}
          </span>
        )}
        <PGIcon
          name="chevronDown"
          size={10}
          style={{
            color: "var(--fg-3)",
            opacity: hover ? 1 : 0,
            transition: "opacity var(--t-fast)",
          }}
        />
      </button>
      {menu}
    </>
  );
}
