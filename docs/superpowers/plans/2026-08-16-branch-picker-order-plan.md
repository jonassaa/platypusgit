# Branch picker order — implementation plan

**Goal:** The default branch pins to the top of every branch list; everything
else falls in recency order, newest tip first. One backend field pair, one pure
comparator, three call sites.

**Architecture:** `BranchInfo` grows `tip_time` + `is_default`, filled by
`Libgit2Backend::branches` from data it already reads plus one detection pass per
call. The frontend gains `features/branches/orderBranches.ts` — pure, tested —
adopted by `BranchPicker`, `screens/Branches` and `features/palette/commands`.
No new `GitBackend` method, no new command, no new IPC surface, no store field.

**Tech Stack:** Rust + git2, React 18 + Zustand, vitest/RTL, WebdriverIO e2e.

**Design doc:** `docs/superpowers/specs/2026-08-16-branch-picker-order-spec.md`
**Issue:** [#135](https://github.com/jonassaa/platypusgit/issues/135)

## Global Constraints

- `src/lib/types.ts` mirrors `src-tauri/src/git/types.rs` **in the same commit**.
- `BranchInfo.tip` stays a full oid — do not touch it, do not shorten it.
- Import UI primitives from `@/design`; use `@/…` path aliases.
- New list-row surfaces opt into density (`var(--row-step)`). Nothing new here —
  the picker row already has it; do not regress it.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- A concurrent branch (#132, tag signing) is editing `git/types.rs`,
  `lib/types.ts` and the **tag** rows of `screens/Branches.tsx`. Keep every edit
  additive and tightly scoped to branch ordering — no reformatting, no reordering
  of neighbouring declarations.
- E2E is **not** run from this branch; the orchestrator serializes it centrally.

## File Structure

**Create:**
- `src/features/branches/orderBranches.ts` — `compareBranches` + `orderBranches`.
- `src/features/branches/orderBranches.test.ts`
- `src/features/branches/BranchPicker.test.tsx`

**Modify:**
- `src-tauri/src/git/types.rs` — two fields on `BranchInfo`.
- `src-tauri/src/git/libgit2.rs` — `detect_default_branch`, `is_default_branch_name`, and the two new fields in `branches()`.
- `src-tauri/tests/branches_tags.rs` — detection + `tip_time` coverage.
- `src/lib/types.ts` — the mirror.
- `src/features/branches/BranchPicker.tsx` — order the two memos, cursor rule, scroll-into-view.
- `src/screens/Branches.tsx` — order the `rows` memo within local/remote groups.
- `src/features/palette/commands.ts` — order inside `branchItems`.
- Component/unit tests that build a typed `BranchInfo` literal — add the two fields.
- `e2e/specs/branches.e2e.ts` — the pin assertion.

---

### Task 1: Backend fields + detection

- [x] `types.rs`: append `tip_time: i64` and `is_default: bool` to `BranchInfo`
      (append only — the struct is shared with #132's neighbours).
- [x] `libgit2.rs`: `fn detect_default_branch(repo: &Repository) -> Option<String>`
      — `origin` first then other remotes alphabetically, reading
      `refs/remotes/<remote>/HEAD`'s symbolic target and stripping the
      `refs/remotes/<remote>/` prefix; then local `main`/`master`/`trunk`; then
      `None`. Plus `fn is_default_branch_name(name: &str, is_remote: bool,
      default: Option<&str>) -> bool` — exact match for a local branch,
      `split_once('/').1` for a remote one.
- [x] `branches()`: call detection once before the loop; keep the tip oid in a
      binding so both `tip` (full string, unchanged) and `tip_time`
      (`find_commit(oid)?.time().seconds()`, `0` when unresolvable) come off it.
- [x] `branches_tags.rs`: `tip_time` reflects the tip's committer time and
      distinguishes two branches; `origin/HEAD` drives `is_default` on both the
      local and the `origin/<name>` row; local `main` fallback; `master` when
      `main` is absent; nothing marked when there is no candidate;
      `init.defaultBranch` is ignored.
- [x] `cargo check` + `cargo test --manifest-path src-tauri/Cargo.toml`.

### Task 2: Mirror the type, unblock the frontend

- [x] `lib/types.ts`: `tipTime: number; isDefault: boolean;` on `BranchInfo`.
- [x] `pnpm tsc --noEmit` — every typed `BranchInfo` literal in the test suite
      now errors; that list *is* the mirror's blast radius. Add the two fields to
      each, nothing else.

### Task 3: The comparator

- [x] `orderBranches.test.ts` first: default first regardless of `tipTime`;
      recency descending; ASCII name tiebreak on equal `tipTime`; a defaultless
      list is a pure recency sort; the input array is not mutated; the output is
      a permutation of the input (same multiset of names) — the §D guarantee that
      the pin cannot resurrect a filtered-out row.
- [x] `orderBranches.ts`: `compareBranches` + a generic `orderBranches` that
      copies before sorting.
- [x] `pnpm test`.

### Task 4: The three surfaces

- [x] `BranchPicker.tsx`: wrap both memos' results in `orderBranches` (after the
      filter, never before).
- [x] `screens/Branches.tsx`: in the `rows` memo, order each kind separately and
      keep locals before remotes in the `all` view.
- [x] `commands.ts`: `branchItems` orders after applying its optional `filter`.
- [x] `pnpm tsc --noEmit` + `pnpm test`.

### Task 5: Cursor rule + scroll-into-view (design §E)

- [x] `BranchPicker.test.tsx` first: rows come out default-first then by recency;
      a query excluding the default does not bring it back; the cursor starts on
      the HEAD row with an empty query; typing moves it to row 0.
- [x] `BranchPicker.tsx`: derive the resting index (`query === "" ? index of the
      local HEAD row : 0`, fallback 0) and apply it on open and on every query
      change; scroll the active row into view with `block: "nearest"` when
      `activeIndex` changes.
- [x] `pnpm test`.

### Task 6: E2E spec + full verification

- [x] `branches.e2e.ts`: in the `manyRefsRepo` describe, open the branch chip and
      assert the first `[data-branch-row]` reads `main` — 60 `feature/branch-NN`
      branches share one tip, so without the pin `feature/branch-00` would be
      first and `main` sixtieth. Every wait carries `timeout` + `timeoutMsg`.
- [x] `pnpm exec tsc -p e2e/tsconfig.json --noEmit`.
- [x] `pnpm tsc --noEmit`, `pnpm test`, `cargo check`, `cargo test`.
- [ ] **Not run here:** `pnpm test:e2e:docker`. Only one e2e container build may
      run at a time across all worktrees; the orchestrator runs it centrally.
- [x] Conventional commits, push, draft PR against #135.
