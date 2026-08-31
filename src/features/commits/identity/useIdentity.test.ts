// The byline's two pure helpers (#233).
//
// They exist to answer "who will this commit be attributed to, and which config
// said so" — the question a user with a work address and a personal one cannot
// answer by looking at the app, and gets wrong at a cost that survives the push.

import { describe, expect, it } from "vitest";

import type { GitIdentity } from "@/lib/types";
import { identityLine, identityOrigin } from "./useIdentity";

const identity = (
  name: GitIdentity["name"],
  email: GitIdentity["email"],
): GitIdentity => ({
  name,
  email,
  globalConfigPath: "/home/ada/.gitconfig",
  localConfigPath: "/repo/.git/config",
});

const at = (value: string, scope: "repository" | "global" | "system") => ({
  value,
  scope,
});

describe("identityLine", () => {
  it("renders the identity the way a commit records it", () => {
    expect(
      identityLine(
        identity(at("Ada Lovelace", "global"), at("ada@example.com", "global")),
      ),
    ).toBe("Ada Lovelace <ada@example.com>");
  });

  it("is null when either half is missing", () => {
    expect(identityLine(null)).toBeNull();
    expect(
      identityLine(identity(at("Ada", "global"), null)),
    ).toBeNull();
    expect(
      identityLine(identity(null, at("ada@example.com", "global"))),
    ).toBeNull();
  });

  it("treats a present-but-blank half as missing", () => {
    // The state git refuses on. Rendering `Ada <>` would present a commit that
    // is about to fail as one that is fine — the exact failure #212 removed
    // from the error path, which must not come back on the display path.
    expect(
      identityLine(identity(at("Ada", "global"), at("   ", "global"))),
    ).toBeNull();
    expect(
      identityLine(identity(at("", "global"), at("ada@example.com", "global"))),
    ).toBeNull();
  });

  it("trims, so a config with a stray space reads cleanly", () => {
    expect(
      identityLine(
        identity(at("  Ada  ", "global"), at(" ada@example.com ", "global")),
      ),
    ).toBe("Ada <ada@example.com>");
  });
});

describe("identityOrigin", () => {
  it("names the scope in the words the form's control uses", () => {
    const origin = (scope: "repository" | "global" | "system") =>
      identityOrigin(identity(at("Ada", scope), at("ada@example.com", scope)));
    expect(origin("repository")).toBe("this repository");
    expect(origin("global")).toBe("global");
    expect(origin("system")).toBe("this machine");
  });

  it("says nothing when the two halves come from different files", () => {
    // `user.name` from /etc/gitconfig and `user.email` from ~/.gitconfig is an
    // ordinary managed-machine state. Naming only the first would be a
    // confident wrong answer about the second, so the byline stays quiet and
    // the form tells the full story when opened.
    expect(
      identityOrigin(
        identity(at("Managed", "system"), at("ada@example.com", "global")),
      ),
    ).toBeNull();
  });

  it("is null when there is no identity to describe", () => {
    expect(identityOrigin(null)).toBeNull();
    expect(identityOrigin(identity(at("Ada", "global"), null))).toBeNull();
  });
});
