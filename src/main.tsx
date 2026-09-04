import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { PGErrorBoundary } from "./design/error-boundary";
import { MergeWindow } from "./features/merge/MergeWindow";
import { RevealOnFirstPaint } from "./lib/revealWindow";
import { startSystemAppearanceWatch } from "./features/settings/useSettingsStore";
import "./index.css";

if (import.meta.env.DEV) {
  attachConsole().catch((err) => {
    console.warn("attachConsole failed", err);
  });
}

// Follow the OS light/dark appearance (#236). Deliberately BEFORE the
// which-window branch: the merge resolver is a second Tauri window running
// this same bundle, and one window still in last night's theme is the bug the
// feature exists to fix. Each window subscribes to its own
// `tauri://theme-changed`, so neither depends on the other being open. Never
// unsubscribed — the subscription's lifetime is the window's.
startSystemAppearanceWatch();

// The merge resolver runs as a second Tauri window on the same bundle,
// selected by query param (see features/merge/openMergeWindow.ts).
const isMergeWindow =
  new URLSearchParams(window.location.search).get("window") === "merge";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* The window is created hidden, so SOMETHING has to show it. Deliberately
        a sibling of the boundary rather than a child: a throw from the app
        below must not be able to swallow the reveal and leave the "something
        went wrong" screen in a window nobody can see. */}
    <RevealOnFirstPaint />
    {/* Outermost, so a throw anywhere still leaves a window that says what
        happened instead of an empty one. */}
    <PGErrorBoundary>
      {isMergeWindow ? <MergeWindow /> : <App />}
    </PGErrorBoundary>
  </React.StrictMode>,
);
