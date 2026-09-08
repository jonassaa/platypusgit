// "View in browser" — opening one commit's forge page.
//
// Nothing is SENT here: the app derives a url and hands it to the user's
// browser through `open_url`, the one validated opener path. The assertions
// below are about which url, and about the honest failure when there is no page.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { openCommitInBrowser } from "./openCommitInBrowser";
import { useForgeStore } from "./useForgeStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const OID = "0123456789abcdef0123456789abcdef01234567";
const URL = `https://github.com/o/n/commit/${OID}`;

const opened = () => getInvokeCalls().filter((c) => c.cmd === "open_url");
const asked = () => getInvokeCalls().filter((c) => c.cmd === "forge_commit_url");

beforeEach(() => {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
  } as never);
  useForgeStore.setState({ hostKinds: { "git.example.com": "GitHub" } } as never);
  mockInvoke("forge_commit_url", () => URL);
  mockInvoke("open_url", () => null);
});

afterEach(() => vi.restoreAllMocks());

describe("openCommitInBrowser", () => {
  it("opens the url the backend derived, through open_url", async () => {
    await openCommitInBrowser(OID);
    expect(opened()).toHaveLength(1);
    expect(opened()[0].args).toMatchObject({ url: URL });
  });

  it("passes the oid and the user's host mapping, so self-hosted resolves", async () => {
    await openCommitInBrowser(OID);
    expect(asked()[0].args).toMatchObject({
      repoId: "r1",
      oid: OID,
      hostKinds: { "git.example.com": "GitHub" },
    });
  });

  it("says so, and opens nothing, when the remote has no forge page", async () => {
    mockInvoke("forge_commit_url", () => null);
    await openCommitInBrowser(OID);
    expect(opened()).toHaveLength(0);
  });

  it("opens nothing when a refusal comes back from the builders", async () => {
    mockInvoke("forge_commit_url", () => {
      throw { kind: "InvalidArgument", message: "not a commit id" };
    });
    await openCommitInBrowser(OID);
    expect(opened()).toHaveLength(0);
  });

  it("does not throw when a refusal comes back — a menu click must not crash", async () => {
    mockInvoke("forge_commit_url", () => {
      throw { kind: "InvalidUrl", message: "bad host" };
    });
    await expect(openCommitInBrowser(OID)).resolves.toBeUndefined();
  });

  it("asks nothing without an open repository", async () => {
    useRepoStore.setState({ current: null } as never);
    await openCommitInBrowser(OID);
    expect(asked()).toHaveLength(0);
    expect(opened()).toHaveLength(0);
  });

  // The privacy promise: no request is made from the frontend, and no hostname
  // is hard-coded. Everything comes back from the backend, derived from the
  // user's own remote.
  it("makes no network call of its own — only the two IPC commands", async () => {
    await openCommitInBrowser(OID);
    const cmds = getInvokeCalls().map((c) => c.cmd);
    expect(new Set(cmds)).toEqual(new Set(["forge_commit_url", "open_url"]));
  });
});
