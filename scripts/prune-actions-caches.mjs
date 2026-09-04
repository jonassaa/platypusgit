#!/usr/bin/env node
//
// Keep the repository's Actions cache under GitHub's 10 GB ceiling.
//
// WHY THIS EXISTS. Over the ceiling, GitHub evicts least-recently-used entries,
// and the jobs that lose are the ones that run least often — the release
// builds. Measured on the v0.6.0 release, with usage at 10.73 GB:
//
//   macos-universal  No cache found.
//   msix             No cache found.
//   linux            Restored ... full match: false.
//   windows          Restored ... full match: false.
//
// A cold Rust build measured 577s against 259s warm. Nothing was broken; the
// quota was simply full of caches nothing would ever read again.
//
// Only the macOS miss there was eviction — it had a main-scoped entry on
// 2026-08-31 and had lost it by 2026-09-03 while its siblings survived. `msix`
// never had one to lose. Pruning buys the headroom for a warm release cache to
// SURVIVE; it cannot create one, because a tag-triggered release saves to the
// tag's own scope and only a workflow_dispatch run writes to `main`. See
// docs/dev/testing.md.
//
// WHAT IT DELETES. Four rules, each logged with its reason:
//
//   dead-branch   the cache's ref is a branch that no longer exists
//   closed-pr     refs/pull/<n>/merge where the PR is no longer open
//   old-tag       a release tag's caches, except the newest tag's — a tag ref
//                 can only be read by runs on that same tag, and a
//                 workflow_dispatch re-run of release.yml happens on the
//                 DEFAULT BRANCH, so these are unreachable the moment the next
//                 tag exists
//   stale-gen     older generations of the same cache family (see FAMILIES) —
//                 rust-cache and friends key on content hashes, so every
//                 toolchain or lockfile change strands the previous
//                 multi-hundred-MB entry as, at best, a partial restore-key
//                 match
//
// It never deletes the newest generation of anything, and never touches a
// cache on a ref it cannot prove is dead. `test/pruneCaches.test.ts` pins both
// of those, because the cost of a wrong answer here is silently deleting the
// cache of the release that is building right now.
//
// Usage: node scripts/prune-actions-caches.mjs [--dry-run] [--repo owner/name]
// Requires `gh` authenticated with `actions: write` on the repo.

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Cache families that keep only their newest N generations.
 *
 * `strip` is how many trailing dash-separated segments are the varying part of
 * the key, so removing them yields the family name:
 *
 *   v0-rust-build-Linux-x64-0b9fd15e-84d09117  ->  v0-rust-build-Linux-x64
 *   node-cache-Linux-x64-pnpm-4b7e04be…        ->  node-cache-Linux-x64-pnpm
 *   codeql-overlay-base-database-1-<h>-javascript-2.26.4-<sha>-<run>-1
 *                                              ->  codeql-…-javascript-2.26.4
 *
 * `keep` is how many of the newest to spare. Rust keeps 1: a superseded
 * generation is only ever reachable as a partial restore-key match, and the
 * measured cost of holding one was 1.6 GB across two jobs. CodeQL and node keep
 * 2 — they are ~100 MB and ~80 MB, cheap insurance against a bad newest entry.
 */
export const FAMILIES = [
    { match: /^v0-rust-/, strip: 2, keep: 1 },
    { match: /^codeql-/, strip: 3, keep: 2 },
    { match: /^node-cache-/, strip: 1, keep: 2 },
]

/**
 * The `ref` GitHub reports on a cache is not a plain ref: a tag arrives as
 * `refs/heads/refs/tags/v0.6.0`, i.e. with `refs/heads/` glued onto the front
 * of an already-qualified ref. Unwrap before deciding anything — reading that
 * as a BRANCH named `refs/tags/v0.6.0` finds no such branch and deletes the
 * live release's caches.
 */
export function classifyRef(ref) {
    if (ref.startsWith('refs/pull/')) {
        return { kind: 'pr', name: ref.split('/')[2] }
    }
    const inner = ref.replace(/^refs\/heads\//, '')
    if (inner.startsWith('refs/tags/')) {
        return { kind: 'tag', name: inner.slice('refs/tags/'.length) }
    }
    return { kind: 'branch', name: inner }
}

/**
 * Which tag's caches are still worth keeping.
 *
 * Derived from the cache list itself rather than from `repos/:repo/tags`, whose
 * ordering is not documented as newest-first — and a wrong answer there deletes
 * the caches of the release currently building. The tag that most recently
 * WROTE a cache is, by construction, the one whose jobs last ran.
 */
export function newestCachedTag(caches) {
    let best = null
    for (const cache of caches) {
        const ref = classifyRef(cache.ref)
        if (ref.kind !== 'tag') continue
        if (!best || new Date(cache.created_at) > new Date(best.at)) {
            best = { name: ref.name, at: cache.created_at }
        }
    }
    return best?.name ?? null
}

/**
 * Decide what to delete. Pure: no network, no clock, no filesystem.
 *
 * @param caches      the `actions_caches` array as GitHub returns it
 * @param liveBranches Set of branch names that still exist on the remote
 * @param openPrs     Set of open PR numbers, as strings
 * @returns [{ cache, reason }] — every entry that should be deleted
 */
export function planPrune(caches, { liveBranches, openPrs }) {
    const doomed = new Map() // id -> {cache, reason}
    const condemn = (cache, reason) => {
        if (!doomed.has(cache.id)) doomed.set(cache.id, { cache, reason })
    }

    const newestTag = newestCachedTag(caches)

    for (const cache of caches) {
        const ref = classifyRef(cache.ref)
        if (ref.kind === 'pr' && !openPrs.has(ref.name)) {
            condemn(cache, `closed-pr (#${ref.name})`)
        } else if (ref.kind === 'tag' && ref.name !== newestTag) {
            condemn(cache, `old-tag (${ref.name}, newest is ${newestTag})`)
        } else if (ref.kind === 'branch' && !liveBranches.has(ref.name)) {
            condemn(cache, `dead-branch (${ref.name})`)
        }
    }

    // Generation pruning runs over the SURVIVORS only: a cache already condemned
    // for a dead ref must not occupy a keep-slot its family owes to a live one.
    const families = new Map()
    for (const cache of caches) {
        if (doomed.has(cache.id)) continue
        const rule = FAMILIES.find((f) => f.match.test(cache.key))
        if (!rule) continue
        const parts = cache.key.split('-')
        if (parts.length <= rule.strip) continue
        // Scoped by ref: `main`'s copy of a family and a tag's copy live in
        // different cache scopes and cannot substitute for each other.
        const family = `${cache.ref}::${parts.slice(0, -rule.strip).join('-')}`
        if (!families.has(family)) families.set(family, { rule, entries: [] })
        families.get(family).entries.push(cache)
    }

    for (const [family, { rule, entries }] of families) {
        if (entries.length <= rule.keep) continue
        entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        for (const cache of entries.slice(rule.keep)) {
            condemn(cache, `stale-gen (${family.split('::')[1]}, keeping ${rule.keep})`)
        }
    }

    return [...doomed.values()]
}

// --- CLI ---------------------------------------------------------------------

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const ghJson = (...a) => JSON.parse(gh(...a))
const MB = (b) => Math.round(b / 1024 / 1024)
const lines = (s) => s.split('\n').filter(Boolean)

function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes('--dry-run')
    const repoFlag = args.indexOf('--repo')
    const repo = repoFlag === -1 ? process.env.GITHUB_REPOSITORY : args[repoFlag + 1]

    if (!repo) {
        console.error('No repository: pass --repo owner/name or set GITHUB_REPOSITORY.')
        process.exit(2)
    }

    // `--slurp` is load-bearing with `--paginate`: without it gh emits ONE JSON
    // document per page, so a second page turns the output into `{…}{…}` and
    // JSON.parse throws. It cannot be combined with `--jq` (gh rejects the
    // pair), which is why the flattening happens here instead.
    const caches = ghJson(
        'api',
        '--paginate',
        '--slurp',
        `repos/${repo}/actions/caches?per_page=100`,
    ).flatMap((page) => page.actions_caches ?? [])

    const liveBranches = new Set(
        lines(gh('api', '--paginate', `repos/${repo}/branches?per_page=100`, '--jq', '.[].name')),
    )
    const openPrs = new Set(
        lines(
            gh('api', '--paginate', `repos/${repo}/pulls?state=open&per_page=100`, '--jq', '.[].number'),
        ),
    )

    const doomed = planPrune(caches, { liveBranches, openPrs })
    const before = caches.reduce((n, c) => n + c.size_in_bytes, 0)
    const freed = doomed.reduce((n, { cache }) => n + cache.size_in_bytes, 0)

    console.log(`${caches.length} caches, ${MB(before)} MB total`)
    console.log(`${doomed.length} to delete, ${MB(freed)} MB`)

    let failed = 0
    for (const { cache, reason } of doomed) {
        const label = `${MB(cache.size_in_bytes)}MB ${reason} ${cache.key}`
        if (dryRun) {
            console.log(`would delete: ${label}`)
            continue
        }
        try {
            gh('api', '-X', 'DELETE', `repos/${repo}/actions/caches/${cache.id}`)
            console.log(`deleted: ${label}`)
        } catch (err) {
            // A cache can disappear between the listing and the delete (another
            // run evicted it, or its branch was pruned). That is the outcome we
            // wanted, so warn and keep going rather than failing the prune.
            failed++
            console.warn(`could not delete ${cache.id} (${cache.key}): ${err.message.split('\n')[0]}`)
        }
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
        const rows = [...doomed]
            .sort((a, b) => b.cache.size_in_bytes - a.cache.size_in_bytes)
            .map(({ cache, reason }) => `| ${MB(cache.size_in_bytes)} MB | ${reason} | \`${cache.key}\` |`)
        const summary = [
            `### Actions cache prune${dryRun ? ' (dry run)' : ''}`,
            '',
            `**Before:** ${caches.length} entries, ${MB(before)} MB`,
            `**${dryRun ? 'Would free' : 'Freed'}:** ${MB(freed)} MB across ${doomed.length} entries`,
            `**After:** ~${MB(before - freed)} MB against GitHub's 10240 MB ceiling`,
            '',
            ...(rows.length
                ? ['| Size | Reason | Key |', '| --- | --- | --- |', ...rows]
                : ['Nothing to prune.']),
        ].join('\n')
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
    }

    // A failed delete is reported, never fatal: the next run retries it, and a
    // red scheduled job nobody is waiting on is a notification people learn to
    // ignore. A throw above (bad auth, API down) still exits non-zero.
    if (failed) console.log(`${failed} delete(s) did not apply; the next run retries them.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
