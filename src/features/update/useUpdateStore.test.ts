import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { shouldNag, useUpdateStore } from "./useUpdateStore";
import type { UpdateInfo } from "@/lib/types";

// install() dynamically imports both plugins; vi.mock intercepts that too.
const plugins = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugins.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugins.relaunch }));

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
  prerelease: false,
};

function reset() {
  resetInvokeMock();
  localStorage.clear();
  plugins.check.mockReset();
  plugins.relaunch.mockReset();
  useUpdateStore.setState({
    status: "idle",
    info: null,
    capability: null,
    dismissedVersion: null,
    currentVersion: null,
    lastCheckedAt: null,
    installing: false,
    progress: null,
    error: null,
    message: null,
    panelOpen: false,
  });
}

describe("useUpdateStore.check", () => {
  beforeEach(reset);

  it("marks available and auto-opens the panel on a fresh update", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => AVAILABLE);
    await useUpdateStore.getState().check(false);
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.capability).toBe("notify");
    expect(s.panelOpen).toBe(true);
    expect(s.currentVersion).toBe("0.0.5");
  });

  it("does not auto-open the panel for a dismissed version", async () => {
    localStorage.setItem("pg-update-dismissed", "0.1.0");
    useUpdateStore.setState({ dismissedVersion: "0.1.0" });
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => AVAILABLE);
    await useUpdateStore.getState().check(false);
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available"); // chip still shows
    expect(s.panelOpen).toBe(false); // but no nag
  });

  it("swallows errors on a startup (non-manual) check", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => {
      throw { kind: "Network", message: "offline" };
    });
    await useUpdateStore.getState().check(false);
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it("surfaces errors on a manual check", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => {
      throw { kind: "Network", message: "offline" };
    });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toBe("offline");
  });

  it("is a no-op while an install is in flight", async () => {
    // Otherwise Settings' "Check for updates" mid-download flipped status back
    // to "checking", re-enabling Install -> a second downloadAndInstall and a
    // double relaunch().
    useUpdateStore.setState({ installing: true, status: "available" });
    let called = false;
    mockInvoke("check_for_update", () => {
      called = true;
      return AVAILABLE;
    });
    await useUpdateStore.getState().check(true);
    expect(called).toBe(false);
    const s = useUpdateStore.getState();
    expect(s.installing).toBe(true);
    expect(s.status).toBe("available");
  });
});

describe("useUpdateStore.install", () => {
  beforeEach(reset);

  it("downloads, reports progress, and relaunches", async () => {
    useUpdateStore.setState({ info: AVAILABLE, capability: "self-update" });
    const seen: number[] = [];
    plugins.check.mockResolvedValue({
      downloadAndInstall: vi.fn(
        async (cb: (e: Record<string, unknown>) => void) => {
          cb({ event: "Started", data: { contentLength: 100 } });
          cb({ event: "Progress", data: { chunkLength: 40 } });
          seen.push(useUpdateStore.getState().progress ?? -1);
          cb({ event: "Progress", data: { chunkLength: 60 } });
          seen.push(useUpdateStore.getState().progress ?? -1);
        },
      ),
    });
    plugins.relaunch.mockResolvedValue(undefined);

    await useUpdateStore.getState().install();

    expect(seen).toEqual([0.4, 1]);
    expect(plugins.relaunch).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it("falls back to the release page when the updater has no manifest", async () => {
    // check() === null is the real state whenever a release lacks latest.json.
    // Claiming "up-to-date" here left a dead button while info still said an
    // update was available.
    const opened: string[] = [];
    mockInvoke("open_url", (args) => {
      opened.push((args as { url: string }).url);
      return null;
    });
    useUpdateStore.setState({
      info: AVAILABLE,
      capability: "self-update",
      status: "available",
    });
    plugins.check.mockResolvedValue(null);

    await useUpdateStore.getState().install();

    const s = useUpdateStore.getState();
    expect(opened).toEqual([AVAILABLE.releaseUrl]);
    expect(s.status).not.toBe("up-to-date");
    expect(s.message).toMatch(/no signed installer/i);
    expect(s.installing).toBe(false);
    expect(plugins.relaunch).not.toHaveBeenCalled();
  });

  it("surfaces a download failure and clears the installing flag", async () => {
    useUpdateStore.setState({ info: AVAILABLE, capability: "self-update" });
    plugins.check.mockRejectedValue(new Error("signature mismatch"));

    await useUpdateStore.getState().install();

    const s = useUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("signature mismatch");
    expect(s.installing).toBe(false);
    expect(s.progress).toBeNull();
  });

  it("refuses to start a second install while one is running", async () => {
    useUpdateStore.setState({ info: AVAILABLE, installing: true });
    await useUpdateStore.getState().install();
    expect(plugins.check).not.toHaveBeenCalled();
  });
});

describe("useUpdateStore.dismiss / openReleasePage", () => {
  beforeEach(reset);

  it("dismiss persists the version and closes the panel", () => {
    useUpdateStore.setState({ info: AVAILABLE, panelOpen: true });
    useUpdateStore.getState().dismiss();
    expect(useUpdateStore.getState().dismissedVersion).toBe("0.1.0");
    expect(useUpdateStore.getState().panelOpen).toBe(false);
    expect(localStorage.getItem("pg-update-dismissed")).toBe("0.1.0");
  });

  it("openReleasePage invokes open_url with the release url", async () => {
    const seen: string[] = [];
    mockInvoke("open_url", (args) => {
      seen.push((args as { url: string }).url);
      return null;
    });
    useUpdateStore.setState({ info: AVAILABLE });
    await useUpdateStore.getState().openReleasePage();
    expect(seen).toEqual([AVAILABLE.releaseUrl]);
  });

  it("openReleasePage surfaces a failure instead of rejecting unhandled", async () => {
    mockInvoke("open_url", () => {
      throw { kind: "InvalidUrl", message: "refusing to open a non-https url" };
    });
    useUpdateStore.setState({ info: AVAILABLE });
    await expect(
      useUpdateStore.getState().openReleasePage(),
    ).resolves.toBeUndefined();
    const s = useUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("refusing to open a non-https url");
  });
});

describe("shouldNag", () => {
  const withLatest = (latestVersion: string): UpdateInfo => ({
    ...AVAILABLE,
    latestVersion,
  });

  it("nags for an undismissed update", () => {
    expect(shouldNag({ info: AVAILABLE, dismissedVersion: null })).toBe(true);
  });

  it("never nags when no update is available", () => {
    expect(
      shouldNag({
        info: { ...AVAILABLE, available: false },
        dismissedVersion: null,
      }),
    ).toBe(false);
    expect(shouldNag({ info: null, dismissedVersion: null })).toBe(false);
  });

  it("suppresses the dismissed version but re-nags for a newer one", () => {
    expect(shouldNag({ info: withLatest("0.2.0"), dismissedVersion: "0.2.0" }))
      .toBe(false);
    expect(shouldNag({ info: withLatest("0.2.1"), dismissedVersion: "0.2.0" }))
      .toBe(true);
    expect(shouldNag({ info: withLatest("1.0.0"), dismissedVersion: "0.2.0" }))
      .toBe(true);
  });

  it("does not re-nag for an OLDER version than the dismissed one", () => {
    // String inequality re-nagged here: dismiss 0.2.0, then a yanked release
    // makes /releases/latest return 0.1.0 and the panel reopens on a downgrade.
    expect(shouldNag({ info: withLatest("0.1.0"), dismissedVersion: "0.2.0" }))
      .toBe(false);
    // A prerelease of the dismissed version is also older.
    expect(
      shouldNag({ info: withLatest("0.2.0-rc.1"), dismissedVersion: "0.2.0" }),
    ).toBe(false);
  });

  it("falls back to inequality when a version is unparseable", () => {
    expect(shouldNag({ info: withLatest("nightly"), dismissedVersion: "0.2.0" }))
      .toBe(true);
    expect(
      shouldNag({ info: withLatest("nightly"), dismissedVersion: "nightly" }),
    ).toBe(false);
  });
});
