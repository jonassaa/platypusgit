import { create } from "zustand";
import type { AuthKind } from "@/lib/errors";
import type { Credentials } from "@/lib/tauri";

/**
 * One pending credential request (#61 D5).
 *
 * `retry` is supplied by whichever action failed, so the store stays ignorant of
 * what operation is being retried — it only knows how to ask.
 */
export interface AuthChallengeRequest {
  host: string | null;
  kind: AuthKind;
  /**
   * `undefined` means "run it again with no credential at all" — the
   * prompt-less first attempt, repeated.
   *
   * Not a loophole: it is what a retry MEANS after SSH key setup (#248). The
   * user generated a key and registered it with the host; there is no secret to
   * type, and the very attempt that just failed is now the one that succeeds.
   * `withAuthRetry`'s `attempt` has always taken an optional credential — this
   * only stops the dialog having to invent one.
   */
  retry: (creds: Credentials | undefined, remember: boolean) => Promise<void>;
}

interface AuthStoreState {
  /** At most one challenge at a time: a second would fight the first for focus. */
  challenge: AuthChallengeRequest | null;
  raise: (c: AuthChallengeRequest) => void;
  dismiss: () => void;
}

/**
 * Holds the pending credential challenge.
 *
 * Deliberately does NOT hold the secret: that lives in the dialog's component
 * state and is handed straight to the retry, so nothing sensitive sits in a
 * global store where a devtools snapshot or a future persistence middleware
 * could pick it up.
 */
export const useAuthStore = create<AuthStoreState>((set) => ({
  challenge: null,
  raise: (challenge) => set({ challenge }),
  dismiss: () => set({ challenge: null }),
}));
