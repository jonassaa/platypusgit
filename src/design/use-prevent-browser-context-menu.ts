import { useEffect } from "react";

/**
 * Attach a document-level contextmenu listener that swallows the native
 * browser menu. Custom menu handlers mounted on specific elements must call
 * `e.stopPropagation()` (as `useContextMenu` already does) — bubble-phase
 * ordering means those run first and this handler never sees the event.
 */
export function usePreventBrowserContextMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);
}
