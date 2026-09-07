import React from "react";
import type { CliPathState } from "@/lib/types";

/**
 * Shared by `cli.tsx`, `backup.tsx` and `updates.tsx` — all three show a
 * filesystem path or a shell command verbatim. Was three byte-identical
 * copies (`Settings.tsx`, `updates.tsx`, and `Settings.tsx` again for
 * `PathNote`'s use of it) before this module existed.
 */
export function Mono({
  children,
  selectable,
}: {
  children: React.ReactNode;
  selectable?: boolean;
}) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        ...(selectable ? { userSelect: "all" as const } : null),
      }}
    >
      {children}
    </code>
  );
}

/**
 * The PATH half of the answer. A shim in a directory the shell cannot see is
 * installed but unusable, so the state is surfaced with the line that fixes it
 * rather than hidden behind a successful install.
 */
export function PathNote({
  state,
  shimPath,
}: {
  state: CliPathState | null;
  shimPath?: string;
}) {
  if (state === null || state === "onPath") return null;
  // dirname, without importing a path helper for one call.
  const dir = shimPath?.replace(/[/\\][^/\\]*$/, "") ?? "";
  if (state === "pathAdded") {
    return (
      <div style={{ marginTop: 4 }}>
        Added <Mono>{dir}</Mono> to your PATH — open a new terminal.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <Mono>{dir}</Mono> is not on your PATH. Add it:{" "}
      <Mono selectable>{`export PATH="${dir}:$PATH"`}</Mono>
    </div>
  );
}
