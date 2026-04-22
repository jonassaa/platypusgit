import { open } from "@tauri-apps/plugin-dialog";
import { PGButton, PGIcon, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";

export function WelcomeScreen() {
  const openRepo = useRepoStore((s) => s.openRepo);
  const loading = useRepoStore((s) => s.loading);

  async function handleOpen() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") {
      await openRepo(selected);
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          padding: 32,
          background: "var(--bg-1)",
          border: "1px solid var(--border-0)",
          borderRadius: "var(--r-5)",
          boxShadow: "var(--shadow-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--r-4)",
            background: "oklch(0.72 0.15 235 / 0.12)",
            border: "1px solid oklch(0.72 0.15 235 / 0.35)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
          }}
        >
          <PGIcon name="repo" size={28} />
        </div>
        <div>
          <div
            style={{
              fontSize: "var(--fs-17)",
              fontWeight: 600,
              color: "var(--fg-0)",
              marginBottom: 4,
            }}
          >
            Welcome to PlatypusGit
          </div>
          <div style={{ fontSize: "var(--fs-13)", color: "var(--fg-2)" }}>
            Open a local repository to get started.
          </div>
        </div>
        <PGButton
          variant="primary"
          icon="folder"
          onClick={handleOpen}
          disabled={loading}
        >
          {loading ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <PGSpinner size={12} /> Opening…
            </span>
          ) : (
            "Open repository…"
          )}
        </PGButton>
        <div
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            marginTop: 4,
          }}
        >
          Pick any directory containing a{" "}
          <span style={{ color: "var(--fg-1)" }}>.git</span> folder.
        </div>
      </div>
    </div>
  );
}
