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
  /**
   * The prompt was closed with no answer — Cancel, Escape or the backdrop
   * (#212).
   *
   * Supplied by whoever raised it, for the same reason `retry` is: the store
   * does not know what was being attempted. Without it a dismissal was
   * SILENT — `withAuthRetry` had already cleared the activity label and
   * swallowed the original error, so a cancelled push left no banner, no
   * spinner and no status line, and looked exactly like a push that worked.
   *
   * The rule `pgConfirm`/`pgPrompt`/`pgChoose` follow: a dismissal is "no
   * answer", never an answer — so it reports the failure that raised the
   * prompt rather than retrying anything.
   */
  onDismiss?: () => void | Promise<void>;
}

interface AuthStoreState {
  /** At most one challenge at a time: a second would fight the first for focus. */
  challenge: AuthChallengeRequest | null;
  raise: (c: AuthChallengeRequest) => void;
  /**
   * The dialog has taken the credential and is handing it to `retry`. Clears
   * the prompt WITHOUT firing `onDismiss` — an answered prompt is not a
   * cancelled one, and reporting the original failure here would raise a
   * banner about the very error the retry is in the middle of fixing.
   */
  answer: () => void;
  /** Closed with no answer. Clears the prompt and fires `onDismiss`. */
  dismiss: () => Promise<void>;
}

/**
 * Holds the pending credential challenge.
 *
 * Deliberately does NOT hold the secret: that lives in the dialog's component
 * state and is handed straight to the retry, so nothing sensitive sits in a
 * global store where a devtools snapshot or a future persistence middleware
 * could pick it up.
 */
export const useAuthStore = create<AuthStoreState>((set, get) => ({
  challenge: null,
  raise: (challenge) => set({ challenge }),
  answer: () => set({ challenge: null }),
  // Cleared BEFORE `onDismiss` runs, and read from the store rather than from a
  // closure: the callback reports a failure, which can re-render anything, and
  // a challenge still standing then would be a prompt for an op nobody is
  // waiting on. Reading it first also makes a second dismiss a no-op.
  dismiss: async () => {
    const pending = get().challenge;
    set({ challenge: null });
    await pending?.onDismiss?.();
  },
}));
