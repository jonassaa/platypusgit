import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { MergeWindow } from "./features/merge/MergeWindow";
import "./index.css";

if (import.meta.env.DEV) {
  attachConsole().catch((err) => {
    console.warn("attachConsole failed", err);
  });
}

// The merge resolver runs as a second Tauri window on the same bundle,
// selected by query param (see features/merge/openMergeWindow.ts).
const isMergeWindow =
  new URLSearchParams(window.location.search).get("window") === "merge";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMergeWindow ? <MergeWindow /> : <App />}
  </React.StrictMode>,
);
