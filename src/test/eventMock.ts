// Per-test mock of @tauri-apps/api/event. Register listeners via the mocked
// listen(); fire them from tests with emitMockEvent(). Reset in setup.ts.

type Handler = (event: { payload: unknown }) => void;

const listeners = new Map<string, Set<Handler>>();

export async function listen(
  event: string,
  handler: Handler,
): Promise<() => void> {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}

// The merge resolver window emits cross-window events (merge://resolved,
// merge://open-file). Component tests don't mount both windows, so a resolved
// no-op is enough — tests assert IPC/DOM effects, not the emit itself.
export async function emit(_event: string, _payload?: unknown): Promise<void> {}

export function emitMockEvent(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((h) => h({ payload }));
}

export function resetEventMock(): void {
  listeners.clear();
}
