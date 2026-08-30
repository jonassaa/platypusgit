// "History is truncated here" — the strip a partly-cloned repository owes every
// surface it distorts (#255).
//
// One component, four surfaces, the shape `BlameScreen`'s ignore-revs warning
// already established: a strip UNDER the screen's header that says something
// about the data below it without replacing it. Never a modal, never an empty
// state — the screen still works, it is just answering a question with less
// than the whole repository.
//
// At the top of the screen rather than at the end of the list, even on History
// where the truncation literally IS the end of the list: a reader with five
// hundred commits loaded never scrolls there, and the fact is a property of the
// repository rather than of the current scroll position.

import { PGButton, PGIcon } from "@/design";

import { useRepoStore } from "./useRepoStore";
import { shallowNoticeText, type ShallowSurface } from "./shallowNoticeText";

export function ShallowNotice({ surface }: { surface: ShallowSurface }) {
  const info = useRepoStore((s) => s.shallowInfo);
  const unshallow = useRepoStore((s) => s.unshallow);
  // Any fetch counts, not only this one: `unshallow` files itself under the
  // `fetch` activity key (it is a fetch), and a second network op started from
  // the toolbar would queue behind it on the same repository anyway.
  const fetching = useRepoStore((s) => !!s.activity.fetch);

  const notice = shallowNoticeText(info, surface);
  if (!notice) return null;

  return (
    <div
      data-testid="shallow-notice"
      data-surface={surface}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid var(--border-0)",
        background: "var(--bg-1)",
        fontSize: "var(--fs-11)",
        flexShrink: 0,
      }}
    >
      <PGIcon
        name="warn"
        size={12}
        style={{ color: "var(--git-modified)", flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--git-modified)" }}>{notice.headline}</div>
        <div style={{ color: "var(--fg-3)" }}>{notice.detail}</div>
      </div>
      {notice.canUnshallow && (
        <PGButton
          size="sm"
          data-testid="shallow-unshallow"
          disabled={fetching}
          title="git fetch --unshallow — download the rest of the history"
          onClick={() => void unshallow()}
        >
          {fetching ? "Fetching…" : "Unshallow"}
        </PGButton>
      )}
    </div>
  );
}
