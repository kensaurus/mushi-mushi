/**
 * FILE: ci-cost-fix-rollout.test.ts
 * PURPOSE: The "Apply to every app" preview (_shared/ci-cost-fix-rollout.ts):
 *          autofix advice grouped per app and repo with the saving per item
 *          and per repo, unpriced items never read as $0, an edit whose PR is
 *          open or in flight is not ready, duplicates from the two advice
 *          lists collapse to the priced one, and the workflow-write reason
 *          shows only when Mushi already knows it.
 */

import { describe, expect, it } from 'vitest'
import { buildRolloutPreview, rolloutKey, type RolloutJobRow } from '../../supabase/functions/_shared/ci-cost-fix-rollout.ts'
import type { CiCostFixKind, CiOverviewAdvice } from '../../supabase/functions/_shared/ci-overview-types.ts'

const A = '1000000a-0000-4000-8000-000000000000'
const B = '1000000b-0000-4000-8000-000000000000'
const VIEWER = '1000000c-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const caps = { reposPerRequest: 10, itemsPerRepo: 20 }

function advice(projectId: string, repo: string, workflowPath: string, kind: CiCostFixKind, monthSavingUsd: number | null = null): CiOverviewAdvice {
  return {
    id: `${kind}:${repo}:${workflowPath}`,
    severity: 'low',
    title: `title ${kind}`,
    detail: 'd',
    evidence: `evidence ${workflowPath}`,
    fix: 'f',
    repo,
    monthSavingUsd,
    autofix: { kind, projectId, repo, workflowPath },
  }
}

function job(over: Partial<RolloutJobRow>): RolloutJobRow {
  return { project_id: A, repo: 'acme/app', workflow_path: '.github/workflows/ci.yml', kind: 'skip_drafts', status: 'refused', pr_url: null, merged_at: null, closed_at: null, error_code: null, created_at: '2026-10-27T10:00:00Z', ...over }
}

const projects = [{ id: A, name: 'App' }, { id: B, name: 'Web' }]

describe('buildRolloutPreview', () => {
  it('groups per app and repo, totals the priced ready items, keeps unpriced ones as not priced', () => {
    const p = buildRolloutPreview({
      now: NOW,
      projects,
      jobs: [],
      workflowsAbility: () => null,
      caps,
      advice: [
        advice(A, 'acme/app', '.github/workflows/ci.yml', 'skip_drafts'),
        advice(A, 'acme/app', '.github/workflows/nightly.yml', 'weekly_cron', 2.5),
        advice(B, 'acme/web', '.github/workflows/ci.yml', 'ignore_docs_paths', 7.126),
        // Advice without an autofix, and an app the caller cannot change, are left out.
        { ...advice(A, 'acme/app', '.github/workflows/x.yml', 'add_concurrency'), autofix: null },
        advice(VIEWER, 'acme/secret', '.github/workflows/ci.yml', 'skip_drafts', 99),
      ],
    })
    expect(p.repos.map((r) => r.repo)).toEqual(['acme/web', 'acme/app'])
    expect(p.repos[0]).toMatchObject({ projectName: 'Web', readyItems: 1, monthSavingUsd: 7.13, unpricedItems: 0, block: null })
    expect(p.repos[1]).toMatchObject({ projectName: 'App', readyItems: 2, monthSavingUsd: 2.5, unpricedItems: 1 })
    expect(p.repos[1].items.map((i) => [i.kind, i.monthSavingUsd])).toEqual([['weekly_cron', 2.5], ['skip_drafts', null]])
    expect(p.totals).toEqual({ repos: 2, readyItems: 3, monthSavingUsd: 9.63, unpricedItems: 1 })
    expect(p.caps).toEqual(caps)
  })

  it('marks an edit whose PR is still open or that is in flight, and leaves it out of the saving', () => {
    const p = buildRolloutPreview({
      now: NOW,
      projects,
      workflowsAbility: () => null,
      caps,
      advice: [
        advice(A, 'acme/app', '.github/workflows/ci.yml', 'skip_drafts', 1),
        advice(A, 'Acme/App', '.github/workflows/ci.yml', 'add_concurrency', 2),
        advice(A, 'acme/app', '.github/workflows/n.yml', 'weekly_cron', 4),
      ],
      jobs: [
        job({ status: 'pr_opened', pr_url: 'https://github.com/acme/app/pull/9' }),
        job({ kind: 'add_concurrency', repo: 'acme/app', status: 'queued' }),
        // An older merged PR for weekly_cron does not block a new one.
        job({ kind: 'weekly_cron', workflow_path: '.github/workflows/n.yml', status: 'pr_opened', merged_at: '2026-10-01T00:00:00Z' }),
      ],
    })
    const items = Object.fromEntries(p.repos[0].items.map((i) => [i.kind, i]))
    expect(items.skip_drafts).toMatchObject({ state: 'pr_open', prUrl: 'https://github.com/acme/app/pull/9' })
    expect(items.add_concurrency).toMatchObject({ state: 'in_progress', prUrl: null })
    expect(items.weekly_cron.state).toBe('ready')
    expect(p.repos[0]).toMatchObject({ readyItems: 1, monthSavingUsd: 4 })
  })

  it('collapses the same edit from both advice lists to the priced one', () => {
    const p = buildRolloutPreview({
      now: NOW,
      projects,
      jobs: [],
      workflowsAbility: () => null,
      caps,
      advice: [advice(A, 'acme/app', '.github/workflows/ci.yml', 'skip_drafts'), advice(A, 'acme/app', '.github/workflows/ci.yml', 'skip_drafts', 3)],
    })
    expect(p.repos[0].items).toHaveLength(1)
    expect(p.repos[0].items[0].monthSavingUsd).toBe(3)
    expect(p.repos[0].items[0].key).toBe(rolloutKey({ projectId: A, repo: 'acme/app', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' }))
  })

  it('carries the workflow-write reason only when the setup check or the last attempt knows it', () => {
    const a = [advice(A, 'acme/app', '.github/workflows/ci.yml', 'skip_drafts'), advice(B, 'acme/web', '.github/workflows/ci.yml', 'skip_drafts')]
    const probed = buildRolloutPreview({ now: NOW, projects, jobs: [], caps, advice: a, workflowsAbility: (pid) => (pid === A ? 'no' : 'unknown') })
    expect(probed.repos.find((r) => r.repo === 'acme/app')!.block).toMatchObject({ code: 'GITHUB_WORKFLOWS_WRITE_MISSING', source: 'setup_check' })
    expect(probed.repos.find((r) => r.repo === 'acme/web')!.block).toBeNull()

    const failed = job({ project_id: B, repo: 'acme/web', status: 'failed', error_code: 'GITHUB_WORKFLOWS_WRITE_MISSING' })
    const lastAttempt = buildRolloutPreview({ now: NOW, projects, caps, advice: a, workflowsAbility: () => null, jobs: [failed] })
    expect(lastAttempt.repos.find((r) => r.repo === 'acme/web')!.block).toMatchObject({ source: 'last_attempt' })
    // A newer successful PR, or a probe that proves the permission, clears it.
    const fixed = buildRolloutPreview({ now: NOW, projects, caps, advice: a, workflowsAbility: () => null, jobs: [job({ project_id: B, repo: 'acme/web', status: 'pr_opened', kind: 'add_concurrency' }), failed] })
    expect(fixed.repos.find((r) => r.repo === 'acme/web')!.block).toBeNull()
    const proven = buildRolloutPreview({ now: NOW, projects, caps, advice: a, workflowsAbility: () => 'yes', jobs: [failed] })
    expect(proven.repos.find((r) => r.repo === 'acme/web')!.block).toBeNull()
  })
})
