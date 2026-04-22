import { create } from "zustand";
import {
  loadRecents,
  pushRecent,
  removeRecent,
  saveRecents,
  type RecentRepo,
} from "@/lib/recents";

interface RecentsState {
  recents: RecentRepo[];
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecents: () => void;
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: loadRecents(),
  addRecent(path) {
    const next = pushRecent(get().recents, path);
    saveRecents(next);
    set({ recents: next });
  },
  removeRecent(path) {
    const next = removeRecent(get().recents, path);
    saveRecents(next);
    set({ recents: next });
  },
  clearRecents() {
    saveRecents([]);
    set({ recents: [] });
  },
}));
