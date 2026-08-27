// The commit-message composition surface (#252). See useCommitComposer.ts for
// what belongs here and why it is one surface rather than four widgets.
export { CommitMessageBar } from "./CommitMessageBar";
export type { CommitMessageBarProps } from "./CommitMessageBar";
export {
  SUBJECT_LIMIT,
  SUBJECT_SOFT_LIMIT,
  useCommitComposer,
} from "./useCommitComposer";
export type { CommitComposer, UseCommitComposerOptions } from "./useCommitComposer";
export {
  cleanupCommitMessage,
  commentLineCount,
  stripsComments,
  DEFAULT_COMMENT_PREFIX,
} from "./cleanup";
export type { CleanupMode, CleanupSpec } from "./cleanup";
export { DEFAULT_TICKET_PATTERN, extractTicket, isValidTicketPattern } from "./ticket";
export {
  CONVENTIONAL_TYPES,
  insertTicket,
  parseConventionalPrefix,
  subjectNamesTicket,
  subjectOf,
  withConventionalPrefix,
} from "./subject";
export type { ConventionalPrefix } from "./subject";
