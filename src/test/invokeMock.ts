// Per-test invoke() mock. vi.mock in setup.ts rewires `@tauri-apps/api/core`
// so every component under test calls through this registry.
//
// Usage in a test:
//   import { mockInvoke } from "@/test/invokeMock";
//   mockInvoke("get_status", () => []);
//
// Handlers are reset between tests via the afterEach in setup.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;
type Handler<T = unknown> = (args: Args) => T | Promise<T>;

const handlers = new Map<string, Handler<unknown>>();
const calls: Array<{ cmd: string; args: Args }> = [];

export function mockInvoke<T>(cmd: string, handler: Handler<T>): void {
  handlers.set(cmd, handler as Handler<unknown>);
}

export function getInvokeCalls(): ReadonlyArray<{ cmd: string; args: Args }> {
  return calls;
}

export function resetInvokeMock(): void {
  handlers.clear();
  calls.length = 0;
}

export async function invoke<T>(cmd: string, args?: Args): Promise<T> {
  const resolved = args ?? {};
  calls.push({ cmd, args: resolved });
  const h = handlers.get(cmd);
  if (!h) {
    throw new Error(
      `[invokeMock] no handler registered for "${cmd}". ` +
        `Call mockInvoke("${cmd}", …) in your test setup.`,
    );
  }
  return (await h(resolved)) as T;
}
