import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useUpdateStore } from "./useUpdateStore";
import type { UpdateInfo } from "@/lib/types";

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
};

function reset() {
  resetInvokeMock();
  localStorage.clear();
  useUpdateStore.setState({
    status: "idle",
    info: null,
    capability: null,
    dismissedVersion: null,
    progress: null,
    error: null,
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
});
