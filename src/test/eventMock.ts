// Per-test mock of @tauri-apps/api/event. Register listeners via the mocked
// listen(); fire them from tests with emitMockEvent(). Reset in setup.ts.

type Handler = (event: { payload: unknown }) => void;

/** A listener's target, as `@tauri-apps/api/event` spells it. `undefined` is
 *  the default `EventTarget::Any` — see `features/windows/windowEvents.ts` for
 *  why a window ever passes one. */
type Target = string | { kind: string; label?: string } | undefined;

interface Entry {
  handler: Handler;
  target: Target;
}

const listeners = new Map<string, Set<Entry>>();

function labelOf(target: Target): string | null {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") return target.label ?? null;
  return null;
}

export async function listen(
  event: string,
  handler: Handler,
  options?: { target?: Target },
): Promise<() => void> {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  const entry: Entry = { handler, target: options?.target };
  set.add(entry);
  return () => {
    set.delete(entry);
  };
}

// The merge resolver window emits cross-window events (merge://resolved,
// merge://open-file). Component tests don't mount both windows, so a resolved
// no-op is enough — tests assert IPC/DOM effects, not the emit itself.
export async function emit(_event: string, _payload?: unknown): Promise<void> {}

/** A broadcast: `app.emit` in Rust. Reaches every listener, targeted or not —
 *  Tauri's `emit` runs with no filter. */
export function emitMockEvent(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((e) => e.handler({ payload }));
}

/**
 * An addressed emit: `app.emit_to(label, …)` in Rust.
 *
 * Reaches a listener that named this label, and — faithfully to Tauri — one
 * that named no target at all, because an `EventTarget::Any` listener matches
 * every emit. That second half is the trap `listenToThisWindow` exists for, so
 * the mock has to reproduce it or a test for the fix would pass either way.
 */
export function emitMockEventTo(
  label: string,
  event: string,
  payload: unknown,
): void {
  listeners.get(event)?.forEach((e) => {
    const listenerLabel = labelOf(e.target);
    if (listenerLabel === null || listenerLabel === label) e.handler({ payload });
  });
}

export function resetEventMock(): void {
  listeners.clear();
}
