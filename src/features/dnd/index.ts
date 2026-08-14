// Drag-and-drop. One pointer-event primitive for every surface — see
// docs/superpowers/specs/2026-08-14-drag-and-drop-design.md for why pointer
// events and not HTML5 drag-and-drop.
export * from "./types";
export * from "./resolveDrop";
export * from "./useDnd";
export { useDragStore, useDragActive, type DropZoneSpec } from "./dragController";
export * from "./useRowReorder";
export * from "./StageDropBar";
