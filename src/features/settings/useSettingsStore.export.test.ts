// Settings export / import (#254). Themes could already leave the machine one
// at a time; everything else was trapped in one localStorage key.
//
// The load-bearing tests here are the two guards, not the happy path:
//
//   * the KEY-SET SNAPSHOT — the export derives its keys from the schema minus
//     a deny-list, so a new preference travels by default. The snapshot is what
//     turns "someone added a setting" into a deliberate decision (export it, or
//     deny it) instead of a silent omission. #283 added `updateCheckMode` days
//     before this feature landed, and a hand-written allow-list would have
//     missed it.
//   * NO SECRET-SHAPED KEYS — forge tokens and git credentials live in
//     Secret-typed storage and no command returns them. A settings export is
//     exactly the change that could accidentally undo that, so the assertion
//     reads the serialised payload rather than trusting the key list.
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "pg-settings-v2";

async function freshStore() {
  vi.resetModules();
  return await import("./useSettingsStore");
}

type Store = Awaited<ReturnType<typeof freshStore>>;

interface Payload {
  kind: string;
  version: number;
  exportedAt: string;
  settings: Record<string, unknown>;
  keymap?: { presetId: string };
}

/** The payload as an object, without re-parsing at every call site. */
function exported(store: Store, opts?: { keymapPresetId?: string | null }): Payload {
  return JSON.parse(store.useSettingsStore.getState().exportSettings(opts)) as Payload;
}

beforeEach(() => {
  localStorage.clear();
});

// ═════════════════════════════════════════════════════════════════════════════
// THE KEY SET
// ═════════════════════════════════════════════════════════════════════════════

// Every key in PersistedState, minus the deny-list. Adding a setting changes
// this list — which is the point. Export it (add it here) or deny it (add it to
// NON_PORTABLE_KEYS and to EXCLUDED below), but decide.
const PORTABLE = [
  "activeThemeId",
  "addSignoff",
  "autoFetchEnabled",
  "autoFetchMinutes",
  "autoStashBeforePull",
  // The branch-name → ticket regex (#252). Portable: it describes a TEAM's
  // ticket convention, which is exactly the kind of thing a settings file is
  // carried between machines to keep in step.
  // Whether commit bodies render as markdown (#253). Portable: it is a
  // reading preference, not a fact about this machine.
  "commitBodyMarkdown",
  "commitTicketPattern",
  "confirmForcePush",
  // User-defined commands (#225). Portable: "the command our team runs
  // fifty times a day" is what a shared settings file is for, and an action
  // is plain data with no secrets in it.
  "customActions",
  "customThemes",
  "defaultPullMode",
  "diffContextLines",
  "diffContextMode",
  "diffViewMode",
  // The external diff tool's NAME (#235). Portable on purpose: it says which
  // tool this person prefers, not where anything lives on this machine, and a
  // name that is not installed on the next machine fails visibly with git's own
  // message rather than silently doing the wrong thing.
  "externalDiffTool",
  "headMarks",
  "headWeight",
  "ignoreWhitespaceInDiff",
  "pruneOnFetch",
  // Whether a rebase carries dependent branches along (#240). Portable: it
  // describes how you want the app to rebase, not anything about this machine.
  "rebaseUpdateRefs",
  "signCommits",
  // A pairing of a light and a dark theme plus which one to follow (#236). A
  // preference like any other — it says what the person likes, not what the
  // machine is — so it travels. The OS appearance it RESOLVES against does
  // not: that is observed state, it is not in PersistedState at all, and the
  // "no systemAppearance" assertions below pin that.
  "themePreference",
  "uiDensity",
  "uiZoom",
  // The release channel (#237). Portable: "we track the prereleases" is a
  // team decision, not a fact about one machine — the same call
  // `updateCheckMode` beside it made.
  "updateChannel",
  "updateCheckMode",
  // The filesystem watcher (#239). Portable: whether you want the app to
  // notice outside edits is a preference, not a fact about this machine.
  // Someone who turns it off for a network mount will want it off on the
  // next network mount too.
  "watchFilesystem",
];

/** Machine-specific, so deliberately absent from an export. */
// Saved commit identities (#233) are DENIED, not exported. An export is a file
// people share, and every other key in the bag says how the app should behave —
// this one is a list of someone's name and email addresses. It is also useless
// on the receiving machine, since identities are per-person by definition.
const EXCLUDED = ["lastCreateDir", "identities"];

describe("the exported key set", () => {
  it("is exactly the schema minus the deny-list", async () => {
    const store = await freshStore();
    expect(Object.keys(exported(store).settings).sort()).toEqual([...PORTABLE].sort());
    expect([...store.NON_PORTABLE_KEYS].sort()).toEqual([...EXCLUDED].sort());
  });

  it("accounts for every key the store persists", async () => {
    const store = await freshStore();
    // No key may fall between the two lists: their union has to be the whole
    // schema, or a preference exists that nobody decided about.
    store.useSettingsStore.getState().set("pruneOnFetch", false);
    const written = Object.keys(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as object,
    );
    expect(written.sort()).toEqual([...PORTABLE, ...EXCLUDED].sort());
  });

  it("carries updateCheckMode, the setting added days before this export existed", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("updateCheckMode", "never");
    expect(exported(store).settings.updateCheckMode).toBe("never");
  });

  it("carries themePreference, and never the appearance it resolved against", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().setThemeFollowMode("system");
    const json = store.useSettingsStore.getState().exportSettings();
    const payload = JSON.parse(json) as Payload;
    expect(payload.settings.themePreference).toEqual({
      mode: "system",
      lightId: "light",
      darkId: "dark-cool",
    });
    // "It was dark on the machine that wrote this file" is not a preference —
    // it is a fact about that machine at that moment, and importing it would
    // be meaningless. Same call #283 made for the update store's lastCheckedAt.
    expect(payload.settings).not.toHaveProperty("systemAppearance");
    expect(json).not.toContain("systemAppearance");
  });

  it("repairs an imported pairing that names a theme this machine lacks", async () => {
    const store = await freshStore();
    const report = store.useSettingsStore.getState().importSettings(
      JSON.stringify({
        kind: "platypusgit-settings",
        version: 1,
        settings: {
          themePreference: {
            mode: "system",
            lightId: "their-custom-light",
            darkId: "their-custom-dark",
          },
        },
      }),
    );
    const s = store.useSettingsStore.getState();
    expect(s.themePreference).toEqual({
      mode: "system",
      lightId: "light",
      darkId: "dark-cool",
    });
    expect(s.getActiveTheme().id).toBe("dark-cool");
    expect(report.changed).toContain("themePreference");
  });

  it("leaves lastCreateDir behind — it names a directory on ONE machine", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("lastCreateDir", "/Users/someone/dev");
    const json = store.useSettingsStore.getState().exportSettings();
    expect(JSON.parse(json).settings).not.toHaveProperty("lastCreateDir");
    // …and the path itself is nowhere in the file, under any key.
    expect(json).not.toContain("/Users/someone/dev");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECRETS
// ═════════════════════════════════════════════════════════════════════════════

describe("an export carries no secrets", () => {
  // "key" is deliberately not in this list — keymap, activeThemeId and the
  // theme colour slots all use it innocently. These are the words that only
  // ever mean a credential.
  const FORBIDDEN = [
    "token",
    "secret",
    "password",
    "passphrase",
    "credential",
    "apikey",
    "api_key",
    "signingkey",
    "accesstoken",
  ];

  function keysDeep(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const v of value) keysDeep(v, out);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keysDeep(v, out);
      }
    }
    return out;
  }

  it("has no credential-shaped key anywhere in the payload", async () => {
    const store = await freshStore();
    // Fill the payload out as far as a user can: a custom theme too.
    store.useSettingsStore.getState().saveAsNewTheme("Mine");
    const json = store.useSettingsStore
      .getState()
      .exportSettings({ keymapPresetId: "rider" });
    const offenders = keysDeep(JSON.parse(json)).filter((k) =>
      FORBIDDEN.some((bad) => k.toLowerCase().includes(bad)),
    );
    expect(offenders).toEqual([]);
  });

  it("has no forge-token-shaped VALUE either", async () => {
    const store = await freshStore();
    const json = store.useSettingsStore.getState().exportSettings();
    // The prefixes GitHub and GitLab put on their tokens. If a token ever
    // reaches PersistedState this catches it even under an innocent key name.
    for (const shape of ["ghp_", "gho_", "ghu_", "github_pat_", "glpat-"]) {
      expect(json).not.toContain(shape);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUND TRIP
// ═════════════════════════════════════════════════════════════════════════════

/** Every portable setting moved off its default, so a round trip proves it. */
function moveEverything(store: Store) {
  store.useSettingsStore.getState().saveAsNewTheme("House style");
  const set = store.useSettingsStore.getState().set;
  set("uiDensity", "comfortable");
  set("uiZoom", 1.2);
  set("headMarks", ["badge"]);
  set("headWeight", "subtle");
  set("defaultPullMode", "Merge");
  set("autoFetchEnabled", true);
  set("autoFetchMinutes", 17);
  set("pruneOnFetch", false);
  set("confirmForcePush", false);
  set("autoStashBeforePull", false);
  set("addSignoff", true);
  set("signCommits", "always");
  set("commitTicketPattern", "issue-(\\d+)");
  set("diffContextLines", 9);
  set("diffViewMode", "split");
  set("diffContextMode", "chunks");
  set("ignoreWhitespaceInDiff", true);
  set("updateCheckMode", "manual");
  store.useSettingsStore.getState().setPairedThemeId("light", "github-light");
  store.useSettingsStore.getState().setThemeFollowMode("system");
}

function portableSnapshot(state: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PORTABLE) out[k] = state[k];
  return out;
}

const stateOf = (store: Store) =>
  store.useSettingsStore.getState() as unknown as Record<string, unknown>;

describe("round trip", () => {
  it("export → reset → import restores every portable setting", async () => {
    const store = await freshStore();
    moveEverything(store);
    const before = portableSnapshot(stateOf(store));
    const json = store.useSettingsStore.getState().exportSettings();

    store.useSettingsStore.getState().reset();
    // Sanity: reset really did undo it, so the comparison below means something.
    expect(store.useSettingsStore.getState().diffViewMode).toBe("inline");

    store.useSettingsStore.getState().importSettings(json);
    expect(portableSnapshot(stateOf(store))).toEqual(before);
  });

  it("survives the trip through localStorage, not just through store state", async () => {
    const store = await freshStore();
    moveEverything(store);
    const json = store.useSettingsStore.getState().exportSettings();
    store.useSettingsStore.getState().reset();
    store.useSettingsStore.getState().importSettings(json);

    // A fresh module instance reads what import persisted.
    const reloaded = await freshStore();
    expect(reloaded.useSettingsStore.getState().diffViewMode).toBe("split");
    expect(reloaded.useSettingsStore.getState().uiZoom).toBe(1.2);
    expect(reloaded.useSettingsStore.getState().customThemes).toHaveLength(1);
  });

  it("keeps a custom theme, and keeps activeThemeId pointing at it", async () => {
    const store = await freshStore();
    const created = store.useSettingsStore.getState().saveAsNewTheme("House style");
    store.useSettingsStore.getState().updateActiveColors({ accent: "#abcdef" });
    const json = store.useSettingsStore.getState().exportSettings();

    store.useSettingsStore.getState().reset();
    expect(store.useSettingsStore.getState().customThemes).toEqual([]);

    store.useSettingsStore.getState().importSettings(json);
    const s = store.useSettingsStore.getState();
    expect(s.customThemes).toHaveLength(1);
    expect(s.customThemes[0].name).toBe("House style");
    expect(s.customThemes[0].colors.accent).toBe("#abcdef");
    // The id has to survive or activeThemeId dangles and the app silently
    // falls back to the default theme — the one thing a theme export is for.
    expect(s.customThemes[0].id).toBe(created.id);
    expect(s.activeThemeId).toBe(created.id);
    expect(s.getActiveTheme().name).toBe("House style");
  });

  it("uses the same per-theme shape as a single-theme export", async () => {
    const store = await freshStore();
    const created = store.useSettingsStore.getState().saveAsNewTheme("House style");
    const one = JSON.parse(
      store.useSettingsStore.getState().exportTheme(created.id),
    ) as Record<string, unknown>;
    const inBundle = (
      exported(store).settings.customThemes as Record<string, unknown>[]
    )[0];
    // Same serialiser, so the same fields carry the same values — only the id
    // is added, because a bundle has to keep activeThemeId resolvable.
    expect(inBundle.name).toEqual(one.name);
    expect(inBundle.mode).toEqual(one.mode);
    expect(inBundle.colors).toEqual(one.colors);
    expect(Object.keys(inBundle).sort()).toEqual(["colors", "id", "mode", "name"]);
  });

  it("carries the keymap preset beside the settings, and reports it back", async () => {
    const store = await freshStore();
    const json = store.useSettingsStore
      .getState()
      .exportSettings({ keymapPresetId: "platypusgit" });
    expect(JSON.parse(json).keymap).toEqual({ presetId: "platypusgit" });
    const report = store.useSettingsStore.getState().importSettings(json);
    expect(report.keymapPresetId).toBe("platypusgit");
  });

  it("omits the keymap block when the caller has no preset to offer", async () => {
    const store = await freshStore();
    const payload = exported(store);
    expect(payload).not.toHaveProperty("keymap");
    const report = store.useSettingsStore
      .getState()
      .importSettings(JSON.stringify(payload));
    expect(report.keymapPresetId).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// IMPORT: THE DEFENSIVE POSTURE
// ═════════════════════════════════════════════════════════════════════════════

/** A minimal well-formed payload carrying just the given settings. */
function payloadOf(
  settings: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    kind: "platypusgit-settings",
    version: 1,
    settings,
    ...extra,
  });
}

describe("import validates like load() does", () => {
  it("ignores a key the schema no longer has, and says so", async () => {
    const store = await freshStore();
    const report = store.useSettingsStore
      .getState()
      .importSettings(payloadOf({ showWhitespaceInDiff: true, pruneOnFetch: false }));
    expect(report.ignored).toEqual(["showWhitespaceInDiff"]);
    expect(report.changed).toEqual(["pruneOnFetch"]);
    expect("showWhitespaceInDiff" in store.useSettingsStore.getState()).toBe(false);
    expect(store.useSettingsStore.getState().pruneOnFetch).toBe(false);
  });

  it("clamps an out-of-range uiZoom instead of leaving the UI unzoomable", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().importSettings(payloadOf({ uiZoom: 99 }));
    expect(store.useSettingsStore.getState().uiZoom).toBe(store.ZOOM_MAX);

    store.useSettingsStore.getState().importSettings(payloadOf({ uiZoom: -4 }));
    expect(store.useSettingsStore.getState().uiZoom).toBe(store.ZOOM_MIN);
  });

  it("falls back to the safe default for a bad signCommits", async () => {
    const store = await freshStore();
    for (const bad of [true, "sometimes", 3, null]) {
      store.useSettingsStore.getState().set("signCommits", "always");
      store.useSettingsStore.getState().importSettings(payloadOf({ signCommits: bad }));
      // "config" defers to the repository rather than forcing signing on.
      expect(store.useSettingsStore.getState().signCommits, String(bad)).toBe("config");
    }
  });

  it("falls back to the default for a ticket pattern that will not compile", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().importSettings(payloadOf({ commitTicketPattern: "([" }));
    // Not left as-is: the chip would silently never appear, with nothing on
    // screen saying the pattern is the reason.
    expect(store.useSettingsStore.getState().commitTicketPattern).toBe(
      "[A-Z][A-Z0-9]+-\\d+",
    );
  });

  it("keeps an empty ticket pattern — that is 'no chip', deliberately", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().importSettings(payloadOf({ commitTicketPattern: "" }));
    expect(store.useSettingsStore.getState().commitTicketPattern).toBe("");
  });

  it("falls back to 'git decides' for a diff tool name git cannot use", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("externalDiffTool", "meld");
    store.useSettingsStore
      .getState()
      .importSettings(payloadOf({ externalDiffTool: 'bcompare "$LOCAL"' }));
    // Empty is the documented safe value: it hands the choice back to git,
    // rather than failing every difftool click with a banner about a tool
    // nobody configured.
    expect(store.useSettingsStore.getState().externalDiffTool).toBe("");
  });

  it("keeps an empty diff tool name — that IS the default", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("externalDiffTool", "meld");
    store.useSettingsStore.getState().importSettings(payloadOf({ externalDiffTool: "" }));
    expect(store.useSettingsStore.getState().externalDiffTool).toBe("");
  });

  it("falls back to auto for a bad updateCheckMode", async () => {
    const store = await freshStore();
    for (const bad of ["weekly", "", true, 0]) {
      store.useSettingsStore.getState().set("updateCheckMode", "manual");
      store.useSettingsStore
        .getState()
        .importSettings(payloadOf({ updateCheckMode: bad }));
      expect(store.useSettingsStore.getState().updateCheckMode, String(bad)).toBe("auto");
    }
  });

  it("degrades unknown diff modes, density and pull mode", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().importSettings(
      payloadOf({
        diffViewMode: "sideways",
        diffContextMode: "everything",
        uiDensity: "cozy",
        defaultPullMode: "Yolo",
      }),
    );
    const s = store.useSettingsStore.getState();
    expect(s.diffViewMode).toBe("inline");
    expect(s.diffContextMode).toBe("wholeFile");
    expect(s.uiDensity).toBe("compact");
    expect(s.defaultPullMode).toBe("Rebase");
  });

  it("refuses a string where a toggle expects a boolean", async () => {
    const store = await freshStore();
    // `checked={"no"}` is a toggle stuck ON — the value reads truthy, so the
    // user sees the opposite of what the file said.
    store.useSettingsStore
      .getState()
      .importSettings(payloadOf({ pruneOnFetch: "no", addSignoff: 1 }));
    const s = store.useSettingsStore.getState();
    expect(s.pruneOnFetch).toBe(true);
    expect(s.addSignoff).toBe(false);
  });

  it("clamps the two numeric ranges the UI already clamps", async () => {
    const store = await freshStore();
    store.useSettingsStore
      .getState()
      .importSettings(payloadOf({ diffContextLines: 5000, autoFetchMinutes: 0 }));
    const s = store.useSettingsStore.getState();
    expect(s.diffContextLines).toBe(20);
    expect(s.autoFetchMinutes).toBe(1);
  });

  it("drops an unusable custom theme without losing the other settings", async () => {
    const store = await freshStore();
    const report = store.useSettingsStore.getState().importSettings(
      payloadOf({
        customThemes: ["not a theme", { name: "No colors" }],
        diffViewMode: "split",
      }),
    );
    expect(store.useSettingsStore.getState().customThemes).toEqual([]);
    expect(store.useSettingsStore.getState().diffViewMode).toBe("split");
    expect(report.changed).toContain("diffViewMode");
  });

  it("never lets an imported theme claim to be built in", async () => {
    const store = await freshStore();
    const base = store.BUILTIN_THEMES[0];
    store.useSettingsStore.getState().importSettings(
      payloadOf({
        customThemes: [
          {
            id: "sneaky",
            name: "Sneaky",
            mode: "dark",
            colors: base.colors,
            builtin: true,
          },
        ],
      }),
    );
    // A `builtin` flag makes the theme editor read-only — an imported theme
    // must stay editable and deletable.
    expect(store.useSettingsStore.getState().customThemes[0].builtin).toBeUndefined();
  });

  it("refuses a non-portable key even when a file carries one", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("lastCreateDir", "/Users/me/dev");
    const report = store.useSettingsStore
      .getState()
      .importSettings(payloadOf({ lastCreateDir: "/Users/someone-else/dev" }));
    // The deny-list has to hold in both directions, or "never in an export" is
    // only half a promise: a hand-edited file could still retarget the Clone
    // dialog on someone else's machine.
    expect(store.useSettingsStore.getState().lastCreateDir).toBe("/Users/me/dev");
    expect(report.changed).toEqual([]);
    expect(report.ignored).toEqual(["lastCreateDir"]);
  });

  it("leaves a setting the payload never mentions alone", async () => {
    const store = await freshStore();
    store.useSettingsStore.getState().set("updateCheckMode", "never");
    store.useSettingsStore.getState().set("lastCreateDir", "/Users/someone/dev");
    store.useSettingsStore.getState().importSettings(payloadOf({ diffViewMode: "split" }));
    const s = store.useSettingsStore.getState();
    // An older export that predates a setting must not silently re-enable the
    // update check for someone who turned it off.
    expect(s.updateCheckMode).toBe("never");
    // And the machine-specific key an export can never carry stays put.
    expect(s.lastCreateDir).toBe("/Users/someone/dev");
    expect(s.diffViewMode).toBe("split");
  });
});

describe("import reports rather than applying silently", () => {
  it("lists only the settings that actually changed", async () => {
    const store = await freshStore();
    const report = store.useSettingsStore.getState().importSettings(
      payloadOf({
        // Already the default, so importing it changes nothing.
        pruneOnFetch: true,
        diffViewMode: "split",
        addSignoff: true,
      }),
    );
    expect([...report.changed].sort()).toEqual(["addSignoff", "diffViewMode"]);
    expect(report.ignored).toEqual([]);
  });

  it("reports an empty change list for a file that matches the machine", async () => {
    const store = await freshStore();
    const json = store.useSettingsStore.getState().exportSettings();
    expect(store.useSettingsStore.getState().importSettings(json).changed).toEqual([]);
  });
});

describe("import refuses what it cannot read", () => {
  it("fails cleanly on a file that isn't JSON", async () => {
    const store = await freshStore();
    expect(() =>
      store.useSettingsStore.getState().importSettings("<html>not json</html>"),
    ).toThrow(/valid JSON/i);
    // …and leaves the store untouched.
    expect(store.useSettingsStore.getState().diffViewMode).toBe("inline");
  });

  it("fails cleanly on JSON that isn't a settings export", async () => {
    const store = await freshStore();
    for (const bad of ["[1,2,3]", "null", '"a string"', '{"version":1}']) {
      expect(() => store.useSettingsStore.getState().importSettings(bad), bad).toThrow(
        /settings export/i,
      );
    }
  });

  it("points a single-theme file at the right button", async () => {
    const store = await freshStore();
    const themeJson = store.useSettingsStore
      .getState()
      .exportTheme(store.BUILTIN_THEMES[0].id);
    expect(() => store.useSettingsStore.getState().importSettings(themeJson)).toThrow(
      /theme/i,
    );
  });

  it("rejects a payload whose kind is something else entirely", async () => {
    const store = await freshStore();
    expect(() =>
      store.useSettingsStore
        .getState()
        .importSettings(
          JSON.stringify({ kind: "some-other-app", version: 1, settings: {} }),
        ),
    ).toThrow(/settings export/i);
  });
});

describe("schema version", () => {
  it("stamps the current version on an export", async () => {
    const store = await freshStore();
    const payload = exported(store);
    expect(payload.version).toBe(store.SETTINGS_EXPORT_VERSION);
    expect(payload.kind).toBe("platypusgit-settings");
  });

  it("accepts a payload from a newer build key by key, and flags it", async () => {
    const store = await freshStore();
    const newer = store.SETTINGS_EXPORT_VERSION + 7;
    const report = store.useSettingsStore
      .getState()
      .importSettings(
        payloadOf({ diffViewMode: "split", warpDriveEnabled: true }, { version: newer }),
      );
    expect(report.fromNewerVersion).toBe(true);
    expect(report.version).toBe(newer);
    // Every field is validated on its own, so the settings this build DOES
    // know about still land — that is the whole reason not to reject.
    expect(store.useSettingsStore.getState().diffViewMode).toBe("split");
    expect(report.ignored).toEqual(["warpDriveEnabled"]);
  });

  it("does not flag a payload at or below the current version", async () => {
    const store = await freshStore();
    const report = store.useSettingsStore
      .getState()
      .importSettings(payloadOf({}, { version: 1 }));
    expect(report.fromNewerVersion).toBe(false);
    expect(report.version).toBe(1);
  });

  it("is a different notion from the localStorage key's version", async () => {
    // STORAGE_KEY is "pg-settings-v2" and has its own history; the payload
    // version describes the FILE format. Conflating them would mean a
    // localStorage migration silently invalidating everyone's saved exports.
    const store = await freshStore();
    expect(store.SETTINGS_EXPORT_VERSION).toBe(1);
    expect(STORAGE_KEY).toBe("pg-settings-v2");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════

describe("downloadSettings", () => {
  it("names the file it wrote, so the UI can say where it went", async () => {
    const store = await freshStore();
    const hrefs: string[] = [];
    const names: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn(() => "blob:settings") as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      names.push(this.download);
      hrefs.push(this.href);
    };
    try {
      const name = store.useSettingsStore.getState().downloadSettings();
      expect(name).toMatch(/^platypusgit-settings-\d{4}-\d{2}-\d{2}\.json$/);
      expect(names).toEqual([name]);
      expect(hrefs).toEqual(["blob:settings"]);
      // No anchor left behind in the document.
      expect(document.querySelectorAll("a")).toHaveLength(0);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
