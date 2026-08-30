// What we tell someone whose SSH authentication just failed (#248).
//
// The whole point of the feature is that `Permission denied (publickey)` no
// longer produces one generic sentence, so the grid below IS the feature: the
// same classification splits on whether a key exists at all.

import { describe, expect, it } from "vitest";
import { sshAdvice } from "./sshAdvice";
import type { SshKeyStatus } from "@/lib/types";

function status(over: Partial<SshKeyStatus> = {}): SshKeyStatus {
  return {
    dir: "/home/ada/.ssh",
    dirExists: true,
    keys: [],
    canGenerate: true,
    suggestedName: "id_ed25519",
    suggestedComment: "ada@example.com",
    addKeyUrl: "https://github.com/settings/ssh/new",
    host: "github.com",
    ...over,
  };
}

const key = {
  path: "/home/ada/.ssh/id_ed25519",
  publicPath: "/home/ada/.ssh/id_ed25519.pub",
  algorithm: "ssh-ed25519",
  comment: "ada@example.com",
  fingerprint: "SHA256:abc",
  publicKey: "ssh-ed25519 AAAA ada@example.com",
  isDefaultIdentity: true,
};

describe("sshAdvice", () => {
  it("says there is no key when there is no key", () => {
    const a = sshAdvice("SshKey", status({ keys: [] }));
    expect(a.tone).toBe("none");
    expect(a.headline).toContain("/home/ada/.ssh");
    expect(a.wantsGenerate).toBe(true);
    // The remedy, not the diagnosis: generating is the next move.
    expect(a.body).toContain("Generate a key");
  });

  it("names the host that refused, so the sentence is actionable", () => {
    const a = sshAdvice("SshKey", status({ keys: [] }));
    expect(a.body).toContain("github.com");
  });

  it("blames registration, not the key, when a key exists", () => {
    const a = sshAdvice("SshKey", status({ keys: [key] }));
    expect(a.tone).toBe("unregistered");
    expect(a.headline).toContain("github.com");
    expect(a.body).toContain("not been added to your account");
    // Generating a SECOND key is not the fix for a key the host has not seen.
    expect(a.wantsGenerate).toBe(false);
  });

  it("is honest that registration is a guess, not a fact we checked", () => {
    // We never ask the host whether the key is registered — saying so flatly
    // would be a claim the app cannot back up.
    const a = sshAdvice("SshKey", status({ keys: [key] }));
    expect(a.body).toContain("usual cause");
    expect(a.body).toContain("~/.ssh/config");
  });

  it("treats a passphrase challenge as a locked key, not a rejected one", () => {
    const a = sshAdvice("SshPassphrase", status({ keys: [key] }));
    expect(a.tone).toBe("passphrase");
    expect(a.wantsGenerate).toBe(false);
    expect(a.body).toContain("has not rejected it");
  });

  it("falls back to naming no host when git's stderr named none", () => {
    const a = sshAdvice("SshKey", status({ host: null, keys: [] }));
    expect(a.body).toContain("the server");
    expect(a.body).not.toContain("null");
  });

  it("does not claim a key is missing before the status has loaded", () => {
    // `null` is "we have not looked yet". Answering "no SSH key found" there
    // would tell a user with a perfectly good key to make another one.
    const a = sshAdvice("SshKey", null);
    expect(a.tone).not.toBe("none");
    expect(a.wantsGenerate).toBe(false);
  });
});
