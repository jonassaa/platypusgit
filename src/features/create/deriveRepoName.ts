/**
 * Folder name to prefill from a clone URL: the last non-empty path segment,
 * minus a trailing `.git` (case-insensitive).
 *
 * Parses URL grammar to distinguish hosts, ports, userinfo, and paths:
 * - HTTPS: `https://github.com/org/repo.git` → `repo`
 * - HTTPS with port: `https://gitlab.example.com:8443/org/repo.git` → `repo`
 * - HTTPS with userinfo: `https://user:pass@host/org/repo.git` → `repo`
 * - SSH scp-like: `git@github.com:org/repo.git` → `repo`
 * - SSH with scheme & port: `ssh://git@host:2222/org/repo.git` → `repo`
 * - Local absolute: `/srv/git/repo.git` → `repo`
 * - Local with scheme: `file:///srv/git/repo.git` → `repo`
 * - Windows paths: `C:\Users\me\repos\repo.git` → `repo`
 *
 * Returns empty string if the URL contains only a hostname with no path
 * (e.g., `https://github.com`, `https://gitlab.example.com:8443`).
 *
 * Deliberately string-based rather than `new URL()` — git's scp-like SSH form
 * (`git@host:org/repo.git`) is not a parseable URL, and it is the form most
 * hosting providers hand you by default.
 */
export function deriveRepoName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  // Strip query string and fragment
  const withoutTail = trimmed.split("?")[0].split("#")[0];

  // Strip leading scheme if present (e.g., https://, file://, ssh://)
  const schemeRegex = /^[a-z][a-z0-9+.-]*:\/\//i;
  const afterScheme = withoutTail.replace(schemeRegex, "");

  // Strip userinfo (everything up to and including the last @ before the first /)
  let withoutUserinfo = afterScheme;
  const firstSlashIndex = afterScheme.indexOf("/");
  const searchRange =
    firstSlashIndex === -1 ? afterScheme : afterScheme.slice(0, firstSlashIndex);
  const lastAtIndex = searchRange.lastIndexOf("@");
  if (lastAtIndex !== -1) {
    withoutUserinfo = afterScheme.slice(lastAtIndex + 1);
  }

  let path: string;

  // Check for port or scp-like form
  const colonIndex = withoutUserinfo.indexOf(":");
  if (colonIndex !== -1) {
    const afterColon = withoutUserinfo.slice(colonIndex + 1);
    // Check if this is a port (digits followed by / or end-of-string)
    const portMatch = afterColon.match(/^(\d+)(\/|$)/);
    if (portMatch) {
      // It's a port, take the remainder as path
      path = afterColon.slice(portMatch[1].length);
    } else {
      // It's the scp-like form
      path = afterColon;
    }
  } else if (withoutUserinfo.startsWith("/")) {
    // This is a local absolute path
    path = withoutUserinfo;
  } else {
    // This is a URL without a scheme, like "github.com/org/repo"
    // The first segment is the host, the rest is the path
    const slashIndex = withoutUserinfo.indexOf("/");
    if (slashIndex === -1) {
      // No slash found, so no path component - just a host
      return "";
    }
    path = withoutUserinfo.slice(slashIndex);
  }

  // Extract the last non-empty segment from the path
  // Split on both forward and backslash to handle Windows paths
  const segments = path.split(/[\/\\]/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? "";

  // Strip trailing .git (case-insensitive)
  return last.replace(/\.git$/i, "");
}
