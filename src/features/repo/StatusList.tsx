import {
  CircleAlert,
  CircleDot,
  FileDiff,
  FileMinus,
  FilePlus,
  FileQuestion,
  FileX,
  HelpCircle,
  ArrowRightLeft,
} from "lucide-react";
import type { ComponentType } from "react";
import type { FileStatus, StatusFlag } from "@/lib/types";
import { useRepoStore } from "./useRepoStore";

type IconC = ComponentType<{ size?: number; className?: string }>;

const FLAG_META: Record<
  StatusFlag["kind"],
  { icon: IconC; label: string; color: string }
> = {
  Unmodified: {
    icon: CircleDot,
    label: "unmodified",
    color: "text-[var(--color-text-dim)]",
  },
  Modified: { icon: FileDiff, label: "modified", color: "text-yellow-400" },
  Added: { icon: FilePlus, label: "added", color: "text-green-400" },
  Deleted: { icon: FileMinus, label: "deleted", color: "text-red-400" },
  Renamed: {
    icon: ArrowRightLeft,
    label: "renamed",
    color: "text-blue-400",
  },
  Typechange: {
    icon: HelpCircle,
    label: "typechange",
    color: "text-purple-400",
  },
  Untracked: {
    icon: FileQuestion,
    label: "untracked",
    color: "text-[var(--color-accent)]",
  },
  Ignored: {
    icon: FileX,
    label: "ignored",
    color: "text-[var(--color-text-dim)]",
  },
  Conflicted: {
    icon: CircleAlert,
    label: "conflicted",
    color: "text-red-500",
  },
};

function StatusRow({ entry }: { entry: FileStatus }) {
  const primary =
    entry.worktree.kind !== "Unmodified" ? entry.worktree : entry.index;
  const meta = FLAG_META[primary.kind];
  const Icon = meta.icon;
  return (
    <li className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--color-border)] text-sm hover:bg-[var(--color-bg-elev)]">
      <Icon size={14} className={meta.color} />
      <span className="font-mono text-[var(--color-text)] truncate flex-1">
        {entry.path}
      </span>
      <span className={`text-xs ${meta.color}`}>{meta.label}</span>
    </li>
  );
}

export function StatusList() {
  const status = useRepoStore((s) => s.status);
  const loading = useRepoStore((s) => s.loading);
  const current = useRepoStore((s) => s.current);

  if (!current) return null;

  if (loading && status.length === 0) {
    return (
      <div className="p-4 text-[var(--color-text-dim)]">Loading…</div>
    );
  }

  if (status.length === 0) {
    return (
      <div className="p-4 text-[var(--color-text-dim)]">
        Working tree clean.
      </div>
    );
  }

  return (
    <ul className="border border-[var(--color-border)] rounded-md overflow-hidden">
      {status.map((entry) => (
        <StatusRow key={entry.path} entry={entry} />
      ))}
    </ul>
  );
}
