// Multiple windows (#256). See `docs/superpowers/specs/2026-09-04-multiple-windows-spec.md`.

export {
  MAIN_LABEL,
  MERGE_LABEL,
  REPO_WINDOW_PREFIX,
  OPEN_REPOS_KEY,
  WINDOWS_KEY,
  WINDOW_CLOSED_EVENT,
  WINDOW_LIMIT,
  CASCADE_STEP,
  cascadeFrom,
  forgetWindow,
  isRepoWindowLabel,
  loadWindowRecords,
  openReposKey,
  rememberWindow,
  saveWindowRecords,
  type WindowBounds,
  type WindowRecord,
} from "./windowKind";
export {
  openAppWindow,
  currentBounds,
  chromeOptions,
  releaseWindowLabel,
  __resetWindowClaims,
} from "./openAppWindow";
export { listenToThisWindow } from "./windowEvents";
export {
  isPrimaryWindow,
  restoreWindows,
  useWindowLifecycle,
  windowLabel,
  __resetWindowRestore,
} from "./useWindowLifecycle";
