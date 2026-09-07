import { create } from "zustand";

/**
 * Whether the report dialog is open, and what the summary box starts with.
 *
 * App-level rather than per-repo, so it stays out of `RepoSlice`/`emptySlice`:
 * those exist for state that must be DROPPED on a tab switch, and "is the
 * report dialog open" is not about a repository at all.
 *
 * `seed` exists because two of the four entry points already know something
 * the user would otherwise retype — the error banner has the error text, and
 * the error boundary has the render throw's message. The two that do not
 * (the titlebar, Settings) call `openReport()` with no argument.
 */
interface ReportState {
  open: boolean;
  seed: string;
  openReport: (seed?: string) => void;
  closeReport: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  open: false,
  seed: "",
  openReport: (seed = "") => set({ open: true, seed }),
  closeReport: () => set({ open: false }),
}));
