/**
 * Give jsdom a layout, for the tests that need one.
 *
 * jsdom performs no layout, so `clientWidth` / `clientHeight` are 0 for every
 * element — which is the "unmeasured container" case `usePaneSize` deliberately
 * treats as "no constraint known" (#162). That makes the default jsdom run the
 * right harness for the unmeasured path and useless for the clamped one, so a
 * test that wants the clamp has to say what the container measures.
 *
 * Patches the prototype rather than one node because the element under test is
 * reached through a ref callback, so there is nothing to patch before render.
 * Always call the returned restore in a `finally` — a leaked getter makes every
 * later test in the file think it has a viewport.
 */
export function stubContainerSize(size: {
  width?: number;
  height?: number;
}): () => void {
  const patched: Array<"clientWidth" | "clientHeight"> = [];
  const define = (prop: "clientWidth" | "clientHeight", value: number) => {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get: () => value,
    });
    patched.push(prop);
  };
  if (size.width !== undefined) define("clientWidth", size.width);
  if (size.height !== undefined) define("clientHeight", size.height);
  return () => {
    for (const prop of patched) {
      // Deleting the own property exposes jsdom's Element.prototype getter again.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  };
}

/** `stubContainerSize` for the common width-only case. */
export const stubContainerWidth = (width: number) =>
  stubContainerSize({ width });
