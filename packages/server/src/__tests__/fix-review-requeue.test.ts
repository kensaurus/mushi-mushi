/**
 * FILE: fix-review-requeue.test.ts
 * PURPOSE: New commits on a reviewed PR (ADR 0030): `pull_request.synchronize`
 *          re-queues the review of the new head, a few minutes later so a
 *          burst of pushes is reviewed once, and KEEPS the old verdict so a
 *          hold keeps gating merges until the new review completes. A
 *          running review of the old head is superseded (its claim token is
 *          cleared). The indexer routes `synchronize` here.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { PUSH_REVIEW_DELAY_MS, requeueReviewForNewHead } from '../../supabase/functions/_shared/fix-review-db.ts'

const NOW = new Date('2026-10-21T09:00:00Z')
const TARGET = { fixAttemptId: 'fa-1', projectId: 'p-1', reportId: 'r-1', prUrl: 'https://github.com/a/b/pull/1' }

function review(over: Row = {}): Row {
  return {
    id: 'rev-1',
    fix_attempt_id: 'fa-1',
    project_id: 'p-1',
    status: 'completed',
    verdict: 'hold',
    head_sha: 'old',
    summary: 'Removes the resume flow.',
    reviewed_at: '2026-10-21T08:00:00Z',
    run_id: null,
    attempts: 1,
    ...over,
  }
}

describe('requeueReviewForNewHead', () => {
  it('re-queues a completed hold for the new head, later, keeping the verdict', async () => {
    const db = makeFakeDb({ fix_reviews: [review()] })
    expect(await requeueReviewForNewHead(db as never, TARGET, 'new', NOW)).toBe('requeued')
    expect(db.tables.fix_reviews[0]).toMatchObject({
      status: 'queued',
      verdict: 'hold',
      head_sha: 'old',
      run_id: null,
      attempts: 0,
      queued_at: new Date(NOW.getTime() + PUSH_REVIEW_DELAY_MS).toISOString(),
    })
  })

  it('supersedes a run still reviewing the old head', async () => {
    const db = makeFakeDb({ fix_reviews: [review({ status: 'running', run_id: 'run-old', verdict: null, head_sha: null })] })
    expect(await requeueReviewForNewHead(db as never, TARGET, 'new', NOW)).toBe('requeued')
    expect(db.tables.fix_reviews[0]).toMatchObject({ status: 'queued', run_id: null })
  })

  it('leaves PRs with no review, the same head, and a review already queued alone', async () => {
    const none = makeFakeDb({ fix_reviews: [] })
    expect(await requeueReviewForNewHead(none as never, TARGET, 'new', NOW)).toBe('no_review')
    expect(none.tables.fix_reviews ?? []).toHaveLength(0)

    const same = makeFakeDb({ fix_reviews: [review({ head_sha: 'new' })] })
    expect(await requeueReviewForNewHead(same as never, TARGET, 'new', NOW)).toBe('same_head')
    expect(same.tables.fix_reviews[0].status).toBe('completed')

    const queued = makeFakeDb({ fix_reviews: [review({ status: 'queued' })] })
    expect(await requeueReviewForNewHead(queued as never, TARGET, 'new', NOW)).toBe('already_queued')
  })

  it('the GitHub indexer routes pull_request.synchronize to it and skips the lifecycle event', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-github-indexer/index.ts'), 'utf8')
    expect(src).toMatch(/'synchronize',/)
    expect(src).toMatch(/payload\.action === 'synchronize'[\s\S]{0,900}requeueReviewForNewHead\(/)
    expect(src).toMatch(/requeueReviewForNewHead\([\s\S]{0,600}synchronize: true/)
  })
})
