/**
 * FILE: packages/server/supabase/functions/_shared/codebase-index-plan.ts
 * PURPOSE: Decisions the GitHub indexer makes before it spends anything.
 *
 * 1. Which pushes may touch the index. There is one index per project, built
 *    from the default branch. Push indexing took any branch's `after` sha, so
 *    a feature-branch push overwrote default-branch code in the index (Plan
 *    020 §10.2 blocker 3).
 *
 * 2. Which chunks need an embedding. The sweep embedded every chunk and
 *    hashed it afterwards, so unchanged code was paid for again on every
 *    sweep (blocker 5). Chunks are now hashed first and compared with what is
 *    stored; only new or changed text is embedded. A chunk whose text is
 *    unchanged but whose row needs touching (tombstoned, imports changed) is
 *    refreshed without an embedding.
 *
 * Pure: no Deno globals, no I/O.
 */

export interface PushPayloadBranchFields {
  ref?: string
  deleted?: boolean
  after?: string
  repository?: { default_branch?: string }
}

export type PushBranchDecision =
  | { index: true; branch: string }
  | { index: false; branch: string | null; reason: 'not_a_branch' | 'branch_deleted' | 'non_default_branch' }

const ZERO_SHA = /^0{40}$/

/**
 * Index a push only when it lands on the repo's default branch. GitHub's own
 * `repository.default_branch` in the payload wins over Mushi's configured
 * value, which can be stale.
 */
export function pushBranchDecision(
  payload: PushPayloadBranchFields,
  configuredDefault: string | null,
): PushBranchDecision {
  const ref = payload.ref ?? ''
  if (!ref.startsWith('refs/heads/')) return { index: false, branch: null, reason: 'not_a_branch' }
  const branch = ref.slice('refs/heads/'.length)
  if (payload.deleted || (payload.after && ZERO_SHA.test(payload.after))) {
    return { index: false, branch, reason: 'branch_deleted' }
  }
  const defaultBranch = payload.repository?.default_branch || configuredDefault
  if (!defaultBranch || branch !== defaultBranch) {
    return { index: false, branch, reason: 'non_default_branch' }
  }
  return { index: true, branch }
}

export interface PlannedChunk {
  path: string
  symbolName: string | null
  /** sha256 of the chunk body. */
  hash: string
  /** Relative imports of the whole file this chunk belongs to. */
  imports: string[]
}

/** What is stored for a chunk that already has an embedding. */
export interface StoredChunk {
  content_hash: string | null
  imports: string[] | null
  tombstoned_at: string | null
}

export function chunkKey(path: string, symbolName: string | null): string {
  return `${path}\u0000${symbolName ?? ''}`
}

function sameImports(a: string[] | null, b: string[]): boolean {
  if (!a) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

/**
 * Split chunks into those that need an embedding, those whose stored row only
 * needs its metadata refreshed, and those to leave alone. `stored` must hold
 * only rows that HAVE an embedding; a row without one is re-embedded.
 */
export function planChunkWrites<T extends PlannedChunk>(
  chunks: T[],
  stored: Map<string, StoredChunk>,
): { embed: T[]; refresh: T[]; unchanged: number } {
  const embed: T[] = []
  const refresh: T[] = []
  let unchanged = 0
  for (const c of chunks) {
    const row = stored.get(chunkKey(c.path, c.symbolName))
    if (!row || row.content_hash !== c.hash) embed.push(c)
    else if (row.tombstoned_at || !sameImports(row.imports, c.imports)) refresh.push(c)
    else unchanged++
  }
  return { embed, refresh, unchanged }
}
