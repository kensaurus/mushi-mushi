import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { chunkKey, planChunkWrites, pushBranchDecision, type StoredChunk } from '../_shared/codebase-index-plan.ts'

const SHA = 'a'.repeat(40)

Deno.test('only a push to the default branch is indexed', () => {
  const repo = { default_branch: 'master' }
  assertEquals(pushBranchDecision({ ref: 'refs/heads/master', after: SHA, repository: repo }, 'main'), {
    index: true,
    branch: 'master',
  })
  // A feature branch must not overwrite the default-branch index.
  assertEquals(pushBranchDecision({ ref: 'refs/heads/feat/x', after: SHA, repository: repo }, 'master'), {
    index: false,
    branch: 'feat/x',
    reason: 'non_default_branch',
  })
  // GitHub's own default wins over a stale configured one.
  assertEquals(pushBranchDecision({ ref: 'refs/heads/main', after: SHA, repository: repo }, 'main').index, false)
  // Without the payload field, the configured default decides.
  assertEquals(pushBranchDecision({ ref: 'refs/heads/main', after: SHA }, 'main').index, true)
})

Deno.test('deleted branches and tags are not indexed', () => {
  assertEquals(pushBranchDecision({ ref: 'refs/heads/master', deleted: true, after: '0'.repeat(40), repository: { default_branch: 'master' } }, null), {
    index: false,
    branch: 'master',
    reason: 'branch_deleted',
  })
  assertEquals(pushBranchDecision({ ref: 'refs/tags/v1.0.0', after: SHA }, 'master'), { index: false, branch: null, reason: 'not_a_branch' })
})

Deno.test('unchanged chunks are not embedded again', () => {
  const stored = new Map<string, StoredChunk>([
    [chunkKey('src/a.ts', 'foo'), { content_hash: 'h1', imports: ['./b'], tombstoned_at: null }],
    [chunkKey('src/a.ts', 'bar'), { content_hash: 'old', imports: ['./b'], tombstoned_at: null }],
    [chunkKey('src/c.ts', null), { content_hash: 'h3', imports: [], tombstoned_at: '2026-09-01T00:00:00Z' }],
    [chunkKey('src/d.ts', 'baz'), { content_hash: 'h4', imports: null, tombstoned_at: null }],
  ])
  const plan = planChunkWrites(
    [
      { path: 'src/a.ts', symbolName: 'foo', hash: 'h1', imports: ['./b'] }, // unchanged
      { path: 'src/a.ts', symbolName: 'bar', hash: 'h2', imports: ['./b'] }, // text changed
      { path: 'src/c.ts', symbolName: null, hash: 'h3', imports: [] }, // tombstoned, came back
      { path: 'src/d.ts', symbolName: 'baz', hash: 'h4', imports: ['./e'] }, // imports first recorded
      { path: 'src/new.ts', symbolName: null, hash: 'h5', imports: [] }, // never stored (or no embedding)
    ],
    stored,
  )
  assertEquals(plan.embed.map((c) => `${c.path}#${c.symbolName}`), ['src/a.ts#bar', 'src/new.ts#null'])
  assertEquals(plan.refresh.map((c) => `${c.path}#${c.symbolName}`), ['src/c.ts#null', 'src/d.ts#baz'])
  assertEquals(plan.unchanged, 1)
})
