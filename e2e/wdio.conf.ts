import path from "node:path";
import type { TauriCapabilities } from "@wdio/tauri-service";
import { $ } from "@wdio/globals";
import { armDriverBridge } from "./support/app";

// Snapshot copied by `pnpm test:e2e` after building with
// `--features tauri/custom-protocol` (which embeds the frontend assets).
// We don't point at src-tauri/target/debug/ directly: any plain
// `cargo build` / `cargo test` (or editor tooling) rewrites that binary
// WITHOUT the custom-protocol feature, producing a dev-mode binary that
// expects a Vite dev server and renders a blank window.
const appBinaryPath = path.resolve(import.meta.dirname, "./.bin/platypusgit");

const tauriCapability: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: appBinaryPath,
  },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [tauriCapability],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
      },
    ],
  ],
  // Hand the freshly loaded page's Tauri core API to the driver before any
  // spec runs a find/click (see armDriverBridge for why).
  before: async () => {
    await armDriverBridge();
    // On a fresh session the webview may still be booting; openRepo() starts
    // with a browser.refresh(), which must not fire mid-boot. Wait for the
    // Welcome screen once here so every repo-opening spec is safe from the
    // very first test.
    await $("div*=Welcome to PlatypusGit").waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "app never rendered Welcome screen",
    });
  },
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  logLevel: "warn",
  reporters: ["spec"],
};
