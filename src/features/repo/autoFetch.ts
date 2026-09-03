/**
 * The auto-fetch timer, and the one deadline in the app (#234, #263 item 5).
 *
 * Its own module rather than an effect body in `AppShell`, for the same reason
 * `repoActivity` is not inside `useRepoStore`: the interesting part is a
 * *policy* — which fetches may be killed on a clock and which may never be —
 * and a policy that lives inside a `useEffect` cannot be tested without
 * rendering the whole shell.
 *
 * ## Why there is a deadline here and nowhere else
 *
 * #260 considered a global timeout on network ops and rejected it, correctly: a
 * timeout short enough to rescue a host that accepts the TCP connection and
 * then says nothing is also short enough to kill a legitimately slow clone of a
 * large repository, and only the person watching it can tell those two apart.
 * Every interactive op keeps that deal — no timeout, a Cancel button instead.
 *
 * The argument does not cover the fetches the TIMER started. Nobody is watching
 * those, so for them a stall is indistinguishable from a hang; and the
 * skip-while-running guard below (which exists so a stalled remote cannot grow
 * a pile of stuck `git fetch` processes) means ONE stalled auto-fetch turns
 * auto-fetch off for the rest of the session. A deadline scoped to timer-started
 * fetches unsticks that without touching the interactive deal.
 *
 * ## What makes it impossible for a user's fetch to inherit
 *
 * Nothing arms a deadline except a tick that itself started the fetch. A tick
 * that finds `activity.fetch` already set — which is precisely what a fetch
 * somebody else started looks like — returns without arming anything. And the
 * armed timer is disarmed the moment the fetch it belongs to settles, then
 * checks the entry's `startedAt` before firing, so a later, unrelated fetch
 * cannot be mistaken for the one the deadline was armed for.
 *
 * The cancel itself is `cancel::Scope::Repo`-wide, as every cancel in this app
 * is: it reaches every network op on the repository, which is the whole point of
 * scope keying (#260) and the only thing that can clear the stacked-auto-fetch
 * pile. So a fetch the user started *while a timer fetch was already stalled*
 * does share the stalled op's fate — but it was already sharing its scope, and
 * that pile is exactly what "Cancel" next to a stuck status line has to mean.
 */

import { useRepoStore } from "./useRepoStore";

/**
 * How long a timer-started fetch may run before it is cancelled.
 *
 * Two minutes is far longer than any healthy fetch and far shorter than a
 * session: the point is not to be a timeout, it is to make sure the *next* tick
 * has something to do. A stalled auto-fetch is unstuck within one deadline
 * rather than never.
 */
export const AUTO_FETCH_DEADLINE_MS = 2 * 60_000;

/**
 * Start fetching every `minutes` minutes. Returns a disposer that stops the
 * timer AND disarms any deadline it has armed.
 *
 * `Math.max(1, …)` mirrors the settings clamp: a zero here would be a fetch
 * every tick of the event loop.
 */
export function startAutoFetch(minutes: number): () => void {
  /** The deadline armed for the fetch this timer most recently started. */
  let armed: number | null = null;
  const disarm = () => {
    if (armed !== null) {
      window.clearTimeout(armed);
      armed = null;
    }
  };

  const tick = () => {
    const store = useRepoStore.getState();
    const repo = store.current;
    if (!repo) return;
    // Skip the tick while a fetch is still running (#234). A remote that stalls
    // outlives the interval, and every tick used to start ANOTHER `git fetch`
    // against it — a pile of stuck processes the user never asked for, growing
    // until the app is quit. Nothing is lost by skipping: the next tick fetches,
    // and a fetch is idempotent.
    //
    // This is also the line that keeps the deadline off other people's fetches:
    // an entry that is already here belongs to somebody else's op, and this
    // function returns before arming anything.
    if (store.activity.fetch) return;

    const running = store.fetchAll();
    // `withAuthRetry` opens the indicator synchronously, before its first
    // await, so the entry this tick just created is already readable here.
    // Absent means the op was over before it began (no repository), and there
    // is nothing to put a deadline on.
    const startedAt = useRepoStore.getState().activity.fetch?.startedAt;
    if (startedAt === undefined) return;

    const deadline = window.setTimeout(() => {
      if (armed === deadline) armed = null;
      const live = useRepoStore.getState();
      // The op outlives a tab switch but its `activity` entry does not, and
      // `cancelNetworkOps` addresses whichever repository is open NOW — firing
      // after a switch would cancel the other tab's ops instead of this one's.
      if (live.current?.id !== repo.id) return;
      // Still the very fetch this deadline was armed for, and still running.
      if (live.activity.fetch?.startedAt !== startedAt) return;
      void live.cancelNetworkOps();
    }, AUTO_FETCH_DEADLINE_MS);
    disarm();
    armed = deadline;

    // The load-bearing half of "a user's fetch cannot inherit this": the
    // deadline dies with the op it was armed for, whatever the outcome.
    void running.finally(() => {
      window.clearTimeout(deadline);
      if (armed === deadline) armed = null;
    });
  };

  const interval = window.setInterval(tick, Math.max(1, minutes) * 60_000);
  return () => {
    window.clearInterval(interval);
    disarm();
  };
}
