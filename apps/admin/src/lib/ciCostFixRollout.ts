/**
 * FILE: apps/admin/src/lib/ciCostFixRollout.ts
 * PURPOSE: "Apply to every app" for the CI cost fixes (ADR 0047 amendment):
 *          the preview, request and bundle shapes the
 *          /v1/admin/ci/cost-fix-rollout and cost-fix-bundles routes return (copies of
 *          `_shared/ci-cost-fix-rollout.ts` and `_shared/ci-cost-fix-bundle.ts`),
 *          which items start selected, what a selection asks for, and the
 *          plain words for each repo's result. Pure, no React.
 */

import type { CiCostFixKind } from './ciTypes'
import type { CiCostFixJob } from './ciCostFix'

export interface CiRolloutItem {
  key: string
  projectId: string
  repo: string
  workflowPath: string
  kind: CiCostFixKind
  adviceId: string
  title: string
  evidence: string
  monthSavingUsd: number | null
  state: 'ready' | 'pr_open' | 'in_progress'
  prUrl: string | null
}

export interface CiRolloutRepo {
  projectId: string
  projectName: string | null
  repo: string
  items: CiRolloutItem[]
  readyItems: number
  monthSavingUsd: number
  unpricedItems: number
  block: { code: string; message: string; source: 'setup_check' | 'last_attempt' } | null
}

export interface CiRolloutPreview {
  generatedAt: string
  repos: CiRolloutRepo[]
  totals: { repos: number; readyItems: number; monthSavingUsd: number; unpricedItems: number }
  caps: { reposPerRequest: number; itemsPerRepo: number }
  partial: string | null
}

export interface CiBundleRequestRepo {
  projectId: string
  repo: string
  items: Array<{ workflowPath: string; kind: CiCostFixKind }>
}

export interface CiBundleResult {
  projectId: string
  repo: string
  status: 'queued' | 'skipped' | 'error'
  bundleId: string | null
  jobs: CiCostFixJob[]
  skipped: Array<{ workflowPath: string; kind: string; code: string; message: string; prUrl: string | null }>
  error: { code: string; message: string } | null
}

export type CiBundleStatus = 'queued' | 'running' | 'pr_opened' | 'nothing_opened' | 'failed'

export interface CiCostFixBundle {
  id: string
  projectId: string
  repo: string
  status: CiBundleStatus
  prUrl: string | null
  prNumber: number | null
  createdAt: string
  items: CiCostFixJob[]
  measuredUsdPerMonth: number | null
}

export const repoKey = (r: { projectId: string; repo: string }) => `${r.projectId}:${r.repo.toLowerCase()}`

/**
 * What starts selected: the ready items (up to the per-repo cap) of each repo
 * Mushi does not already know will fail, for the first repos up to the cap,
 * largest saving first (the preview's order).
 */
export function defaultSelection(p: CiRolloutPreview): Set<string> {
  const out = new Set<string>()
  let repos = 0
  for (const r of p.repos) {
    if (r.block || repos >= p.caps.reposPerRequest) continue
    const ready = r.items.filter((i) => i.state === 'ready').slice(0, p.caps.itemsPerRepo)
    if (ready.length === 0) continue
    repos++
    for (const i of ready) out.add(i.key)
  }
  return out
}

/** The request for the selected items, one entry per repo, and the totals the confirm states. */
export function selectionRequest(p: CiRolloutPreview, selected: ReadonlySet<string>): {
  repos: CiBundleRequestRepo[]
  items: number
  monthSavingUsd: number
  unpriced: number
  overRepoCap: boolean
  overItemCap: boolean
} {
  const repos: CiBundleRequestRepo[] = []
  let items = 0
  let saving = 0
  let unpriced = 0
  let overItemCap = false
  for (const r of p.repos) {
    const picked = r.items.filter((i) => i.state === 'ready' && selected.has(i.key))
    if (picked.length === 0) continue
    if (picked.length > p.caps.itemsPerRepo) overItemCap = true
    repos.push({ projectId: r.projectId, repo: r.repo, items: picked.map((i) => ({ workflowPath: i.workflowPath, kind: i.kind })) })
    items += picked.length
    for (const i of picked) {
      if (i.monthSavingUsd == null) unpriced++
      else saving += i.monthSavingUsd
    }
  }
  return { repos, items, monthSavingUsd: Math.round(saving * 100) / 100, unpriced, overRepoCap: repos.length > p.caps.reposPerRequest, overItemCap }
}

/** "about $4.50 a month (estimated), 1 not priced" */
export function rolloutSavingText(monthSavingUsd: number, unpriced: number): string {
  const priced = monthSavingUsd > 0 ? `about $${monthSavingUsd.toFixed(2)} a month (estimated)` : ''
  const rest = unpriced > 0 ? `${unpriced} not priced` : ''
  return [priced, rest].filter(Boolean).join(', ') || 'not priced'
}

export function isBundleInFlight(b: Pick<CiCostFixBundle, 'status'> | null): boolean {
  return b?.status === 'queued' || b?.status === 'running'
}

/** One line for a repo after the request: its PR, why there is none, or why it did not start. */
export function bundleResultText(result: CiBundleResult, bundle: CiCostFixBundle | null): string {
  if (result.status === 'error') return result.error?.message ?? 'Mushi could not open this repo\'s pull request.'
  if (result.status === 'skipped') return 'Nothing to open here: every fix you picked is already open or being opened.'
  if (!bundle || isBundleInFlight(bundle)) return 'Opening one draft pull request…'
  switch (bundle.status) {
    case 'pr_opened': {
      const refused = bundle.items.filter((i) => i.status === 'refused' || i.status === 'failed').length
      return `Draft pull request open. Review it, mark it ready and merge it.${refused > 0 ? ` ${refused} ${refused === 1 ? 'fix was' : 'fixes were'} left out; the reasons are below and in the pull request.` : ''}`
    }
    case 'nothing_opened':
      return 'No pull request: Mushi refused every fix here, or the workflows already have them. The reasons are below.'
    case 'failed':
      return bundle.items.find((i) => i.status === 'failed')?.error ?? 'Mushi could not open the pull request.'
    default:
      return 'Opening one draft pull request…'
  }
}

/** Why one item did not go into the PR, or what it changed. */
export function bundleItemText(job: CiCostFixJob): string {
  switch (job.status) {
    case 'pr_opened':
      return job.summary ?? 'Changed.'
    case 'refused':
      return `Not changed: ${job.error ?? job.summary ?? 'Mushi will not make this change.'}`
    case 'no_change':
      return job.summary ?? 'Already applied.'
    case 'failed':
      return `Not changed: ${job.error ?? 'Mushi could not change this workflow.'}`
    default:
      return 'Waiting…'
  }
}
