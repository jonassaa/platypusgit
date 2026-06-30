// Tauri dialog plugin mock. Each test sets the result `open()` should return.

type OpenResult = string | string[] | null;

let openResult: OpenResult = null;

export function mockDialogOpen(result: OpenResult): void {
  openResult = result;
}

export function resetDialogMock(): void {
  openResult = null;
}

export async function open(): Promise<OpenResult> {
  return openResult;
}

export async function save(): Promise<string | null> {
  return null;
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
