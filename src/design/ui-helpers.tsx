import type { ReactNode } from "react";

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          color: "var(--fg-3)",
          width: 70,
          fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {k}
      </span>
      <span
        style={{
          flex: 1,
          color: "var(--fg-0)",
          fontSize: "var(--fs-12)",
        }}
      >
        {v}
      </span>
    </div>
  );
}
