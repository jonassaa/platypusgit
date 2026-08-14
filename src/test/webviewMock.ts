// Stand-in for `@tauri-apps/api/webview`. Only zoom is used (applyZoom in
// useSettingsStore); the calls are recorded so a test can assert the factor
// that reached the webview, not just the stored setting.

const zoomCalls: number[] = [];

export function getCurrentWebview() {
  return {
    setZoom: async (factor: number) => {
      zoomCalls.push(factor);
    },
  };
}

export function getZoomCalls(): readonly number[] {
  return zoomCalls;
}

export function resetWebviewMock(): void {
  zoomCalls.length = 0;
}
