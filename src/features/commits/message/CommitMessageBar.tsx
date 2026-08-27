// The commit composer's ONE affordance row (#252).
//
// Everything that helps write the message lives here, immediately under the box
// it writes into: the conventional-commit type picker, its scope, the ticket
// chip derived from the branch name, and the two advisories the composer owes
// the user (a template that could not be read, and comment lines a commit will
// silently drop).
//
// Nothing in this bar is required and nothing in it is modal. Every control
// composes plain text into the ordinary textarea and can be undone by editing
// that text — which is the whole design constraint the issue names: "it must
// stay possible to just type freely; a mandatory form here would be worse than
// nothing".
//
// `extra` is where the NEXT message-composition feature hangs its affordance
// (#250's assisted draft is the one queued behind this). One bar, not two.

import React from "react";

import { PGButton, PGInput, PGSelect } from "@/design";

import type { CommitComposer } from "./useCommitComposer";

export interface CommitMessageBarProps {
  composer: CommitComposer;
  /** Additional affordances for this same message box. See the note above. */
  extra?: React.ReactNode;
}

export function CommitMessageBar({ composer, extra }: CommitMessageBarProps) {
  const {
    type,
    scope,
    typeOptions,
    setType,
    setScope,
    ticket,
    ticketPresent,
    insertTicket,
    droppedComments,
    commentPrefix,
    strippingComments,
    templatePath,
    templateUnreadable,
  } = composer;

  return (
    <div
      data-testid="commit-message-bar"
      style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}
    >
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <PGSelect
          value={type}
          onChange={setType}
          options={typeOptions}
          size="sm"
          title="Conventional-commit type. Composes `type(scope): ` onto the subject line; clearing it takes the prefix back off."
          data-testid="commit-type"
        />
        <PGInput
          value={scope}
          onChange={setScope}
          // A scope with no type cannot be written down — `(ui): thing` is not
          // a conventional commit — so the field waits for one.
          disabled={!type}
          placeholder="scope"
          size="sm"
          mono
          title="Optional conventional-commit scope."
          style={{ width: 96 }}
          data-testid="commit-scope"
        />
        {ticket && (
          <PGButton
            size="xs"
            variant="outline"
            icon="tag"
            disabled={ticketPresent}
            title={
              ticketPresent
                ? `${ticket} is already in the subject`
                : `Insert ${ticket} — from the branch name`
            }
            onClick={insertTicket}
            data-testid="commit-ticket"
          >
            {ticket}
          </PGButton>
        )}
        {extra}
      </div>

      {templateUnreadable && (
        <Advisory testId="commit-template-missing" tone="warn">
          commit.template points at {templatePath ?? "a file"}, which could not
          be read.
        </Advisory>
      )}
      {/*
        Only where stripping actually applies — which is the template path. A
        message the user typed is `git commit -m`: `#123 fix the thing` is an
        ordinary subject, it commits as written, and telling the user otherwise
        would be worse than saying nothing.
      */}
      {strippingComments && droppedComments > 0 && (
        <Advisory testId="commit-comment-notice">
          {droppedComments} line{droppedComments !== 1 ? "s" : ""} starting with
          {" "}
          <code>{commentPrefix}</code> will be stripped, as git does from a
          template.
        </Advisory>
      )}
    </div>
  );
}

/**
 * A one-line note under the bar. Advisory in the strict sense: it never
 * disables Commit, it only says what is about to happen.
 */
function Advisory({
  children,
  testId,
  tone,
}: {
  children: React.ReactNode;
  testId: string;
  tone?: "warn";
}) {
  return (
    <div
      data-testid={testId}
      style={{
        fontSize: "var(--fs-10)",
        fontFamily: "var(--font-mono)",
        color: tone === "warn" ? "var(--git-modified)" : "var(--fg-3)",
      }}
    >
      {children}
    </div>
  );
}
