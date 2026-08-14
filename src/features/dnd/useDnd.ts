/**
 * The two hooks a screen imports. Everything else in `features/dnd` is
 * machinery — see `dragController.ts` for the gesture and the performance
 * contract that shapes it.
 */

import React from "react";
import {
  beginDrag,
  registerZone,
  useDragStore,
  __dnd,
  type DropZoneSpec,
} from "./dragController";
import type { DragPayload } from "./types";

/**
 * Make a CONTAINER a drag source for the rows inside it.
 *
 * `make` is handed the element the pointer went down on and returns the payload,
 * or null for "not a draggable spot". Delegating from the container is what lets
 * `PGChangeRow`, `PGFileTreeRow` and `PGCommitRow` stay untouched: they already
 * carry `data-path` / `data-sha`, so no prop is threaded and no memoized row
 * gains a per-row closure (#68 G9).
 */
export function useDragSource(
  make: (target: HTMLElement, e: React.PointerEvent) => DragPayload | null,
): {
  onPointerDown: (e: React.PointerEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  "data-pg-drag-source": string;
} {
  const makeRef = React.useRef(make);
  makeRef.current = make;
  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const payload = makeRef.current(target, e);
    if (payload) beginDrag(e, payload);
  }, []);
  return {
    onPointerDown,
    onDragStart: __dnd.onDragStart as unknown as (e: React.DragEvent) => void,
    "data-pg-drag-source": "",
  };
}

/**
 * Make an element a drop zone.
 *
 * `isOver` is true while the pointer is inside this zone during an accepted
 * drag — one subscription per ZONE, flipping only when the pointer crosses a
 * zone boundary. `active` is true while any drag this zone accepts is in flight,
 * which is how the RepoBrowser's Stage/Unstage bar knows to exist at all.
 *
 * Row-level highlighting is NOT React state: the controller writes
 * `data-pg-drop-over` onto the element `spec.resolve` picked.
 */
export function useDropZone(spec: DropZoneSpec): {
  ref: (el: HTMLElement | null) => void;
  isOver: boolean;
  active: boolean;
} {
  const specRef = React.useRef(spec);
  specRef.current = spec;
  const unregister = React.useRef<(() => void) | null>(null);
  const id = spec.id;

  const ref = React.useCallback(
    (el: HTMLElement | null) => {
      unregister.current?.();
      unregister.current = null;
      if (!el) return;
      el.setAttribute("data-pg-drop-id", id);
      unregister.current = registerZone(id, { el, spec: specRef });
    },
    [id],
  );

  React.useEffect(() => () => unregister.current?.(), []);

  const isOver = useDragStore((s) => s.overId === id && s.payload !== null);
  const active = useDragStore((s) =>
    s.payload ? specRef.current.accepts(s.payload) : false,
  );
  return { ref, isOver, active };
}
