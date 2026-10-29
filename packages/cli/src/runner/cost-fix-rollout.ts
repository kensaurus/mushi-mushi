/**
 * FILE: packages/cli/src/runner/cost-fix-rollout.ts
 * PURPOSE: `mushi runner fix --all` (ADR 0047 amendment 2026-10-27, "Apply to
 *          every app"): the preview of every CI cost fix Mushi can open across
 *          your apps (GET /v1/admin/ci/cost-fix-rollout), the request
 *          that opens one draft PR per repo (POST /v1/admin/ci/cost-fix-rollout),
 *          waiting for the bundles, and the lines the terminal prints.
 */

import { apiCall, die } from '../cli-shared.js'
import type { CliConfig } from '../config.js'
import type { CostFixJob } from './cost-fix.js'

interface RolloutItem {
  key: string
  projectId: string
  repo: string
  workflowPath: string
  kind: string
  title: string
  monthSavingUsd: number | null
  state: 'ready' | 'pr_open' | 'in_progress'
  prUrl: string | null
}

interface RolloutRepo {
  projectId: string
  projectName: string | null
  repo: string
  items: RolloutItem[]
  readyItems: number
  monthSavingUsd: number
  unpricedItems: number
  block: { code: string; message: string; source: string } | null
}

export interface RolloutPreview {
  repos: RolloutRepo[]
  totals: { repos: number; readyItems: number; monthSavingUsd: number; unpricedItems: number }
  caps: { reposPerRequest: number; itemsPerRepo: number }
  partial: string | null
}

interface BundleRequestRepo {
  projectId: string
  repo: string
  items: Array<{ workflowPath: string; kind: string }>
}

/** One repo's answer from POST /v1/admin/ci/cost-fix-rollout. */
export interface BundleResult {
  projectId: string
  repo: string
  status: 'queued' | 'skipped' | 'error'
  bundleId: string | null
  jobs: CostFixJob[]
  skipped: Array<{ workflowPath: string; kind: string; code: string; message: string; prUrl: string | null }>
  error: { code: string; message: string } | null
}

export interface CostFixBundle {
  id: string
  repo: string
  status: 'queued' | 'running' | 'pr_opened' | 'nothing_opened' | 'failed'
  prUrl: string | null
  items: CostFixJob[]
  measuredUsdPerMonth: number | null
}

const BUNDLE_WAIT_MS = 180_000
const BUNDLE_POLL_MS = 3_000

const usd = (n: number) => `$${n.toFixed(2)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function savingText(r: { monthSavingUsd: number; unpricedItems: number }): string {
  const priced = r.monthSavingUsd > 0 ? `about ${usd(r.monthSavingUsd)} a month (estimated)` : ''
  const unpriced = r.unpricedItems > 0 ? `${r.unpricedItems} not priced` : ''
  return [priced, unpriced].filter(Boolean).join(', ') || 'not priced'
}

export function renderRolloutPreview(p: RolloutPreview): string[] {
  if (p.repos.length === 0) return ['No CI cost fix Mushi can open for your apps right now.', ...(p.partial ? [p.partial] : [])]
  const lines = [
    `${plural(p.totals.readyItems, 'fix', 'fixes')} ready in ${plural(p.totals.repos, 'repo', 'repos')}: ${savingText(p.totals)}. Each repo gets one draft pull request.`,
  ]
  if (p.partial) lines.push(p.partial)
  for (const r of p.repos) {
    lines.push('', `${r.repo}${r.projectName ? ` (${r.projectName})` : ''}: ${r.readyItems} ready, ${savingText(r)}`)
    if (r.block) lines.push(`  Warning: ${r.block.message}`)
    for (const i of r.items) {
      const saving = i.monthSavingUsd == null ? 'not priced' : `${usd(i.monthSavingUsd)}/mo`
      const state = i.state === 'pr_open' ? ` (PR open: ${i.prUrl ?? 'see the console'})` : i.state === 'in_progress' ? ' (being opened)' : ''
      lines.push(`  ${i.state === 'ready' ? '-' : ' '} ${i.workflowPath} ${i.kind}, ${saving}${state}`)
    }
  }
  lines.push('', 'Open them with: mushi runner fix --all --apply')
  return lines
}

/**
 * What `--apply` asks for: ready items only, repos whose access Mushi knows
 * cannot edit workflows left out unless asked, within the server's caps (the
 * largest savings first, as the preview orders them). `leftOut` says what
 * did not go and why.
 */
export function pickRolloutRequest(p: RolloutPreview, opts: { repos?: readonly string[]; includeBlocked?: boolean } = {}): { repos: BundleRequestRepo[]; leftOut: string[] } {
  const want = opts.repos?.map((r) => r.toLowerCase())
  const leftOut: string[] = []
  const repos: BundleRequestRepo[] = []
  for (const r of p.repos) {
    if (want && !want.includes(r.repo.toLowerCase())) continue
    const ready = r.items.filter((i) => i.state === 'ready')
    if (ready.length === 0) continue
    if (r.block && !opts.includeBlocked) {
      leftOut.push(`${r.repo}: ${r.block.message} (pass --include-blocked to try anyway)`)
      continue
    }
    if (repos.length >= p.caps.reposPerRequest) {
      leftOut.push(`${r.repo}: at most ${p.caps.reposPerRequest} repos per request; run --apply again for the rest`)
      continue
    }
    const items = ready.slice(0, p.caps.itemsPerRepo)
    if (ready.length > items.length) leftOut.push(`${r.repo}: at most ${p.caps.itemsPerRepo} fixes per repo; ${ready.length - items.length} wait for the next run`)
    repos.push({ projectId: r.projectId, repo: r.repo, items: items.map((i) => ({ workflowPath: i.workflowPath, kind: i.kind })) })
  }
  return { repos, leftOut }
}

export function renderBundleResults(results: readonly BundleResult[]): string[] {
  const lines: string[] = []
  for (const r of results) {
    if (r.status === 'queued') {
      lines.push(`${r.repo}: opening one draft PR with ${plural(r.jobs.length, 'fix', 'fixes')}. Follow it with: mushi runner fix-status --bundle ${r.bundleId}`)
    } else if (r.status === 'skipped') {
      lines.push(`${r.repo}: nothing to open.`)
    } else {
      lines.push(`${r.repo}: ${r.error?.message ?? 'not opened.'}`)
    }
    for (const s of r.skipped) lines.push(`  ${s.workflowPath} ${s.kind}: ${s.message}${s.prUrl ? ` ${s.prUrl}` : ''}`)
  }
  return lines
}

function itemText(j: CostFixJob): string {
  switch (j.status) {
    case 'pr_opened':
      return j.summary ?? 'changed'
    case 'refused':
      return `refused: ${j.error ?? j.summary ?? 'Mushi will not make this edit.'}`
    case 'failed':
      return `failed: ${j.error ?? 'unknown error.'}`
    case 'no_change':
      return j.summary ?? 'already applied'
    default:
      return 'waiting'
  }
}

export function renderBundle(b: CostFixBundle): string[] {
  const head =
    b.status === 'pr_opened'
      ? `${b.repo}: draft PR ${b.prUrl ?? '(link pending)'}. Review it, mark it ready and merge it. Nothing changes until then.`
      : b.status === 'nothing_opened'
        ? `${b.repo}: no pull request. Every fix was refused or is already in the workflow.`
        : b.status === 'failed'
          ? `${b.repo}: the pull request could not be opened.`
          : `${b.repo}: opening the draft PR. Follow it with: mushi runner fix-status --bundle ${b.id}`
  const lines = [head]
  for (const j of b.items) lines.push(`  ${j.workflowPath} ${j.kind}: ${itemText(j)}`)
  if (b.measuredUsdPerMonth != null) lines.push(`Measured since the merge: about ${usd(b.measuredUsdPerMonth)} a month saved.`)
  return lines
}

const inFlight = (b: CostFixBundle) => b.status === 'queued' || b.status === 'running'

/** Read each bundle until its worker finishes (or the wait runs out). */
export async function waitForBundles(
  ids: readonly string[],
  config: CliConfig,
  opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CostFixBundle[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = Date.now() + (opts.waitMs ?? BUNDLE_WAIT_MS)
  const seen = new Map<string, CostFixBundle>()
  for (;;) {
    for (const id of ids) {
      const prev = seen.get(id)
      if (prev && !inFlight(prev)) continue
      const res = await apiCall<{ bundle: CostFixBundle }>(`/v1/admin/ci/cost-fix-bundles/${id}`, config)
      if (!res.ok) die(res)
      seen.set(id, res.data.bundle)
    }
    if (![...seen.values()].some(inFlight) || Date.now() >= deadline) break
    await sleep(opts.pollMs ?? BUNDLE_POLL_MS)
  }
  return ids.flatMap((id) => (seen.has(id) ? [seen.get(id)!] : []))
}
