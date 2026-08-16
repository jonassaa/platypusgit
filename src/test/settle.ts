// Settling a diff pane in component tests.
//
// Shared rather than copied: this guard is subtle enough that a second copy
// drifts, and it is needed by every test that drives a diff surface the moment
// its rows appear (CommitPanel's line-staging and line-focus suites today).

import { act } from "@testing-library/react";
import { getInvokeCalls } from "./invokeMock";

/**
 * Wait until the pane has stopped refetching its diff AND React has run the
 * effects that arrival scheduled.
 *
 * Mounting produces more than one `get_diff`, and EVERY new diff resets the line
 * cursor and clears the line selection by design — the indices would otherwise
 * address a diff that no longer exists. Driving the pane before that settles lets
 * a late resolution wipe the cursor mid-test.
 *
 * The second half matters just as much and is far less obvious. `findAllByTestId`
 * resolves at the COMMIT of the render that first paints the rows, not at the end
 * of it: React posts passive effects on its own task queue, and RTL's async
 * helpers only drain a timer task, so under load the timer can win and the
 * diff-keyed reset effect is still PENDING. `fireEvent` is act-wrapped and React
 * flushes pending passive effects before it renders, so the stale reset and the
 * interaction's own update coalesce into ONE render, applied in queue order — the
 * reset lands last and the interaction silently never happened. `act` queues
 * behind React's own task instead, so the effects are flushed first.
 *
 * Raising a `waitFor` timeout does NOT help: by the time it starts polling the
 * state is already final and wrong, so more time only makes the failure slower.
 */
export async function settleDiff(): Promise<void> {
  const count = () => getInvokeCalls().filter((c) => c.cmd === "get_diff").length;
  let prev = -1;
  while (prev !== count()) {
    prev = count();
    // One macrotask turn per pass: enough for a pending fetch to resolve and for
    // the effect its result triggers to queue another.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
