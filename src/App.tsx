import { GitBranch } from "lucide-react";
import { OpenRepoButton } from "@/features/repo/OpenRepoButton";
import { StatusList } from "@/features/repo/StatusList";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { appErrorMessage } from "@/lib/errors";

export default function App() {
  const current = useRepoStore((s) => s.current);
  const error = useRepoStore((s) => s.error);
  const clearError = useRepoStore((s) => s.clearError);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <GitBranch size={18} className="text-[var(--color-accent)]" />
        <span className="font-semibold">platypusgit</span>
        <span className="text-[var(--color-text-dim)] text-sm font-mono truncate flex-1">
          {current?.path ?? "no repository open"}
        </span>
        <OpenRepoButton />
      </header>

      <main className="flex-1 p-4 overflow-auto">
        {error && (
          <div
            className="mb-3 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-red-200 text-sm flex items-center justify-between"
            role="alert"
          >
            <span>
              <strong>{error.kind}:</strong> {appErrorMessage(error)}
            </span>
            <button
              className="text-red-200/70 hover:text-red-100 text-xs"
              onClick={clearError}
            >
              dismiss
            </button>
          </div>
        )}

        {!current && !error && (
          <div className="flex items-center justify-center h-full text-[var(--color-text-dim)]">
            Open a repository to get started.
          </div>
        )}

        {current && <StatusList />}
      </main>
    </div>
  );
}
