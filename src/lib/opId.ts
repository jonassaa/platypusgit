/**
 * Ids for cancellable backend operations (#234).
 *
 * # Why the frontend mints them
 *
 * The operation we most need to cancel is the one that never answers, so an id
 * assigned by the backend and emitted back would leave a window — unbounded, for
 * exactly the hang this exists for — in which the op is running and nothing can
 * address it. Minting the id before the invoke makes the cancel button live from
 * the first frame.
 *
 * # Why not `crypto.randomUUID()`
 *
 * It is only defined in a secure context, and whether a webview treats the app's
 * custom protocol as one is a per-platform detail we do not control. A missing
 * `randomUUID` would throw inside the click handler that starts a fetch, so the
 * feature would cost us the fetch. `Date.now()` + `Math.random()` is not a UUID
 * and does not need to be: the id only has to be unique among the handful of ops
 * one app process has in flight, and it is never persisted, compared across
 * machines, or used as a secret.
 *
 * The kind is carried in the id purely so a log line or an IPC trace reads as
 * `fetch-…` rather than an opaque token.
 */
export function newOpId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
