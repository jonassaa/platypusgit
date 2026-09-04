import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Linux architecture set is written down in five places that cannot see each
 * other, and adding the second one (#266) is what turned that from a fact into a
 * contract:
 *
 *   1. `release.yml`'s `linux` matrix — what actually gets BUILT.
 *   2. `apt-publish`'s `--deb`/`--pattern` flags and its per-architecture gate —
 *      what reaches the repository, and what is proven installable first.
 *   3. `updater-manifest`'s `latest.json` keys — who is offered a self-update.
 *   4. `install-platypusgit.sh`'s `SUPPORTED_ARCHES` — who the one-liner serves.
 *   5. `site/src/data/site.ts`'s `linuxArches` — what the download page offers.
 *
 * Every drift between them is SILENT in a different way, and none of them fails
 * a build:
 *
 *   - build it but not pool it: an asset nobody can `apt install`.
 *   - pool it but not widen the installer: the one-liner refuses a package the
 *     repository is serving.
 *   - pool it but not gate it: the first proof it installs is a user's machine.
 *   - build it but leave it out of latest.json: those installs never see an
 *     update again, and report nothing wrong.
 *   - build it but not link it: nobody finds it.
 *
 * So this suite reads all five and asserts they name the same architectures. It
 * lives in `test/` for the same reason `shardSpecs.test.ts` does — it is a fact
 * about the tree and about `.github/`, not about the frontend.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");
const INSTALLER = path.join(REPO_ROOT, "scripts", "install-platypusgit.sh");
const SITE_DATA = path.join(REPO_ROOT, "site", "src", "data", "site.ts");

const releaseYml = readFileSync(RELEASE_YML, "utf8");
const installer = readFileSync(INSTALLER, "utf8");
const siteData = readFileSync(SITE_DATA, "utf8");

/**
 * Debian's architecture name to the one Rust's `std::env::consts::ARCH` uses,
 * which is what the updater plugin builds its `{os}-{arch}` lookup key from. Two
 * names for one machine: the assets and the pool say `arm64`, `latest.json` says
 * `aarch64`. Pinned here because getting it wrong publishes a manifest no client
 * ever matches — which presents as "no update available", not as an error.
 */
const RUST_ARCH: Record<string, string> = {
  amd64: "x86_64",
  arm64: "aarch64",
};

/** The architectures the `linux` job's matrix actually builds. */
function matrixArches(): string[] {
  // Narrow to the `linux:` job first: `msix-build` has an `arch:` matrix too,
  // and matching across the whole file would silently mix Windows' x64/arm64
  // into the Linux set.
  const job = releaseYml.match(/^ {2}linux:\n(?: {3,}.*\n| *\n)*/m);
  if (!job) {
    throw new Error(
      "no `linux:` job found in .github/workflows/release.yml — the job was " +
        "renamed or reindented, so this suite can no longer read its matrix",
    );
  }
  const arches = [...job[0].matchAll(/^ +- arch: (\S+)$/gm)].map((m) => m[1]);
  if (arches.length === 0) {
    throw new Error(
      "the `linux:` job has no `- arch:` matrix entries — if the matrix was " +
        "replaced, this suite's five-way contract needs rewriting, not deleting",
    );
  }
  return arches.sort();
}

/** The architectures `install-platypusgit.sh` will add the repository for. */
function installerArches(): string[] {
  const m = installer.match(/^SUPPORTED_ARCHES="([^"]+)"$/m);
  if (!m) {
    throw new Error(
      "no SUPPORTED_ARCHES= line in scripts/install-platypusgit.sh — the " +
        "installer's architecture gate moved",
    );
  }
  return m[1].trim().split(/\s+/).sort();
}

/** The architectures the download page offers. */
function siteArches(): string[] {
  const block = siteData.match(/export const linuxArches = \[([\s\S]*?)\] as const;/);
  if (!block) {
    throw new Error(
      "no `linuxArches` array in site/src/data/site.ts — the download page's " +
        "architecture list moved",
    );
  }
  return [...block[1].matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]).sort();
}

describe("the Linux architecture set", () => {
  const arches = matrixArches();

  it("builds at least amd64 and arm64", () => {
    // A guard against the matrix being read as empty or half-read, which would
    // make every set comparison below vacuously true.
    expect(arches).toEqual(["amd64", "arm64"]);
  });

  it("gives every architecture its own runner", () => {
    // Two legs on one runner would build the same bundle twice and attach it
    // under two names — an arm64 asset that is quietly an amd64 binary.
    const job = releaseYml.match(/^ {2}linux:\n(?: {3,}.*\n| *\n)*/m)![0];
    const runners = [...job.matchAll(/^ +runner: (\S+)$/gm)].map((m) => m[1]);
    expect(runners).toHaveLength(arches.length);
    expect(new Set(runners).size).toBe(arches.length);
  });

  it("is the same set the one-line installer accepts", () => {
    expect(installerArches()).toEqual(arches);
  });

  it("is the same set the download page offers", () => {
    expect(siteArches()).toEqual(arches);
  });

  it("attaches a .deb and an .AppImage per architecture", () => {
    // The attach step is templated on `matrix.arch`, so what this checks is that
    // the stable names still carry the architecture at all — a rename back to a
    // fixed `PlatypusGit_amd64.deb` would attach one leg's bundle twice.
    expect(releaseYml).toContain(
      "src-tauri/target/release/bundle/deb/PlatypusGit_${{ matrix.arch }}.deb",
    );
    expect(releaseYml).toContain(
      "src-tauri/target/release/bundle/appimage/PlatypusGit_${{ matrix.arch }}.AppImage",
    );
  });

  it("pools and gates every architecture in apt-publish", () => {
    for (const arch of arches) {
      expect(releaseYml).toContain(`--pattern PlatypusGit_${arch}.deb`);
      expect(releaseYml).toContain(`--deb PlatypusGit_${arch}.deb`);
    }
    // The gate loop names them itself — one run of apt-repo-smoke.sh proves one
    // architecture, so an architecture missing from this list is published
    // without ever having been installed.
    const gate = releaseYml.match(/^ +for arch in (.+); do$/m);
    expect(gate?.[1].trim().split(/\s+/).sort()).toEqual(arches);
  });

  it("publishes updater keys for every architecture, in the Rust spelling", () => {
    for (const arch of arches) {
      const rust = RUST_ARCH[arch];
      expect(
        rust,
        `no Rust architecture name recorded for '${arch}' — add it to RUST_ARCH, ` +
          "because latest.json's keys are not the Debian spelling",
      ).toBeTruthy();
      for (const key of [`linux-${rust}`, `linux-${rust}-appimage`, `linux-${rust}-deb`]) {
        expect(releaseYml).toContain(`"${key}":`);
      }
      // And the URL those keys point at is the DEBIAN-named asset.
      expect(releaseYml).toContain(`PlatypusGit_${arch}.AppImage`);
      expect(releaseYml).toContain(`PlatypusGit_${arch}.deb`);
    }
  });

  it("collects one signature artifact per architecture", () => {
    // The reason the signatures are artifacts at all: a matrix job's outputs
    // collapse to one leg's values. A download step missing an architecture
    // leaves `latest.json` unable to be built, which is the safe failure — a
    // SHARED artifact name would be the unsafe one.
    expect(releaseYml).toContain("name: linux-sigs-${{ matrix.arch }}");
    for (const arch of arches) {
      expect(releaseYml).toContain(`name: linux-sigs-${arch}`);
      expect(releaseYml).toContain(`path: sigs/${arch}`);
    }
  });

  it("verifies the live repository from every architecture after publishing", () => {
    const job = releaseYml.match(/^ {2}apt-verify-live:\n(?: {3,}.*\n| *\n)*/m);
    expect(job, "no `apt-verify-live:` job found in release.yml").toBeTruthy();
    const verified = [...job![0].matchAll(/^ +- arch: (\S+)$/gm)].map((m) => m[1]).sort();
    expect(verified).toEqual(arches);
  });
});
