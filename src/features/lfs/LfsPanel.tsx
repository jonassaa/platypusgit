// LFS panel (#93) — a section on the Remote screen, not a screen of its own.
//
// `git lfs fetch/pull` are remote-object transfers whose endpoint is derived from
// the remote URL, so this belongs where remote plumbing already lives. A third
// activity-bar entry, empty for most repositories, would be worse.

import React from "react";
import { PGBadge, PGButton, PGIcon, PGSectionHeader } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { appErrorMessage } from "@/lib/errors";
import { PGPane, FocusableScroll } from "@/features/keymap";
import { lfsCounts, lfsDisabledReason, useLfsStore } from "./useLfsStore";

export function LfsPanel() {
  const repo = useRepoStore((s) => s.current);
  const status = useLfsStore((s) => s.status);
  const loading = useLfsStore((s) => s.loading);
  const busy = useLfsStore((s) => s.busy);
  const error = useLfsStore((s) => s.error);
  const refresh = useLfsStore((s) => s.refresh);

  React.useEffect(() => {
    if (repo) void refresh();
    else useLfsStore.getState().reset();
  }, [repo, refresh]);

  const disabled = lfsDisabledReason(status);
  const counts = lfsCounts(status);

  return (
    <PGPane id="remote.lfs">
      <FocusableScroll ariaLabel="Git LFS">
        <PGSectionHeader
          actions={
            <PGButton
              size="xs"
              variant="ghost"
              icon="sync"
              onClick={() => void refresh()}
              loading={loading}
            >
              Re-check
            </PGButton>
          }
        >
          GIT LFS
        </PGSectionHeader>
        <div
          data-testid="lfs-panel"
          data-installed={status?.installed ? "1" : "0"}
          data-in-use={status?.inUse ? "1" : "0"}
          style={{
            padding: 12,
            border: "1px solid var(--border-0)",
            borderRadius: "var(--r-3)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PGIcon name="lfs" size={14} style={{ color: "var(--accent)" }} />
            {/* Installed and in-use are separate facts, and the interesting case is
                exactly when they disagree: a repo that needs LFS on a machine that
                does not have it. */}
            {status?.installed ? (
              <PGBadge tone="success">{status.version ?? "installed"}</PGBadge>
            ) : (
              // PGBadge forwards no arbitrary attributes, so the panel's own
              // `data-installed` is the hook a test or spec keys off.
              <PGBadge tone="danger">git-lfs not installed</PGBadge>
            )}
            {status?.inUse ? (
              <PGBadge tone="accent">
                {status.patterns.length > 0
                  ? `${status.patterns.length} tracked pattern${status.patterns.length === 1 ? "" : "s"}`
                  : "in use"}
              </PGBadge>
            ) : (
              <PGBadge tone="muted">not used by this repository</PGBadge>
            )}
            {counts.total > 0 && (
              <span
                data-testid="lfs-counts"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-11)",
                  color: "var(--fg-2)",
                }}
              >
                {counts.materialized} materialized · {counts.pointers} pointer
                {counts.pointers === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {status?.patterns.length ? (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {status.patterns.join("  ")}
            </div>
          ) : null}

          {/* A missing binary is a STATE with a remedy, not an error banner. */}
          {status && !status.installed && status.inUse && (
            <div
              data-testid="lfs-install-hint"
              style={{ fontSize: "var(--fs-11)", color: "var(--git-modified)" }}
            >
              This repository stores large files with LFS, but git cannot find
              git-lfs. Install it and run <span className="mono">git lfs install</span>{" "}
              once — until then, LFS files stay as pointer text.
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{ fontSize: "var(--fs-11)", color: "var(--git-removed)" }}
            >
              {appErrorMessage(error)}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PGButton
              size="sm"
              variant="outline"
              icon="download"
              disabled={!!disabled}
              title={disabled ?? "Download LFS objects into .git/lfs"}
              loading={busy === "fetch"}
              onClick={() => void useLfsStore.getState().fetch()}
              data-testid="lfs-fetch"
            >
              Fetch objects
            </PGButton>
            <PGButton
              size="sm"
              variant="primary"
              icon="pull"
              disabled={!!disabled}
              title={disabled ?? "Fetch and materialize LFS files"}
              loading={busy === "pull"}
              onClick={() => void useLfsStore.getState().pull()}
              data-testid="lfs-pull"
            >
              Pull objects
            </PGButton>
            <PGButton
              size="sm"
              variant="outline"
              icon="check"
              disabled={!!disabled}
              title={disabled ?? "Replace pointers with objects already downloaded"}
              loading={busy === "checkout"}
              onClick={() => void useLfsStore.getState().checkout()}
              data-testid="lfs-checkout"
            >
              Checkout
            </PGButton>
            {disabled && (
              <span
                data-testid="lfs-disabled-reason"
                style={{
                  alignSelf: "center",
                  fontSize: "var(--fs-11)",
                  color: "var(--fg-2)",
                }}
              >
                {disabled}
              </span>
            )}
          </div>
        </div>
      </FocusableScroll>
    </PGPane>
  );
}
