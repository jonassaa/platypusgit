// Pull / merge requests (#92).
//
// Two panes: the list (primary, so screen entry focuses it) and a detail pane.
// Both own their scrolling via FocusableScroll — the shell is a fixed frame and
// the document will not provide a scrollbar.

import React from "react";

import {
  PGBadge,
  PGButton,
  PGEmpty,
  PGIcon,
  PGSectionHeader,
  pgConfirm,
  pgFlash,
} from "@/design";
import { FocusableScroll, PGPane, usePaneList } from "@/features/keymap";
import { useNavStore } from "@/features/nav/useNavStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { CreatePullRequestDialog } from "@/features/forge/CreatePullRequestDialog";
import { PullRequestRow } from "@/features/forge/PullRequestRow";
import {
  useForgeStore,
  type ForgeGate,
} from "@/features/forge/useForgeStore";
import {
  checksTone,
  forgeLabel,
  localBranchFor,
  prNoun,
  prNounPlural,
  prNumberLabel,
} from "@/features/forge/forgeLabels";
import { relativeTime } from "@/lib/derive";
import type { PullRequest } from "@/lib/types";

const LIST_PANE = "pulls.list";

export function PullsScreen() {
  const repo = useRepoStore((s) => s.current);
  const detection = useForgeStore((s) => s.detection);
  const forge = useForgeStore((s) => s.forge);
  const pulls = useForgeStore((s) => s.pulls);
  const selected = useForgeStore((s) => s.selected);
  const checks = useForgeStore((s) => s.checks);
  const loading = useForgeStore((s) => s.loading);
  const error = useForgeStore((s) => s.error);
  const createdUrl = useForgeStore((s) => s.createdUrl);
  const gate = useForgeStore((s) => s.gate)();

  // Re-detect whenever the open repository changes: remotes are per-repo, and a
  // stale detection would list another project's requests.
  React.useEffect(() => {
    void useForgeStore.getState().detect(repo?.id ?? null);
  }, [repo?.id]);

  const selectedPr = pulls.find((p) => p.number === selected) ?? null;

  // One extra request, for the selected row only. GitHub's PR list carries no
  // status, so a per-row column would cost one request per row per refresh.
  React.useEffect(() => {
    if (selected != null) void useForgeStore.getState().loadChecks(selected);
  }, [selected]);

  const selectedIndex = Math.max(
    0,
    pulls.findIndex((p) => p.number === selected),
  );

  usePaneList({
    paneId: LIST_PANE,
    count: pulls.length,
    selectedIndex,
    onSelect: (i) => useForgeStore.getState().select(pulls[i]?.number ?? null),
    onActivate: (i) => {
      const pr = pulls[i];
      if (pr) void useForgeStore.getState().openInBrowser(pr);
    },
    searchText: (i) => `${pulls[i]?.number} ${pulls[i]?.title ?? ""}`,
  });

  const noun = prNoun(forge?.kind ?? detection?.kind ?? null);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <PGSectionHeader
        actions={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <PGButton
              size="xs"
              variant="ghost"
              icon="sync"
              onClick={() => void useForgeStore.getState().refresh()}
              loading={loading}
              disabled={gate !== "ready"}
              data-testid="pulls-refresh"
            >
              Refresh
            </PGButton>
            <PGButton
              size="xs"
              variant="primary"
              icon="plus"
              onClick={() => useForgeStore.getState().openCreate()}
              disabled={gate !== "ready"}
              data-testid="pulls-new"
            >
              New {noun}
            </PGButton>
          </div>
        }
      >
        {detection
          ? `${prNounPlural(detection.kind).toUpperCase()} — ${detection.owner}/${detection.name}`
          : "PULL REQUESTS"}
      </PGSectionHeader>

      {createdUrl && (
        <div
          data-testid="pulls-created"
          style={{
            padding: "8px 14px",
            fontSize: "var(--fs-12)",
            borderBottom: "1px solid var(--border-0)",
            background: "oklch(from var(--accent) l c h / 0.08)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <PGIcon name="check" size={13} style={{ color: "var(--git-added)" }} />
          <span style={{ flex: 1 }}>
            Created{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>{createdUrl}</code>
          </span>
          <PGButton
            size="xs"
            variant="outline"
            icon="external"
            onClick={() =>
              void useForgeStore.getState().openInBrowser({ url: createdUrl })
            }
          >
            Open
          </PGButton>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 14px",
            fontSize: "var(--fs-12)",
            fontFamily: "var(--font-mono)",
            color: "var(--git-removed)",
            borderBottom: "1px solid oklch(0.68 0.18 25 / 0.35)",
            background: "oklch(0.68 0.18 25 / 0.1)",
          }}
        >
          {error}
        </div>
      )}

      {gate === "ready" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <PGPane id={LIST_PANE} primary style={{ flex: 1, minHeight: 0 }}>
            <FocusableScroll ariaLabel="Pull requests" testId="pulls-list">
              {pulls.length === 0 ? (
                <PGEmpty icon="pullRequest" title={`No open ${prNounPlural(forge!.kind)}`}>
                  Nothing is waiting for review on {forge!.owner}/{forge!.name}.
                </PGEmpty>
              ) : (
                pulls.map((pr) => (
                  <PullRequestRow
                    key={pr.number}
                    pr={pr}
                    kind={forge!.kind}
                    selected={pr.number === selected}
                    checks={checks[pr.number]}
                    onSelect={() => useForgeStore.getState().select(pr.number)}
                    onActivate={() =>
                      void useForgeStore.getState().openInBrowser(pr)
                    }
                  />
                ))
              )}
            </FocusableScroll>
          </PGPane>
          <PGPane
            id="pulls.detail"
            style={{
              height: 220,
              flexShrink: 0,
              borderTop: "1px solid var(--border-0)",
              background: "var(--bg-1)",
            }}
          >
            <FocusableScroll ariaLabel="Pull request detail">
              <PullDetail pr={selectedPr} />
            </FocusableScroll>
          </PGPane>
        </div>
      ) : (
        <GateEmpty gate={gate} />
      )}

      <CreatePullRequestDialog />
    </div>
  );
}

/** Why the list is not showing anything — every state distinct and actionable. */
function GateEmpty({ gate }: { gate: ForgeGate }) {
  const detection = useForgeStore((s) => s.detection);
  const toSettings = () =>
    useNavStore.getState().setIntent({ kind: "switch-screen", screen: "settings" });

  if (gate === "no-repo") {
    return (
      <PGEmpty icon="folder" title="No repository open">
        Open a repository whose remote points at GitHub or GitLab.
      </PGEmpty>
    );
  }
  if (gate === "no-forge") {
    return (
      <PGEmpty
        icon="pullRequest"
        title="No GitHub or GitLab remote found"
        // Deliberately NOT an error banner: a repository with no forge is a
        // state, not a failure (see the design doc).
      >
        This repository&apos;s remotes do not look like a forge. Add one with{" "}
        <span className="mono">git remote add</span>, then refresh.
      </PGEmpty>
    );
  }
  if (gate === "unknown-host") {
    return (
      <PGEmpty
        icon="link"
        title={`Which forge is ${detection?.host ?? "this host"}?`}
        action={
          <PGButton size="sm" variant="primary" onClick={toSettings}>
            Open Settings
          </PGButton>
        }
      >
        A self-hosted GitHub Enterprise and a self-hosted GitLab look identical in
        a git URL. Pick the forge for this host in Settings → Integrations.
      </PGEmpty>
    );
  }
  return (
    <PGEmpty
      icon="lock"
      title={`Add an API token for ${detection?.host ?? "this host"}`}
      action={
        <PGButton
          size="sm"
          variant="primary"
          onClick={toSettings}
          data-testid="pulls-open-settings"
        >
          Open Settings
        </PGButton>
      }
    >
      {detection?.kind ? forgeLabel(detection.kind) : "The forge"} needs an API
      token to list requests. It is a separate credential from the one git pushes
      with, and adding it does not change your push credential.
    </PGEmpty>
  );
}

function PullDetail({ pr }: { pr: PullRequest | null }) {
  const forge = useForgeStore((s) => s.forge);
  const detection = useForgeStore((s) => s.detection);
  const checks = useForgeStore((s) => s.checks);
  const checkingOut = useForgeStore((s) => s.checkingOut);

  if (!pr || !forge) {
    return (
      <div
        style={{
          padding: 16,
          fontSize: "var(--fs-12)",
          color: "var(--fg-3)",
        }}
      >
        Select a {prNoun(forge?.kind ?? null)} to see its details.
      </div>
    );
  }

  const local = localBranchFor(pr, forge.kind);
  const summary = checks[pr.number];

  const checkout = async () => {
    const store = useForgeStore.getState();
    const first = await store.checkout(pr);
    if (first === "ok") {
      // The store refreshed inside its retried closure; only the toast is ours.
      pgFlash(`Checked out ${local}`);
      return;
    }
    // "error" is already in the banner, and "auth-pending" means the credential
    // dialog is on screen — stacking an overwrite confirm on top of a password
    // prompt is exactly what the outcome type exists to prevent.
    if (first !== "branch-exists") return;
    if (
      !(await pgConfirm({
        title: `Overwrite the local branch ${local}?`,
        body: `${local} already exists. Checking this ${prNoun(forge.kind)} out resets it to the request's head, discarding any local commits on it.`,
        danger: true,
        confirmLabel: "Overwrite",
      }))
    ) {
      return;
    }
    if ((await store.checkout(pr, true)) === "ok") {
      pgFlash(`Checked out ${local}`);
    }
  };

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
            color: "var(--fg-2)",
          }}
        >
          {prNumberLabel(forge.kind, pr.number)}
        </span>
        <span style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>{pr.title}</span>
        {pr.draft && <PGBadge tone="warn">draft</PGBadge>}
        {pr.crossRepo && <PGBadge tone="default">fork</PGBadge>}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
          fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <Fact label="Author" value={pr.author} />
        <Fact label="From" value={pr.sourceBranch} />
        <Fact label="Into" value={pr.targetBranch} />
        <Fact label="Updated" value={updatedLabel(pr.updatedAt)} />
        <Fact
          label="Checks"
          value={summary ? summary.label : "—"}
          color={summary ? checksTone(summary.state) : undefined}
        />
        <Fact label="Checks out as" value={local} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <PGButton
          variant="outline"
          icon="external"
          onClick={() => void useForgeStore.getState().openInBrowser(pr)}
          data-testid="pull-open-browser"
        >
          Open in browser
        </PGButton>
        <PGButton
          variant="primary"
          icon="download"
          onClick={() => void checkout()}
          loading={checkingOut}
          disabled={!detection}
          data-testid="pull-checkout"
        >
          Check out {local}
        </PGButton>
      </div>
    </div>
  );
}

/**
 * The forges hand back an ISO timestamp, but a payload we cannot parse must not
 * render "NaN years ago" — `Date.parse` returns NaN rather than throwing.
 */
function updatedLabel(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : relativeTime(ms / 1000);
}

function Fact({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 8,
        background: "var(--bg-2)",
        border: "1px solid var(--border-0)",
        borderRadius: "var(--r-3)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          color: "var(--fg-2)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontSize: "var(--fs-10)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 2,
          color: color ?? "var(--fg-0)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
