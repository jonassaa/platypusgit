import { create } from "zustand";
import { appErrorMessage } from "@/lib/errors";
import { sshKeyGenerate, sshKeyStatus } from "@/lib/tauri";
import type { ForgeKind, SshKeyGenerateRequest, SshKeyInfo, SshKeyStatus } from "@/lib/types";

interface SshKeyStoreState {
  status: SshKeyStatus | null;
  loading: boolean;
  generating: boolean;
  /** The pair this session just made, so the panel can lead with it. */
  generated: SshKeyInfo | null;
  error: string | null;
  load: (host?: string | null, kind?: ForgeKind | null) => Promise<void>;
  generate: (request: SshKeyGenerateRequest) => Promise<SshKeyInfo | null>;
  reset: () => void;
}

/**
 * SSH keys on this machine (#248).
 *
 * **Its own store, deliberately.** Not `useRepoStore`: a key belongs to the
 * machine and the user, so a per-repo field would have to join `RepoSlice` and
 * would then be cleared and re-fetched on every tab switch for no reason. Not
 * `useAuthStore` either — that holds exactly one pending challenge and the
 * comment above it says why it holds nothing else.
 *
 * **It never holds a passphrase.** Same rule as `CredentialDialog`'s secret: the
 * passphrase is component state, handed straight to `generate` and gone when
 * the call resolves, so nothing sensitive sits where a devtools snapshot or a
 * future persistence middleware could reach it. `generate` takes the request
 * and does not keep it.
 *
 * `error` is a plain string, not an `AppError`: this store has no catch arm that
 * narrows on `kind`, and the panel renders prose. Both refusals worth acting on
 * — an existing key, a missing `ssh-keygen` — are already reachable from the
 * status payload (`suggestedName`, `canGenerate`), so nothing here needs the
 * discriminant.
 */
export const useSshKeyStore = create<SshKeyStoreState>((set) => ({
  status: null,
  loading: false,
  generating: false,
  generated: null,
  error: null,

  load: async (host, kind) => {
    set({ loading: true, error: null });
    try {
      const status = await sshKeyStatus(host ?? null, kind ?? null);
      set({ status, loading: false });
    } catch (e) {
      // A panel that cannot list keys is still a panel that can say why, so the
      // failure lands in `error` rather than throwing into the dialog's render.
      set({ loading: false, error: appErrorMessage(e) });
    }
  },

  generate: async (request) => {
    set({ generating: true, error: null });
    try {
      const key = await sshKeyGenerate(request);
      set({ generating: false, generated: key });
      // Re-read rather than splicing the new key into the list: the suggested
      // name has to move on, and the backend is the only thing that knows what
      // is now free.
      const host = useSshKeyStore.getState().status?.host ?? null;
      try {
        const status = await sshKeyStatus(host);
        set({ status });
      } catch {
        // The key exists; a stale list is not worth replacing a success with a
        // failure over.
      }
      return key;
    } catch (e) {
      set({ generating: false, error: appErrorMessage(e) });
      return null;
    }
  },

  reset: () => set({ status: null, loading: false, generating: false, generated: null, error: null }),
}));
