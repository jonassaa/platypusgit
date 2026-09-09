// Tauri dialog plugin mock. Each test sets the result `open()` or `save()`
// should return.

type OpenResult = string | string[] | null;

let openResult: OpenResult = null;
let saveResult: string | null = null;
let lastSaveOptions: unknown = null;

export function mockDialogOpen(result: OpenResult): void {
  openResult = result;
}

/** The path the native save dialog should pretend the user chose. */
export function mockDialogSave(result: string | null): void {
  saveResult = result;
}

/** What `save()` was last called with, so a test can assert the default name. */
export function lastDialogSaveOptions(): unknown {
  return lastSaveOptions;
}

export function resetDialogMock(): void {
  openResult = null;
  saveResult = null;
  lastSaveOptions = null;
}

export async function open(): Promise<OpenResult> {
  return openResult;
}

export async function save(options?: unknown): Promise<string | null> {
  lastSaveOptions = options ?? null;
  return saveResult;
}

export async function ask(): Promise<boolean> {
  return false;
}

export async function confirm(): Promise<boolean> {
  return false;
}

export async function message(): Promise<void> {
  return;
}
