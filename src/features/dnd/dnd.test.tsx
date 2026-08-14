// The drag primitive itself: slop, cancellation, the control opt-out, delegated
// resolution and rejection. Everything the three surfaces rely on being true.
//
// jsdom has no PointerEvent, and Testing Library then falls back to a bare Event
// — which silently drops clientX/clientY/button. A MouseEvent typed as a pointer
// event keeps the coordinates the handlers read. (Same trick as
// Rebase.reorder.test.tsx.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { useDragSource, useDropZone } from "./useDnd";
import { useDragStore } from "./dragController";
import type { DragPayload, DropResolution } from "./types";

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

const payloadFor = (target: HTMLElement): DragPayload | null => {
  const row = target.closest("[data-path]") as HTMLElement | null;
  if (!row) return null;
  return {
    kind: "files",
    side: "unstaged",
    paths: [row.getAttribute("data-path")!],
    label: row.getAttribute("data-path")!,
  };
};

function Harness({
  onDrop,
  resolve,
  accepts = () => true,
}: {
  onDrop: (p: DragPayload, key: string) => void;
  resolve?: (el: HTMLElement, p: DragPayload) => DropResolution | null;
  accepts?: (p: DragPayload) => boolean;
}) {
  const src = useDragSource(payloadFor);
  const zone = useDropZone({ id: "zone", accepts, resolve, onDrop });
  return (
    <div>
      <div data-testid="source" {...src}>
        <div data-path="a.txt" data-testid="row-a">
          a.txt
          <button data-testid="row-a-button">stage</button>
        </div>
        <div data-path="b.txt" data-testid="row-b">
          b.txt
        </div>
      </div>
      <div ref={zone.ref} data-testid="zone" data-over={zone.isOver ? "yes" : "no"}>
        <div data-testid="slot-1" data-slot="1">
          one
        </div>
        <div data-testid="slot-2" data-slot="2">
          two
        </div>
      </div>
    </div>
  );
}

/** Drag `from` to `to`, dispatching each move ON the element under the pointer
 *  — that is what a real pointer move does, and what the e2e helper reproduces. */
function drag(from: HTMLElement, to: HTMLElement | null, opts: { drop?: boolean } = {}) {
  act(() => {
    from.dispatchEvent(pointer("pointerdown", 10, 10));
    // Two moves: the first clears the slop and arms the drag, the second lands
    // on the target so the resolution is computed from a real element.
    (to ?? from).dispatchEvent(pointer("pointermove", 40, 40));
    if (to) to.dispatchEvent(pointer("pointermove", 41, 41));
    if (opts.drop !== false) (to ?? window).dispatchEvent(pointer("pointerup", 41, 41));
  });
}

describe("dnd primitive", () => {
  beforeEach(() => {
    useDragStore.setState({ payload: null, overId: null });
    document.body.style.userSelect = "";
  });

  it("drops the payload the source produced onto the zone", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    drag(screen.getByTestId("row-a"), screen.getByTestId("zone"));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0]).toMatchObject({ kind: "files", paths: ["a.txt"] });
  });

  // Below the slop the gesture is still a click, or a row would be impossible
  // to select without accidentally dropping it somewhere.
  it("does nothing when the pointer never clears the slop", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const row = screen.getByTestId("row-a");
    const zone = screen.getByTestId("zone");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      zone.dispatchEvent(pointer("pointermove", 12, 11));
      zone.dispatchEvent(pointer("pointerup", 12, 11));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("cancels on Escape without dropping", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const row = screen.getByTestId("row-a");
    const zone = screen.getByTestId("zone");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      zone.dispatchEvent(pointer("pointermove", 40, 40));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      zone.dispatchEvent(pointer("pointerup", 40, 40));
    });
    expect(onDrop).not.toHaveBeenCalled();
    expect(useDragStore.getState().payload).toBeNull();
    expect(document.body.style.userSelect).toBe("");
  });

  it("cancels on pointercancel", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const row = screen.getByTestId("row-a");
    const zone = screen.getByTestId("zone");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      zone.dispatchEvent(pointer("pointermove", 40, 40));
      window.dispatchEvent(pointer("pointercancel", 40, 40));
      zone.dispatchEvent(pointer("pointerup", 40, 40));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  // A row's staging checkbox / action <select> / message textarea owns its own
  // pointer semantics — the same opt-out list useRowReorder uses.
  it("ignores a pointerdown that lands on a control", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    drag(screen.getByTestId("row-a-button"), screen.getByTestId("zone"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores a pointerdown on a spot the source declines", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    drag(screen.getByTestId("source"), screen.getByTestId("zone"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("marks the resolved element, not the zone, in delegated mode", () => {
    const onDrop = vi.fn();
    const resolve = (el: HTMLElement): DropResolution | null => {
      const slot = el.closest("[data-slot]") as HTMLElement | null;
      return slot ? { key: slot.getAttribute("data-slot")!, el: slot } : null;
    };
    render(<Harness onDrop={onDrop} resolve={resolve} />);
    const row = screen.getByTestId("row-a");
    const slot2 = screen.getByTestId("slot-2");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      slot2.dispatchEvent(pointer("pointermove", 40, 40));
      slot2.dispatchEvent(pointer("pointermove", 41, 41));
    });
    expect(slot2.hasAttribute("data-pg-drop-over")).toBe(true);
    expect(screen.getByTestId("zone").hasAttribute("data-pg-drop-over")).toBe(false);
    act(() => {
      slot2.dispatchEvent(pointer("pointerup", 41, 41));
    });
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ kind: "files" }), "2");
    // The marker is cleaned up, or the row stays highlighted forever.
    expect(slot2.hasAttribute("data-pg-drop-over")).toBe(false);
  });

  it("does not drop over a delegated zone where nothing resolves", () => {
    const onDrop = vi.fn();
    render(
      <Harness
        onDrop={onDrop}
        resolve={(el) => {
          const slot = el.closest("[data-slot]") as HTMLElement | null;
          return slot ? { key: slot.getAttribute("data-slot")!, el: slot } : null;
        }}
      />,
    );
    drag(screen.getByTestId("row-a"), screen.getByTestId("zone"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not drop on a rejected resolution, and says why on the ghost", () => {
    const onDrop = vi.fn();
    render(
      <Harness
        onDrop={onDrop}
        resolve={(el) => ({ key: "x", el, reason: "check out develop first" })}
      />,
    );
    const row = screen.getByTestId("row-a");
    const slot1 = screen.getByTestId("slot-1");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      slot1.dispatchEvent(pointer("pointermove", 40, 40));
      slot1.dispatchEvent(pointer("pointermove", 41, 41));
    });
    expect(screen.getByTestId("drag-ghost").textContent).toContain("check out develop first");
    act(() => {
      slot1.dispatchEvent(pointer("pointerup", 41, 41));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("is invisible to a drag it does not accept", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} accepts={(p) => p.kind === "ref"} />);
    drag(screen.getByTestId("row-a"), screen.getByTestId("zone"));
    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByTestId("zone").getAttribute("data-over")).toBe("no");
  });

  it("removes the ghost when the gesture ends", () => {
    render(<Harness onDrop={vi.fn()} />);
    drag(screen.getByTestId("row-a"), screen.getByTestId("zone"));
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
  });
});
