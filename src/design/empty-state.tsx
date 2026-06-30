import type { ReactNode } from "react";
import { PGIcon, type IconName } from "./icons";

export function PGEmpty({
  icon = "folder",
  title,
  children,
  action,
}: {
  icon?: IconName | string;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        gap: 8,
        textAlign: "center",
        color: "var(--fg-2)",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "var(--r-4)",
          background: "var(--bg-2)",
          border: "1px solid var(--border-1)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-3)",
        }}
      >
        <PGIcon name={icon} size={22} />
      </div>
      {title && (
        <div
          style={{
            fontWeight: 600,
            fontSize: "var(--fs-14)",
            color: "var(--fg-0)",
          }}
        >
          {title}
        </div>
      )}
      {children && (
        <div style={{ fontSize: "var(--fs-12)", maxWidth: 380 }}>
          {children}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
