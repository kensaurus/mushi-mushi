/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-fix-rollout.ts
 * PURPOSE: The "Apply to every app" preview (ADR 0047 amendment 2026-10-27):
 *          every CI advice item that carries an `autofix`, for the apps the
 *          caller may change, grouped per app and repo with the estimated
 *          saving per item and per repo. The advisor already leaves `autofix`
 *          off where the worker would refuse (predictableRefusals in
 *          ci-cost-fix.ts, the gating in ci-advisor.ts / ci-cost-rules.ts),
 *          so every item here is one Mushi expects to make.
 *
 *          Each item also says whether it can be opened now: `ready`, or
 *          `pr_open` (a cost-fix PR for that edit is still open) or
 *          `in_progress` (queued or running). A repo where Mushi already
 *          knows its GitHub access cannot edit workflow files (the setup
 *          check, or the last attempt failing on it) carries that reason.
 *
 *          A saving Mushi cannot price stays null ("not priced"), never 0.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import type { CiCostFixKind, CiOverviewAdvice } from './ci-overview-types.ts'

type RolloutItemState = 'ready' | 'pr_open' | 'in_progress'

interface RolloutItem {
  /** `projectId:repo(lowercase):workflowPath:kind`, the key the console's fix buttons use. */
  key: string
  projectId: string
  repo: string
  workflowPath: string
  kind: CiCostFixKind
  adviceId: string
  title: string
  evidence: string
  /** Estimated USD per 30 days; null when Mushi cannot price this fix. */
  monthSavingUsd: number | null
  state: RolloutItemState
  /** The open PR, when `state` is `pr_open`. */
  prUrl: string | null
}

interface RolloutBlock {
  code: 'GITHUB_WORKFLOWS_WRITE_MISSING'
  message: string
  /** Where Mushi learned it: the setup check's probe, or the last fix attempt. */
  source: 'setup_check' | 'last_attempt'
}

interface RolloutRepo {
  projectId: string
  projectName: string | null
  repo: string
  items: RolloutItem[]
  /** Items that can be opened now. */
  readyItems: number
  /** The priced saving of the ready items (USD / 30 days). */
  monthSavingUsd: number
  /** Ready items Mushi could not price. */
  unpricedItems: number
  block: RolloutBlock | null
}

interface RolloutPreview {
  generatedAt: string
  repos: RolloutRepo[]
  totals: { repos: number; readyItems: number; monthSavingUsd: number; unpricedItems: number }
  caps: { reposPerRequest: number; itemsPerRepo: number }
  /** Set when part of the advice could not be read; the list may be short. */
  partial: string | null
}

/** The ci_cost_fix_jobs columns the preview reads. */
export interface RolloutJobRow {
  project_id: string
  repo: string
  workflow_path: string
  kind: string
  status: string
  pr_url: string | null
  merged_at: string | null
  closed_at: string | null
  error_code: string | null
  created_at: string
}

const WORKFLOWS_WRITE_MISSING_MESSAGE =
  'The GitHub access Mushi uses cannot change workflow files in this repo, so its pull request would fail. Give the GitHub App "Workflows: Read and write" (or use a token with the workflow scope) first.'

export function rolloutKey(f: { projectId: string; repo: string; workflowPath: string; kind: string }): string {
  return `${f.projectId}:${f.repo.toLowerCase()}:${f.workflowPath}:${f.kind}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function buildRolloutPreview(input: {
  now: Date
  advice: readonly CiOverviewAdvice[]
  /** Apps the caller may change (non-viewer), with their names. */
  projects: ReadonlyArray<{ id: string; name: string | null }>
  /** Recent ci_cost_fix_jobs of those apps, newest first. */
  jobs: readonly RolloutJobRow[]
  /** What the setup check already knows about workflow edits per repo (cache only). */
  workflowsAbility: (projectId: string, repo: string) => 'yes' | 'read_only' | 'no' | 'unknown' | null
  caps: RolloutPreview['caps']
  partial?: string | null
}): RolloutPreview {
  const names = new Map(input.projects.map((p) => [p.id, p.name]))
  // Newest job per edit decides its state; newest per repo the access reason.
  const latest = new Map<string, RolloutJobRow>()
  const latestByRepo = new Map<string, RolloutJobRow>()
  for (const j of input.jobs) {
    const key = rolloutKey({ projectId: j.project_id, repo: j.repo, workflowPath: j.workflow_path, kind: j.kind })
    if (!latest.has(key)) latest.set(key, j)
    const repoKey = `${j.project_id}:${j.repo.toLowerCase()}`
    if (!latestByRepo.has(repoKey) && j.status !== 'queued' && j.status !== 'running') latestByRepo.set(repoKey, j)
  }

  const items = new Map<string, RolloutItem>()
  for (const a of input.advice) {
    const f = a.autofix
    if (!f || !names.has(f.projectId)) continue
    const key = rolloutKey(f)
    const saving = a.monthSavingUsd == null ? null : r2(a.monthSavingUsd)
    const prev = items.get(key)
    // The same edit can come from two advice lists: keep the priced one.
    if (prev && (prev.monthSavingUsd != null || saving == null)) continue
    const job = latest.get(key)
    const open = job?.status === 'pr_opened' && !job.merged_at && !job.closed_at
    const busy = job?.status === 'queued' || job?.status === 'running'
    items.set(key, {
      key,
      projectId: f.projectId,
      repo: f.repo,
      workflowPath: f.workflowPath,
      kind: f.kind,
      adviceId: a.id,
      title: a.title,
      evidence: a.evidence,
      monthSavingUsd: saving,
      state: open ? 'pr_open' : busy ? 'in_progress' : 'ready',
      prUrl: open ? job?.pr_url ?? null : null,
    })
  }

  const groups = new Map<string, RolloutRepo>()
  for (const it of items.values()) {
    const gk = `${it.projectId}:${it.repo.toLowerCase()}`
    let g = groups.get(gk)
    if (!g) {
      g = { projectId: it.projectId, projectName: names.get(it.projectId) ?? null, repo: it.repo, items: [], readyItems: 0, monthSavingUsd: 0, unpricedItems: 0, block: null }
      groups.set(gk, g)
    }
    g.items.push(it)
  }

  const repos = [...groups.entries()].map(([gk, g]) => {
    g.items.sort((a, b) => (b.monthSavingUsd ?? -1) - (a.monthSavingUsd ?? -1) || a.workflowPath.localeCompare(b.workflowPath) || a.kind.localeCompare(b.kind))
    const ready = g.items.filter((i) => i.state === 'ready')
    g.readyItems = ready.length
    g.monthSavingUsd = r2(ready.reduce((s, i) => s + (i.monthSavingUsd ?? 0), 0))
    g.unpricedItems = ready.filter((i) => i.monthSavingUsd == null).length
    const probed = input.workflowsAbility(g.projectId, g.repo)
    const last = latestByRepo.get(gk)
    if (probed === 'no') g.block = { code: 'GITHUB_WORKFLOWS_WRITE_MISSING', message: WORKFLOWS_WRITE_MISSING_MESSAGE, source: 'setup_check' }
    else if (probed !== 'yes' && last?.status === 'failed' && last.error_code === 'GITHUB_WORKFLOWS_WRITE_MISSING') {
      g.block = { code: 'GITHUB_WORKFLOWS_WRITE_MISSING', message: WORKFLOWS_WRITE_MISSING_MESSAGE, source: 'last_attempt' }
    }
    return g
  })
  repos.sort((a, b) => b.monthSavingUsd - a.monthSavingUsd || b.readyItems - a.readyItems || a.repo.localeCompare(b.repo))

  return {
    generatedAt: input.now.toISOString(),
    repos,
    totals: {
      repos: repos.filter((r) => r.readyItems > 0).length,
      readyItems: repos.reduce((s, r) => s + r.readyItems, 0),
      monthSavingUsd: r2(repos.reduce((s, r) => s + r.monthSavingUsd, 0)),
      unpricedItems: repos.reduce((s, r) => s + r.unpricedItems, 0),
    },
    caps: input.caps,
    partial: input.partial ?? null,
  }
}
