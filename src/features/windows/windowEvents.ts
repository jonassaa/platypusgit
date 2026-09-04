// Listening for an event that was sent to THIS window (#256).
//
// ## Why a plain `listen()` is not enough
//
// The JS `listen(event, handler)` registers with `EventTarget::Any`, and
// Tauri's listener filter short-circuits on it:
//
//     *target == EventTarget::Any || filter(...)      // event/listener.rs
//
// so an `Any` listener matches EVERY emit, including a Rust
// `emit_to("main", …)` that names one window. With one window that distinction
// never mattered. With several it is the whole feature: a forwarded
// `pgit ~/repo` routed to one window would be received by all of them, and
// every window would open the repository — which is exactly the behaviour
// `WindowRegistry::route` exists to replace.
//
// Passing this window's own label as the target fixes it in both directions,
// because `emit_to`'s own filter (`filter_target`, manager/mod.rs) matches an
// `AnyLabel` emit against an `AnyLabel` listener by label:
//
//   - a global `app.emit(…)` still arrives — `emit` runs with no filter at all,
//     so broadcasts like `fs://changed` and `net://progress` are unaffected;
//   - an `emit_to(<other label>, …)` no longer does.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { windowLabel } from "./useWindowLifecycle";

/**
 * Subscribe to `event`, but only for emits addressed to this window (plus
 * genuine broadcasts). Same signature as `listen` so a call site swaps in
 * place.
 */
export function listenToThisWindow<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, handler, { target: windowLabel() });
}
