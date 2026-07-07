import { open } from "@tauri-apps/plugin-dialog";
import { PGButton, PGIcon, PGIconButton, PGLogo, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useRecentsStore } from "@/features/repo/useRecentsStore";

export function WelcomeScreen() {
  const openRepo = useRepoStore((s) => s.openRepo);
  const loading = useRepoStore((s) => s.loading);
  const recents = useRecentsStore((s) => s.recents);
  const removeRecent = useRecentsStore((s) => s.removeRecent);

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
            background: "color-mix(in oklab, var(--logo) 14%, transparent)",
            border: "1px solid color-mix(in oklab, var(--logo) 38%, transparent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PGLogo size={34} data-testid="pg-welcome-logo" title="PlatypusGit" />
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

        {recents.length > 0 && (
          <div
            style={{
              width: "100%",
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--border-0)",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: "var(--fs-10)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
                marginBottom: 8,
                paddingLeft: 4,
              }}
            >
              Recent
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recents.map((r) => {
                const name = r.path.split("/").filter(Boolean).pop() ?? r.path;
                return (
                  <div
                    key={r.path}
                    data-testid="recent-repo"
                    data-path={r.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: "var(--r-3)",
                      cursor: loading ? "default" : "pointer",
                      fontSize: "var(--fs-12)",
                      color: "var(--fg-0)",
                    }}
                    onClick={() => {
                      if (!loading) openRepo(r.path);
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-2)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <PGIcon
                      name="repo"
                      size={12}
                      style={{ color: "var(--accent)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {name}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-10)",
                          color: "var(--fg-3)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          direction: "rtl",
                          textAlign: "left",
                        }}
                        title={r.path}
                      >
                        {r.path}
                      </div>
                    </div>
                    <PGIconButton
                      icon="x"
                      size="sm"
                      title="Remove from recents"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(r.path);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
