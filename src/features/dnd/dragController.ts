/**
 * The drag gesture, once, for every surface that transfers a payload from one
 * place to another (staging, the History graph). Row *reordering* is a different
 * gesture and lives in `useRowReorder` — see the design doc's decision section.
 *
 * Built on pointer events, not HTML5 drag-and-drop:
 *   - `useRowReorder` already set that precedent, so there is one model.
 *   - WebDriver cannot synthesize an HTML5 drag session and jsdom has no
 *     `DataTransfer`; pointer sequences are drivable from both test layers.
 *   - An HTML5 drag hands the gesture to the platform: OS cursors, an unthemable
 *     drag image, and WebKit starting its own drag off a text/link/image
 *     selection underneath ours.
 *
 * PERFORMANCE CONTRACT — this is why the module looks the way it does. History's
 * commit list is windowed and its rows are `React.memo`'d (#68 G9/G10). So:
 *   - hover indication is a DOM attribute (`data-pg-drop-over`) the controller
 *     writes directly, NOT React state. Zero renders per pointer move.
 *   - the ghost is a raw DOM node moved by `style.transform`, not a component.
 *   - the store holds only `payload` (flips twice per gesture) and `overId` (the
 *     ZONE id, so a zone can render a caption). No row subscribes to either.
 */

import { create } from "zustand";
import type { DragPayload, DropResolution } from "./types";

/** Below this the gesture is still a click, so a row's own select still fires. */
const DRAG_SLOP = 4;
/** Offset of the ghost from the pointer, so it never sits under the cursor. */
const GHOST_DX = 14;
const GHOST_DY = 12;

export interface DropZoneSpec {
  id: string;
  /** Zone-level gate. Return false and the zone is invisible to this drag. */
  accepts: (p: DragPayload) => boolean;
  /**
   * Delegated mode: what does the element under the pointer mean? Omit for a
   * zone that IS one drop target — the zone element resolves to `{ key: "" }`.
   *
   * Returning a resolution with a `reason` marks it a rejection: the ghost says
   * why and the drop does nothing.
   */
  resolve?: (el: HTMLElement, p: DragPayload) => DropResolution | null;
  onDrop: (p: DragPayload, key: string) => void;
  /**
   * Released on a rejected resolution. The ghost already carried the reason
   * mid-gesture; this is for the user who let go without reading it, so a
   * refused drop is never silence.
   */
  onReject?: (p: DragPayload, reason: string) => void;
}

interface ZoneEntry {
  el: HTMLElement;
  /** Read through a ref so a re-render's fresh closures are always current. */
  spec: { current: DropZoneSpec };
}

const zones = new Map<string, ZoneEntry>();

export function registerZone(id: string, entry: ZoneEntry): () => void {
  zones.set(id, entry);
  return () => {
    if (zones.get(id) === entry) zones.delete(id);
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface DragStoreState {
  /** Non-null only once the gesture passed the slop. */
  payload: DragPayload | null;
  /** Zone the pointer is inside, whether or not the resolution is legal. */
  overId: string | null;
}

export const useDragStore = create<DragStoreState>(() => ({
  payload: null,
  overId: null,
}));

/** Is a drag this predicate accepts currently in flight? */
export function useDragActive(accepts: (p: DragPayload) => boolean): boolean {
  return useDragStore((s) => (s.payload ? accepts(s.payload) : false));
}

// ─── Ghost ───────────────────────────────────────────────────────────────────

let ghost: HTMLElement | null = null;

function showGhost(label: string, x: number, y: number) {
  ghost = document.createElement("div");
  ghost.className = "pg-drag-ghost";
  ghost.setAttribute("data-testid", "drag-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = label;
  moveGhost(x, y);
  document.body.appendChild(ghost);
}

function moveGhost(x: number, y: number) {
  if (ghost) ghost.style.transform = `translate(${x + GHOST_DX}px, ${y + GHOST_DY}px)`;
}

function setGhostVerdict(label: string, ok: boolean) {
  if (!ghost) return;
  ghost.textContent = label;
  ghost.setAttribute("data-drop", ok ? "ok" : "no");
}

function removeGhost() {
  ghost?.remove();
  ghost = null;
}

// ─── Gesture ─────────────────────────────────────────────────────────────────

interface Gesture {
  pointerId: number;
  payload: DragPayload;
  startX: number;
  startY: number;
  moved: boolean;
  /** Element currently carrying `data-pg-drop-over`. */
  marked: HTMLElement | null;
  /** The standing resolution — what a pointerup would commit. */
  hit: { zone: ZoneEntry; res: DropResolution } | null;
  /** The standing REFUSAL, kept so releasing on it can still explain itself. */
  reject: { zone: ZoneEntry; reason: string } | null;
}

let gesture: Gesture | null = null;

const CONTROLS = "button, select, textarea, input, a, [contenteditable]";

function zoneFor(el: HTMLElement | null): ZoneEntry | null {
  const host = el?.closest?.("[data-pg-drop-id]") as HTMLElement | null;
  if (!host) return null;
  const id = host.getAttribute("data-pg-drop-id");
  const entry = id ? zones.get(id) : null;
  return entry && entry.el === host ? entry : null;
}

/**
 * The element under the pointer. `e.target` first: that is what a synthesized
 * RTL or e2e event carries, and it is already correct for a real move (we never
 * take pointer capture, so the target follows the cursor). `elementFromPoint` is
 * the coordinate fallback — and is absent in jsdom, hence the guard.
 */
function elementUnder(e: PointerEvent): HTMLElement | null {
  const t = e.target as HTMLElement | null;
  if (t && typeof t.closest === "function" && t.isConnected) return t;
  try {
    return (document.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement) ?? null;
  } catch {
    return null;
  }
}

function mark(g: Gesture, el: HTMLElement | null) {
  if (g.marked === el) return;
  g.marked?.removeAttribute("data-pg-drop-over");
  g.marked = el;
  el?.setAttribute("data-pg-drop-over", "");
}

function resolveAt(g: Gesture, e: PointerEvent) {
  const under = elementUnder(e);
  const zone = zoneFor(under);
  g.hit = null;
  g.reject = null;
  if (!zone || !zone.spec.current.accepts(g.payload)) {
    mark(g, null);
    if (useDragStore.getState().overId !== null) useDragStore.setState({ overId: null });
    setGhostVerdict(g.payload.label, false);
    return;
  }
  const spec = zone.spec.current;
  const res = spec.resolve
    ? spec.resolve(under ?? zone.el, g.payload)
    : { key: "", el: zone.el };
  if (useDragStore.getState().overId !== spec.id) useDragStore.setState({ overId: spec.id });
  if (!res) {
    mark(g, null);
    setGhostVerdict(g.payload.label, false);
    return;
  }
  if (res.reason) {
    // A rejection is shown, not hidden: the user learns why mid-gesture instead
    // of releasing onto nothing and guessing.
    g.reject = { zone, reason: res.reason };
    mark(g, null);
    setGhostVerdict(res.reason, false);
    return;
  }
  g.hit = { zone, res };
  mark(g, res.el);
  setGhostVerdict(g.payload.label, true);
}

function teardown(g: Gesture) {
  mark(g, null);
  removeGhost();
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  window.removeEventListener("blur", onCancel);
  window.removeEventListener("keydown", onKey, true);
  gesture = null;
  if (useDragStore.getState().payload || useDragStore.getState().overId)
    useDragStore.setState({ payload: null, overId: null });
}

function onMove(e: PointerEvent) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  if (!g.moved) {
    if (
      Math.abs(e.clientX - g.startX) < DRAG_SLOP &&
      Math.abs(e.clientY - g.startY) < DRAG_SLOP
    )
      return;
    g.moved = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    showGhost(g.payload.label, e.clientX, e.clientY);
    useDragStore.setState({ payload: g.payload });
  }
  e.preventDefault();
  moveGhost(e.clientX, e.clientY);
  resolveAt(g, e);
}

function onUp(e: PointerEvent) {
  const g = gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const hit = g.moved ? g.hit : null;
  const reject = g.moved ? g.reject : null;
  teardown(g);
  if (hit) hit.zone.spec.current.onDrop(g.payload, hit.res.key);
  else if (reject) reject.zone.spec.current.onReject?.(g.payload, reject.reason);
}

function onCancel() {
  if (gesture) teardown(gesture);
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !gesture) return;
  // Claimed before the keymap dispatcher sees it (capture phase) so Escape
  // cancels the drag rather than closing an overlay behind it.
  e.preventDefault();
  e.stopPropagation();
  teardown(gesture);
}

function onDragStart(e: Event) {
  // WebKit will happily start a NATIVE drag off a text selection, a link or an
  // icon inside our source. That drag we cannot theme, cancel or test.
  e.preventDefault();
}

/**
 * Arm a drag. Returns without doing anything visible — the payload only becomes
 * a drag once the pointer clears the slop, so a plain click still selects.
 */
export function beginDrag(e: React.PointerEvent, payload: DragPayload): void {
  if (e.button !== 0 || gesture) return;
  const target = e.target as HTMLElement | null;
  // Controls own their own pointer semantics (the staging checkbox, a row's
  // <select>, the message textarea). Same opt-out list as useRowReorder.
  if (target?.closest?.(CONTROLS)) return;

  gesture = {
    pointerId: e.pointerId,
    payload,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    marked: null,
    hit: null,
    reject: null,
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  // Belt to pointercancel's braces: teardown is the ONLY path that clears
  // `gesture`, and a non-null `gesture` makes every future beginDrag a no-op. If
  // the window ever loses focus without delivering a pointerup (an OS-level
  // steal, a second window opening mid-gesture), the drag would wedge the whole
  // feature until reload. Implicit pointer capture should make that unreachable;
  // this makes it unfalsifiable.
  window.addEventListener("blur", onCancel);
  window.addEventListener("keydown", onKey, true);
}

export const __dnd = { onDragStart };
