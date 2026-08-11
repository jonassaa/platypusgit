import React from "react";

/** Labeled form row shared by CloneDialog and InitDialog. Lives here rather
 *  than inside either dialog file so neither has to import from the other's
 *  module just to reuse a presentational wrapper. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
