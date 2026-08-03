// Semver precedence comparison for the update prompt's dismiss memory.
//
// The backend already compares with the `semver` crate (src-tauri/src/update.rs)
// to decide `info.available`. The frontend needs the *same* ordering for one
// more question the backend can't answer: is `latestVersion` newer than the
// version the user dismissed? That value lives only in localStorage.
//
// Implements SemVer 2.0.0 §11 precedence: numeric core left-to-right, a
// prerelease sorts BELOW its release, prerelease identifiers compare
// dot-separated (numeric numerically, alphanumeric by ASCII, numeric < alpha,
// longer wins when all preceding are equal), and build metadata is ignored.

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty means "is a release". */
  pre: string[];
}

/** `null` when `v` is not valid semver (a leading `v` is tolerated). */
export function parseSemver(v: string): Parsed | null {
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    // Build metadata (m[5]) is deliberately dropped — §10 excludes it from
    // precedence entirely.
    pre: m[4] ? m[4].split(".") : [],
  };
}

const NUMERIC_RE = /^(?:0|[1-9]\d*)$/;

function comparePre(a: string[], b: string[]): number {
  // A version WITHOUT a prerelease outranks one with it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    const xNum = NUMERIC_RE.test(x);
    const yNum = NUMERIC_RE.test(y);
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1;
    // Numeric identifiers always rank lower than alphanumeric ones.
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  // All shared identifiers equal — the larger set wins.
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * `-1 | 0 | 1` by semver precedence, or `null` when either side is unparseable
 * (callers decide how to degrade rather than getting a made-up ordering).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  const p = comparePre(pa.pre, pb.pre);
  return p === 0 ? 0 : p < 0 ? -1 : 1;
}

/** True when `a` is strictly newer than `b`. Unparseable input → `false`. */
export function isNewerThan(a: string, b: string): boolean {
  return compareSemver(a, b) === 1;
}
