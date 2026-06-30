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
