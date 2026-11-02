/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-fix-bundle.ts
 * PURPOSE: Several CI cost fixes for one repo in ONE draft PR (ADR 0047
 *          amendment 2026-10-27, "Apply to every app"). Every pull request
 *          costs a CI run, so N fixes in one repo open one PR, not N.
 *
 *          A bundle is the ci_cost_fix_jobs rows sharing a `bundle_id`, all
 *          for one project and repo. Each row is still one workflow file and
 *          one kind (`applyCiCostFix`, with every refusal it has):
 *
 *            - the rows are claimed together; the repo, token, default branch
 *              and required checks are read once;
 *            - each workflow file is read once and its kinds are applied one
 *              after another (CI_COST_FIX_KINDS order), each on the previous
 *              one's output, so the PR carries one version of each file;
 *            - a refused or already-applied row ends `refused` / `no_change`
 *              with its reason, listed in the PR body, never dropped;
 *            - when no row changed anything, no PR is opened;
 *            - every row in the PR ends `pr_opened` with the same PR, so the
 *              single "Open fix PR" sees it as that edit's open PR;
 *            - the workflow's minutes (baseline, and measured after the
 *              merge) are stored on ONE row per workflow: two kinds that
 *              change the same file share one measurement, never count it
 *              twice. The other row says so in its summary.
 *
 *          The branch name comes from the bundle id, so a run reclaimed after
 *          a lost finish pushes to the same branch and reuses its PR
 *          (createPrFromFiles is retry-safe on both) instead of opening a
 *          second one.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { applyCiCostFix, CI_COST_FIX_KINDS, isCiCostFixKind, type CiCostFixKind } from './ci-cost-fix.ts'
import {
  BASELINE_DAYS,
  COST_FIX_ERRORS,
  COST_FIX_JOB_COLUMNS,
  COST_FIX_PR_LABELS,
  COST_FIX_STALE_MS,
  costFixPrTitle,
  defaultCostFixDeps,
  findProjectRepo,
  KIND_TITLE,
  KIND_WHY,
  loadWorkflowMinutes,
  refreshCostFixMeasurement,
  toCostFixView,
  workflowNameOf,
  type CostFixDeps,
  type CostFixErrorCode,
  type CostFixJobRow,
  type CostFixJobView,
  type CostFixStatus,
  type MinutesSeries,
} from './ci-cost-fix-runner.ts'
import type { PrResult } from './github-pr.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('ci-cost-fix-bundle')

/** At most this many fixes per repo in one bundle (one PR). */
export const BUNDLE_MAX_ITEMS = 20
/** At most this many repos (bundles) per "Apply to every app" request. */
export const BUNDLE_MAX_REPOS = 10
const DAY_MS = 24 * 60 * 60_000

export function costFixBundleBranch(bundleId: string): string {
  return `mushi/ci-cost-bundle-${bundleId.replace(/-/g, '').slice(0, 12)}`
}

const fileOf = (path: string) => path.split('/').pop() ?? path

/** One `ci:` title for the whole PR. */
export function costFixBundlePrTitle(changes: ReadonlyArray<{ kind: CiCostFixKind; workflowPath: string }>): string {
  if (changes.length === 1) return costFixPrTitle(changes[0].kind, changes[0].workflowPath)
  const files = [...new Set(changes.map((c) => c.workflowPath))]
  const where = files.length === 1 ? fileOf(files[0]) : `${files.length} workflows`
  return `ci: ${changes.length} fixes in ${where} to save Actions minutes`
}

interface BundleBodyItem {
  kind: CiCostFixKind
  workflowPath: string
  /** What changed, or why nothing did. */
  summary: string
  outcome: 'changed' | 'refused' | 'no_change' | 'failed'
  evidence: string | null
  monthSavingUsd: number | null
}

function costFixBundlePrBody(input: {
  repo: string
  items: readonly BundleBodyItem[]
  /** Billed minutes over the 14 days before, per changed workflow path. */
  baselines: ReadonlyMap<string, MinutesSeries | null>
}): string {
  const changed = input.items.filter((i) => i.outcome === 'changed')
  const notChanged = input.items.filter((i) => i.outcome !== 'changed')
  const files = [...new Set(changed.map((i) => i.workflowPath))]
  const lines = [
    `Mushi CI cost fixes for \`${input.repo}\`: ${changed.length} ${changed.length === 1 ? 'change' : 'changes'} in ${files.length} workflow ${files.length === 1 ? 'file' : 'files'}, in one pull request so the repository runs CI once for all of them.`,
  ]
  for (const path of files) {
    lines.push('', `### \`${path}\``)
    for (const i of changed.filter((c) => c.workflowPath === path)) {
      lines.push('', `**${capital(KIND_TITLE[i.kind])}.** ${i.summary}`, '', KIND_WHY[i.kind])
      if (i.evidence) lines.push('', `What Mushi saw: ${i.evidence.slice(0, 600)}`)
      if (i.monthSavingUsd != null && i.monthSavingUsd > 0) lines.push('', `Estimated saving: about $${i.monthSavingUsd.toFixed(2)} a month.`)
    }
    const base = input.baselines.get(path)
    if (base && base.jobs > 0) {
      lines.push(
        '',
        `Over the last ${base.days} days this workflow used about ${base.minutes} billed minutes on GitHub-hosted runners ($${base.usd.toFixed(2)}, estimated from job times).`,
      )
    }
  }
  if (notChanged.length > 0) {
    lines.push('', '### Not changed', '')
    for (const i of notChanged) lines.push(`- \`${i.workflowPath}\`, ${KIND_TITLE[i.kind]}: ${i.summary}`)
  }
  const priced = changed.filter((i) => i.monthSavingUsd != null && i.monthSavingUsd > 0)
  if (priced.length > 0) {
    const total = priced.reduce((s, i) => s + (i.monthSavingUsd ?? 0), 0)
    const unpriced = changed.length - priced.length
    lines.push(
      '',
      `**Estimated saving:** about $${total.toFixed(2)} a month${unpriced > 0 ? `, plus ${unpriced} ${unpriced === 1 ? 'change' : 'changes'} Mushi could not price` : ''}.`,
    )
  }
  lines.push(
    '',
    "This is a draft: review the changes, mark it ready and merge it when they look right. After it merges, Mushi measures each changed workflow's minutes per day for 14 days and shows the saving that actually happened next to the advice. Two fixes that change the same workflow share one measurement.",
  )
  return lines.join('\n')
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Run one bundle
// ─────────────────────────────────────────────────────────────────────────────

interface BundleItemOutcome {
  jobId: string
  workflowPath: string
  kind: CiCostFixKind
  status: CostFixStatus
  summary: string | null
  errorCode: string | null
}

type CostFixBundleRunResult =
  | { ok: true; status: 'pr_opened'; prUrl: string; items: BundleItemOutcome[] }
  | { ok: true; status: 'nothing_opened'; items: BundleItemOutcome[] }
  | { ok: false; status: 'failed'; code: CostFixErrorCode; error: string; items: BundleItemOutcome[] }
  | { ok: false; status: 'skipped'; error: string }

const KIND_ORDER = new Map<string, number>(CI_COST_FIX_KINDS.map((k, i) => [k, i]))

export async function runCiCostFixBundle(db: SupabaseClient, bundleId: string, deps: CostFixDeps = defaultCostFixDeps): Promise<CostFixBundleRunResult> {
  const now = deps.now()
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - COST_FIX_STALE_MS).toISOString()
  // Claim every queued row of the bundle in one guarded update, else the rows
  // a dead run left `running`. Two workers never both claim a row.
  const claim = (stale: boolean) => {
    const q = db.from('ci_cost_fix_jobs').update({ status: 'running', started_at: nowIso, updated_at: nowIso }).eq('bundle_id', bundleId)
    return (stale ? q.eq('status', 'running').lte('started_at', staleIso) : q.eq('status', 'queued')).select(COST_FIX_JOB_COLUMNS)
  }
  let { data: claimed, error: claimErr } = await claim(false)
  if (!claimErr && (claimed ?? []).length === 0) ({ data: claimed, error: claimErr } = await claim(true))
  if (claimErr) return { ok: false, status: 'skipped', error: claimErr.message }
  const rows = ((claimed ?? []) as CostFixJobRow[]).sort(
    (a, b) => a.workflow_path.localeCompare(b.workflow_path) || (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99),
  )
  if (rows.length === 0) return { ok: false, status: 'skipped', error: 'Bundle is not queued (already running or finished).' }

  const outcomes = new Map<string, BundleItemOutcome>()
  const finish = async (row: CostFixJobRow, status: CostFixStatus, patch: Record<string, unknown>) => {
    const at = deps.now().toISOString()
    const { error } = await db
      .from('ci_cost_fix_jobs')
      .update({ status, ...patch, finished_at: at, updated_at: at })
      .eq('id', row.id)
      .eq('status', 'running')
    // A lost write leaves the row `running`; the reclaim reuses the same branch and PR.
    if (error) log.warn('ci_cost_fix_jobs finish failed', { jobId: row.id, bundleId, err: error.message })
    outcomes.set(row.id, {
      jobId: row.id,
      workflowPath: row.workflow_path,
      kind: row.kind,
      status,
      summary: (patch.summary as string | undefined) ?? null,
      errorCode: (patch.error_code as string | undefined) ?? null,
    })
  }
  const failRow = (row: CostFixJobRow, code: CostFixErrorCode) => finish(row, 'failed', { error_code: code, error: COST_FIX_ERRORS[code], summary: COST_FIX_ERRORS[code] })
  const items = () => rows.map((r) => outcomes.get(r.id)).filter((o): o is BundleItemOutcome => !!o)
  const failAll = async (code: CostFixErrorCode, detail?: string, which: readonly CostFixJobRow[] = rows): Promise<CostFixBundleRunResult> => {
    for (const r of which) if (!outcomes.has(r.id)) await failRow(r, code)
    if (detail) log.warn('ci cost fix bundle failed', { bundleId, code, detail: detail.slice(0, 300) })
    return { ok: false, status: 'failed', code, error: COST_FIX_ERRORS[code], items: items() }
  }

  // Every row of a bundle is one project's repo; a stray row fails on its own.
  const first = rows[0]
  for (const r of rows) {
    if (r.project_id !== first.project_id || r.repo.toLowerCase() !== first.repo.toLowerCase() || !isCiCostFixKind(r.kind)) await failRow(r, 'GITHUB_ERROR')
  }
  const live = rows.filter((r) => !outcomes.has(r.id))

  try {
    const repo = await findProjectRepo(db, first.project_id, first.repo)
    if (!repo) return await failAll('NO_REPO')
    const token = await deps.resolveToken(db, first.project_id, repo.installationId)
    if (!token) return await failAll('GITHUB_NOT_CONNECTED')
    let base: { branch: string; sha: string }
    try {
      base = await deps.baseBranch(token, repo.ref, repo.defaultBranch)
    } catch (err) {
      return await failAll('WORKFLOW_UNREADABLE', String(err))
    }
    const needsChecks = live.some((r) => r.kind === 'skip_drafts' || r.kind === 'ignore_docs_paths')
    const requiredChecks = needsChecks ? await deps.requiredChecks(token, repo.ref, base.branch).catch(() => null) : null

    // Per file: read once, apply its kinds in order, keep the last text.
    const files: Array<{ path: string; contents: string; workflowName: string; changed: CostFixJobRow[] }> = []
    const changeSummary = new Map<string, string>()
    const bodyItems: BundleBodyItem[] = []
    // A reclaim claims only the rows still running: the ones an earlier run
    // already refused, found applied or failed stay listed in the PR body.
    const { data: earlier } = await db
      .from('ci_cost_fix_jobs')
      .select(COST_FIX_JOB_COLUMNS)
      .eq('bundle_id', bundleId)
      .in('status', ['refused', 'no_change', 'failed'])
    for (const r of (earlier ?? []) as CostFixJobRow[]) {
      if (rows.some((c) => c.id === r.id) || !isCiCostFixKind(r.kind)) continue
      const outcome = r.status === 'refused' ? 'refused' : r.status === 'no_change' ? 'no_change' : 'failed'
      bodyItems.push({ kind: r.kind, workflowPath: r.workflow_path, summary: r.error ?? r.summary ?? '', outcome, evidence: null, monthSavingUsd: null })
    }
    for (const path of [...new Set(live.map((r) => r.workflow_path))]) {
      const fileRows = live.filter((r) => r.workflow_path === path)
      const file = await deps.readFile(token, repo.ref, base.branch, path)
      if (file.kind !== 'exists') {
        const code: CostFixErrorCode = file.kind === 'absent' ? 'WORKFLOW_NOT_FOUND' : 'WORKFLOW_UNREADABLE'
        for (const r of fileRows) {
          await failRow(r, code)
          bodyItems.push({ kind: r.kind, workflowPath: path, summary: COST_FIX_ERRORS[code], outcome: 'failed', evidence: null, monthSavingUsd: null })
        }
        continue
      }
      const workflowName = workflowNameOf(file.contents, path)
      let text = file.contents
      const changed: CostFixJobRow[] = []
      for (const r of fileRows) {
        const result = applyCiCostFix(r.kind, text, { requiredChecks, workflowPath: path })
        const saving = r.month_saving_usd == null ? null : Number(r.month_saving_usd)
        if (result.refused) {
          await finish(r, 'refused', { workflow_name: workflowName, summary: result.summary, error_code: 'TRANSFORM_REFUSED', error: result.refused })
          bodyItems.push({ kind: r.kind, workflowPath: path, summary: result.summary, outcome: 'refused', evidence: null, monthSavingUsd: null })
        } else if (!result.changed) {
          await finish(r, 'no_change', { workflow_name: workflowName, summary: `Already applied: ${result.summary}` })
          bodyItems.push({ kind: r.kind, workflowPath: path, summary: `Already applied: ${result.summary}`, outcome: 'no_change', evidence: null, monthSavingUsd: null })
        } else {
          text = result.yaml
          changed.push(r)
          changeSummary.set(r.id, result.summary)
          bodyItems.push({ kind: r.kind, workflowPath: path, summary: result.summary, outcome: 'changed', evidence: r.evidence, monthSavingUsd: saving })
        }
      }
      if (changed.length > 0) files.push({ path, contents: text, workflowName, changed })
    }

    const changedRows = files.flatMap((f) => f.changed)
    if (changedRows.length === 0) {
      const failed = items().find((o) => o.status === 'failed')
      if (failed?.errorCode && failed.errorCode in COST_FIX_ERRORS) {
        const code = failed.errorCode as CostFixErrorCode
        return { ok: false, status: 'failed', code, error: COST_FIX_ERRORS[code], items: items() }
      }
      return { ok: true, status: 'nothing_opened', items: items() }
    }

    // The 14 days before, once per changed workflow.
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const baselines = new Map<string, MinutesSeries | null>()
    for (const f of files) {
      baselines.set(
        f.path,
        await loadWorkflowMinutes(db, { ...f.changed[0], workflow_name: f.workflowName }, new Date(today - BASELINE_DAYS * DAY_MS), new Date(today), true),
      )
    }

    const title = costFixBundlePrTitle(changedRows.map((r) => ({ kind: r.kind, workflowPath: r.workflow_path })))
    let pr: PrResult
    try {
      pr = await deps.createPr({
        token,
        owner: repo.ref.owner,
        repo: repo.ref.repo,
        defaultBranch: base.branch,
        baseSha: base.sha,
        branch: costFixBundleBranch(bundleId),
        title,
        body: costFixBundlePrBody({ repo: `${repo.ref.owner}/${repo.ref.repo}`, items: bodyItems, baselines }),
        files: files.map((f) => ({
          path: f.path,
          contents: f.contents,
          reason: f.changed.length === 1 ? costFixPrTitle(f.changed[0].kind, f.path).replace(/^ci: /, '') : `${f.changed.map((r) => KIND_TITLE[r.kind]).join(', ')} in ${fileOf(f.path)}`,
        })),
        labels: COST_FIX_PR_LABELS,
        category: 'ci',
        // A draft: CI runs when a person marks it ready (ADR 0047).
        markReady: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // GitHub refuses writes under .github/workflows without the workflows permission.
      return await failAll(/→ (403|404)/.test(message) ? 'GITHUB_WORKFLOWS_WRITE_MISSING' : 'GITHUB_ERROR', message, changedRows)
    }

    // Every changed row moves to pr_opened in ONE update. A lost or partial
    // finish would otherwise leave some rows `running`, and their reclaim
    // would push a fresh copy of the base file to the same branch, dropping
    // the edits of the rows already marked opened.
    const at = deps.now().toISOString()
    const { error: openErr } = await db
      .from('ci_cost_fix_jobs')
      .update({ status: 'pr_opened', pr_url: pr.url, pr_number: pr.number, branch: pr.branch, commit_sha: pr.commitSha, error_code: null, error: null, finished_at: at, updated_at: at })
      .in('id', changedRows.map((r) => r.id))
      .eq('status', 'running')
    if (openErr) {
      // All of them stay `running`; the reclaim applies every kind again and pushes the same branch.
      log.warn('ci_cost_fix_jobs pr_opened update failed', { bundleId, err: openErr.message })
      return { ok: true, status: 'pr_opened', prUrl: pr.url, items: items() }
    }
    // Then each row's own summary and measurement (only rows the update above opened).
    for (const f of files) {
      const [measured, ...shared] = f.changed
      const details = (r: CostFixJobRow, summary: string, baseline: MinutesSeries | null) => {
        outcomes.set(r.id, { jobId: r.id, workflowPath: r.workflow_path, kind: r.kind, status: 'pr_opened', summary, errorCode: null })
        return db.from('ci_cost_fix_jobs').update({ workflow_name: f.workflowName, summary, baseline }).eq('id', r.id).eq('status', 'pr_opened')
      }
      const writes = [
        details(measured, changeSummary.get(measured.id) ?? '', baselines.get(f.path) ?? null),
        ...shared.map((r) =>
          details(
            r,
            `${changeSummary.get(r.id)} This change shares its pull request and workflow with "${KIND_TITLE[measured.kind]}", so the workflow's minutes are measured once, on that fix.`,
            null,
          ),
        ),
      ]
      for (const w of writes) {
        const { error } = await w
        if (error) log.warn('ci_cost_fix_jobs details update failed', { bundleId, err: error.message })
      }
    }
    return { ok: true, status: 'pr_opened', prUrl: pr.url, items: items() }
  } catch (err) {
    return await failAll('GITHUB_ERROR', err instanceof Error ? err.message : String(err))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a bundle
// ─────────────────────────────────────────────────────────────────────────────

type CostFixBundleStatus = 'queued' | 'running' | 'pr_opened' | 'nothing_opened' | 'failed'

/** The bundle's state from its rows: in flight, its PR, nothing to change, or failed. */
export function bundleStatusOf(rows: ReadonlyArray<Pick<CostFixJobRow, 'status'>>): CostFixBundleStatus {
  if (rows.some((r) => r.status === 'running')) return 'running'
  if (rows.some((r) => r.status === 'queued')) return 'queued'
  if (rows.some((r) => r.status === 'pr_opened')) return 'pr_opened'
  if (rows.some((r) => r.status === 'failed')) return 'failed'
  return 'nothing_opened'
}

/**
 * Notice the merge of a bundle's PR and measure each workflow since, reading
 * the PR from GitHub once for all its rows. Returns the rows as stored after.
 */
export async function refreshCostFixBundle(
  db: SupabaseClient,
  rows: readonly CostFixJobRow[],
  deps: Pick<CostFixDeps, 'now' | 'resolveToken' | 'fetchPr'> = defaultCostFixDeps,
): Promise<CostFixJobRow[]> {
  const prs = new Map<number, ReturnType<CostFixDeps['fetchPr']>>()
  const shared: typeof deps = {
    ...deps,
    fetchPr: (token, ref, n) => {
      if (!prs.has(n)) prs.set(n, deps.fetchPr(token, ref, n))
      return prs.get(n)!
    },
  }
  const out: CostFixJobRow[] = []
  for (const r of rows) out.push(r.status === 'pr_opened' ? await refreshCostFixMeasurement(db, r, shared) : r)
  return out
}

interface CostFixBundleView {
  id: string
  projectId: string
  repo: string
  status: CostFixBundleStatus
  prUrl: string | null
  prNumber: number | null
  createdAt: string
  /** Each fix with its own state, summary or refusal. */
  items: CostFixJobView[]
  /** The measured saving across the bundle's workflows, once each (USD / 30 days); null until one is measured. */
  measuredUsdPerMonth: number | null
}

export function toCostFixBundleView(bundleId: string, rows: readonly CostFixJobRow[]): CostFixBundleView {
  const items = rows.map(toCostFixView)
  const pr = rows.find((r) => r.pr_url)
  const measured = items.filter((i) => i.saving != null)
  return {
    id: bundleId,
    projectId: rows[0]?.project_id ?? '',
    repo: rows[0]?.repo ?? '',
    status: bundleStatusOf(rows),
    prUrl: pr?.pr_url ?? null,
    prNumber: pr?.pr_number ?? null,
    createdAt: rows.reduce((m, r) => (r.created_at < m ? r.created_at : m), rows[0]?.created_at ?? ''),
    items,
    measuredUsdPerMonth: measured.length > 0 ? Math.round(measured.reduce((s, i) => s + (i.saving?.usdPerMonth ?? 0), 0) * 100) / 100 : null,
  }
}
