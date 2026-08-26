import { useEffect, useState } from "react";
import { platform as osPlatform } from "@tauri-apps/plugin-os";

export type Platform = "macos" | "windows" | "linux";

let cache: Platform | null = null;
let inflight: Promise<Platform> | null = null;

function normalize(raw: string): Platform {
  if (raw === "macos") return "macos";
  if (raw === "windows") return "windows";
  return "linux";
}

export async function getPlatform(): Promise<Platform> {
  if (cache) return cache;
  if (!inflight) {
    inflight = Promise.resolve(osPlatform()).then((raw) => {
      cache = normalize(raw);
      return cache;
    });
  }
  return inflight;
}

export function usePlatform(): Platform | undefined {
  const [p, setP] = useState<Platform | undefined>(cache ?? undefined);
  useEffect(() => {
    let cancelled = false;
    getPlatform().then((r) => {
      if (!cancelled) setP(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return p;
}

export function __resetPlatformCacheForTests() {
  cache = null;
  inflight = null;
}

/**
 * Platform-specific wording for "reveal in the OS file manager" (#215) — the
 * command is the same everywhere, but the app that opens is not, and naming
 * it beats a generic "Show in file manager" on the two platforms where the
 * app has an actual name. `undefined` (platform not resolved yet) reads the
 * same as Linux, which is the least presumptuous default for the brief
 * window before `usePlatform()` settles.
 */
export function fileManagerLabel(platform: Platform | undefined): string {
  switch (platform) {
    case "macos":
      return "Reveal in Finder";
    case "windows":
      return "Show in Explorer";
    default:
      return "Show in file manager";
  }
}
