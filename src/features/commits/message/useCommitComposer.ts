// THE commit-message composition surface (#252).
//
// One hook and one bar, not four widgets sprinkled through CommitPanel. The
// four things this feature added — `commit.template` pre-fill, comment
// stripping, a ticket chip, a conventional-commit type picker — all read and
// rewrite the SAME plain-text box, so they share one place to live and one
// contract with the screen:
//
//     const composer = useCommitComposer({ repoId, branch, message, setMessage, amend });
//     <CommitMessageBar composer={composer} extra={…} />
//
// The next feature to compose commit-message text (#250, AI-assisted drafts)
// belongs HERE — a field on `CommitComposer` and an affordance in the bar's
// `extra` slot — rather than as a second surface growing beside this one. The
// issue's own comment is explicit that whichever landed first should own it.
//
// Two invariants everything here obeys:
//   * the textarea is the single source of truth. The picker parses the subject
//     back out on every render; nothing keeps a structured draft on the side.
//   * nothing overwrites text the user has already typed.

import React from "react";

import { getCommitTemplate } from "@/lib/tauri";
import type { CommitTemplate } from "@/lib/types";
import type { PGSelectOption } from "@/design";

import {
  cleanupCommitMessage,
  commentLineCount,
  stripsComments,
  DEFAULT_COMMENT_PREFIX,
  type CleanupSpec,
} from "./cleanup";
import { extractTicket } from "./ticket";
import {
  CONVENTIONAL_TYPES,
  insertTicket as insertTicketInto,
  parseConventionalPrefix,
  subjectNamesTicket,
  subjectOf,
  withConventionalPrefix,
} from "./subject";

/** The hard convention. Advisory — nothing in the app enforces it. */
export const SUBJECT_LIMIT = 72;
/** The softer one everybody also quotes, used only to warn earlier. */
export const SUBJECT_SOFT_LIMIT = 50;

export interface CommitComposer {
  /** Where `commit.template` pointed, when it is set. For naming it on screen. */
  templatePath: string | null;
  /** `commit.template` is set but its file could not be read. */
  templateUnreadable: boolean;
  /**
   * Put the template back in the box. Called by the screen immediately after a
   * commit has cleared it — `git commit` re-applies the template on every
   * commit, and a template that appears once is a template that does not work.
   *
   * Unlike the load-time seed this does NOT check whether the box is empty: the
   * caller has just emptied it, and React has not re-rendered yet, so the
   * hook's own view of the message is a render behind. The contract is in the
   * name — only call it having just cleared the box.
   */
  reseed: () => void;

  /** `core.commentChar` for this repo, `auto` already resolved. */
  commentPrefix: string;
  /** What a commit would actually store: git's cleanup applied to the box. */
  cleaned: string;
  /**
   * Whether this cleanup removes comment lines at all.
   *
   * False for a message the user typed — that is `git commit -m`, where `#123
   * fix the thing` is an ordinary subject and a forge renders it as an issue
   * link. True once `commit.template` has seeded the box, which is git's
   * editor path and the only place `#` lines arrive unasked.
   */
  strippingComments: boolean;
  /**
   * How many comment lines the cleanup drops — 0 whenever it drops none,
   * including when it is not stripping at all. Shown, never hidden.
   */
  droppedComments: number;

  /** The ticket the branch name carries, or null. */
  ticket: string | null;
  /** The subject already names it, so the chip has nothing left to do. */
  ticketPresent: boolean;
  insertTicket: () => void;

  /** The subject's current conventional type — PARSED, not stored. */
  type: string;
  scope: string;
  /** The conventional set, plus whatever type the subject already carries. */
  typeOptions: PGSelectOption[];
  setType: (t: string) => void;
  setScope: (s: string) => void;

  subjectLength: number;
}

export interface UseCommitComposerOptions {
  repoId: string | null;
  /** HEAD's branch name, for the ticket. Null on a detached HEAD. */
  branch: string | null;
  /** The regex that finds a ticket in the branch name. */
  ticketPattern: string;
  message: string;
  setMessage: (m: string) => void;
  /**
   * Amend prefills the box from HEAD. The template must never race that — the
   * message being rewritten is the one that already exists.
   */
  amend: boolean;
}

/**
 * The template body worth seeding with, or null. A whitespace-only template
 * would look like a no-op that ate the box.
 */
function seedBody(t: CommitTemplate | null): string | null {
  const body = t?.body;
  return body && body.trim() !== "" ? body : null;
}

export function useCommitComposer({
  repoId,
  branch,
  ticketPattern,
  message,
  setMessage,
  amend,
}: UseCommitComposerOptions): CommitComposer {
  const [template, setTemplate] = React.useState<CommitTemplate | null>(null);
  // Our stand-in for git's "is the message to be edited": true once the box's
  // text came from `commit.template`, which is the only way `#` lines get into
  // it without the user typing them. Deliberately NOT cleared when the user
  // edits or even wipes the box — git resolves this once, for the whole editor
  // session, and a template session that silently changes mode halfway would be
  // the harder behaviour to reason about.
  const [fromTemplate, setFromTemplate] = React.useState(false);

  // Read through refs inside the seed so the seeding effect depends on the
  // REPOSITORY, not on every keystroke: an effect that re-ran on `message`
  // would re-seed the moment someone cleared the box under their own cursor.
  const messageRef = React.useRef(message);
  messageRef.current = message;
  const amendRef = React.useRef(amend);
  amendRef.current = amend;
  const setMessageRef = React.useRef(setMessage);
  setMessageRef.current = setMessage;
  const templateRef = React.useRef<CommitTemplate | null>(null);

  const seed = React.useCallback((t: CommitTemplate | null) => {
    const body = seedBody(t);
    if (!body) return;
    // Never over an existing draft, and never while amending — the message
    // being amended is the one that already exists.
    if (amendRef.current) return;
    if (messageRef.current.trim() !== "") return;
    setMessageRef.current(body);
    setFromTemplate(true);
  }, []);

  React.useEffect(() => {
    // A different repository is a different template and a different answer to
    // "did this text come from one".
    setFromTemplate(false);
    if (!repoId) {
      templateRef.current = null;
      setTemplate(null);
      return;
    }
    let alive = true;
    void getCommitTemplate(repoId)
      .then((t) => {
        if (!alive) return;
        templateRef.current = t;
        setTemplate(t);
        seed(t);
      })
      .catch(() => {
        // A repository whose template cannot even be ASKED about still gets a
        // working commit screen. `unreadable` covers the case worth reporting
        // (a configured template that is not there); a failed command is a
        // backend problem the rest of the screen will already be shouting about.
        if (!alive) return;
        templateRef.current = null;
        setTemplate(null);
      });
    return () => {
      alive = false;
    };
  }, [repoId, seed]);

  const reseed = React.useCallback(() => {
    const body = seedBody(templateRef.current);
    if (!body) return;
    setMessageRef.current(body);
    setFromTemplate(true);
  }, []);

  const commentPrefix = template?.commentPrefix || DEFAULT_COMMENT_PREFIX;
  const spec = React.useMemo<CleanupSpec>(
    () => ({ mode: template?.cleanup ?? "default", commentPrefix, fromTemplate }),
    [template?.cleanup, commentPrefix, fromTemplate],
  );
  const cleaned = React.useMemo(
    () => cleanupCommitMessage(message, spec),
    [message, spec],
  );
  const strippingComments = stripsComments(spec);
  const droppedComments = React.useMemo(
    () => (strippingComments ? commentLineCount(message, commentPrefix) : 0),
    [strippingComments, message, commentPrefix],
  );

  const subject = subjectOf(message);
  const parsed = React.useMemo(() => parseConventionalPrefix(subject), [subject]);
  const type = parsed?.type ?? "";
  const scope = parsed?.scope ?? "";

  const typeOptions = React.useMemo<PGSelectOption[]>(() => {
    const base: PGSelectOption[] = CONVENTIONAL_TYPES.map((t) => ({
      value: t,
      label: t,
    }));
    // A subject already reading `wip: …` must not make the picker claim there
    // is no type — the control would then be lying about the text it edits.
    if (type && !CONVENTIONAL_TYPES.includes(type as (typeof CONVENTIONAL_TYPES)[number])) {
      base.push({ value: type, label: type });
    }
    return [{ value: "", label: "type…" }, ...base];
  }, [type]);

  const setType = React.useCallback(
    (t: string) => setMessage(withConventionalPrefix(message, t, scope)),
    [message, scope, setMessage],
  );
  const setScope = React.useCallback(
    (s: string) => setMessage(withConventionalPrefix(message, type, s)),
    [message, type, setMessage],
  );

  const ticket = React.useMemo(
    () => extractTicket(branch, ticketPattern),
    [branch, ticketPattern],
  );
  const ticketPresent = !!ticket && subjectNamesTicket(subject, ticket);
  const insertTicket = React.useCallback(() => {
    if (!ticket) return;
    setMessage(insertTicketInto(message, ticket));
  }, [message, setMessage, ticket]);

  return {
    templatePath: template?.path ?? null,
    templateUnreadable: !!template?.unreadable,
    reseed,
    commentPrefix,
    cleaned,
    strippingComments,
    droppedComments,
    ticket,
    ticketPresent,
    insertTicket,
    type,
    scope,
    typeOptions,
    setType,
    setScope,
    subjectLength: subject.length,
  };
}
