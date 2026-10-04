/**
 * FILE: apps/admin/src/lib/fixReportTruth.ts
 * PURPOSE: Read a fix attempt against its REPORT's current state.
 *
 * GET /v1/admin/fixes attaches `report_fix_state`, `report_fixed_by_pr`,
 * `is_latest_attempt`, `retryable` and `credential_block` to every row
 * (server: _shared/fix-report-truth.ts). Every count, Retry button and
 * failure row on /fixes reads them here, so the page agrees with the
 * dashboard and /inbox. A row without the fields (an older server) is
 * "unknown": it is never counted and never offered for retry.
 *
 * REGRESSION (glot.it 2026-10-04): "Retry 8 failed" listed attempts on 4
 * reports already fixed by merged PRs 138–141.
 */

import { humanizeFixError } from './humanizeFixError'
import { isFixMerged } from './mergeFix'
import { fixFailureBucket } from './pdcaAct'
import type { FixAttempt } from '../components/fixes/types'

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  cursor: 'Cursor',
  github: 'GitHub',
}

/** Where each provider's key is managed in the console. */
const PROVIDER_ROUTE: Record<string, string> = {
  openai: '/settings?tab=byok',
  anthropic: '/settings?tab=byok',
  cursor: '/integrations/config#cursor_cloud',
  github: '/integrations/config',
}

/** Newest attempt on a report whose last auto-fix stopped and is still unfixed. */
export function needsAttention(fix: FixAttempt): boolean {
  return fix.report_fix_state === 'failed' && fix.is_latest_attempt === true
}

/** An attempt (failed, skipped or a closed PR) on a report that a later attempt fixed. */
export function isSuperseded(fix: FixAttempt): boolean {
  return fix.report_fix_state === 'resolved' && !isFixMerged(fix)
}

/** "Superseded — fixed by PR #N" / "Report fixed" / "Report dismissed". */
export function supersededLabel(fix: FixAttempt): string {
  if (fix.report_fixed_by_pr != null) return `Superseded — fixed by PR #${fix.report_fixed_by_pr}`
  if (fix.report_status === 'dismissed') return 'Report dismissed'
  return 'Report fixed'
}

/** One entry per report that a retry can clear right now. */
export function retryCandidates(fixes: FixAttempt[]): FixAttempt[] {
  const seen = new Set<string>()
  const out: FixAttempt[] = []
  for (const f of fixes) {
    if (f.retryable !== true || seen.has(f.report_id)) continue
    seen.add(f.report_id)
    out.push(f)
  }
  return out
}

/** One entry per unfixed report with a PR waiting on review or merge (newest first). */
export function openPrReports(fixes: FixAttempt[]): FixAttempt[] {
  const seen = new Set<string>()
  const out: FixAttempt[] = []
  const sorted = [...fixes].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  for (const f of sorted) {
    if (f.report_fix_state !== 'pr_open' || !f.pr_url || f.pr_state === 'closed' || isFixMerged(f)) continue
    if (seen.has(f.report_id)) continue
    seen.add(f.report_id)
    out.push(f)
  }
  return out
}

export interface CredentialAdvice {
  provider: string
  /** Plain-English line for the row. */
  message: string
  /** True when a retry is the fix (the key works now). */
  retryNow: boolean
  /** Where to manage the key, when the key is the fix. */
  to: string | null
  linkLabel: string | null
}

/** What to do about a failure caused by a rejected key, read against the key's health now. */
export function credentialAdvice(fix: FixAttempt): CredentialAdvice | null {
  const block = fix.credential_block
  if (!block) return null
  const name = PROVIDER_LABEL[block.provider] ?? block.provider
  const to = PROVIDER_ROUTE[block.provider] ?? '/settings?tab=byok'
  const linkLabel = to.startsWith('/settings') ? 'Open Settings → AI keys' : `Open ${name} connection`
  if (block.keyHealthy === true) {
    return {
      provider: block.provider,
      message: `The ${name} key is fixed now — retry this fix.`,
      retryNow: true,
      to: null,
      linkLabel: null,
    }
  }
  if (block.keyHealthy === false) {
    return {
      provider: block.provider,
      message: `${name} rejected the key. Replace it, then retry.`,
      retryNow: false,
      to,
      linkLabel,
    }
  }
  return {
    provider: block.provider,
    message: `${name} rejected the key, and Mushi has not checked a newer one yet. Check the key, then retry.`,
    retryNow: false,
    to,
    linkLabel,
  }
}

export interface FailureHeadline {
  /** Plain-English reason, or the error's first line when the code is unknown. */
  title: string
  /** What to do next. */
  hint: string
  /** First line of the raw error, for the Details toggle. */
  firstLine: string | null
}

/** The real reason a fix attempt stopped, for the row itself (not hidden behind an expand). */
export function failureHeadline(fix: FixAttempt): FailureHeadline | null {
  const firstLine = fix.error ? fix.error.split('\n')[0].trim().slice(0, 240) : null
  if (!fix.error) return null
  const h = humanizeFixError(fix.error, { agent: fix.agent, category: fix.failure_category })
  if (!h) return null
  if (h.known === false) {
    return {
      title: firstLine ?? h.title,
      hint: 'Mushi does not recognise this error yet. Read the details, then retry or fix it in your editor.',
      firstLine,
    }
  }
  return { title: h.title, hint: h.hint, firstLine }
}

/**
 * The bucket a still-unfixed report's last failure falls in, for the
 * "Common causes" chips: a rejected key first, then the worker's category.
 */
export function failureCause(fix: FixAttempt): string {
  if (fix.credential_block) return `${fix.credential_block.provider}_key_rejected`
  const bucket = fixFailureBucket(fix)
  if (bucket === 'unknown' && (fix.error ?? '').toLowerCase().startsWith('review_failed')) return 'review_failed'
  return bucket
}

/** Report title for a row, never a raw id. */
export function fixReportLabel(fix: FixAttempt): string {
  return fix.report_title?.trim() || 'Untitled report'
}

const CAUSE_LABELS: Record<string, string> = {
  openai_key_rejected: 'OpenAI key rejected',
  anthropic_key_rejected: 'Anthropic key rejected',
  cursor_key_rejected: 'Cursor key rejected',
  github_key_rejected: 'GitHub access rejected',
  review_failed: 'Agent unsure of its patch',
  validation_rejected: 'Patch failed validation',
  claude_workflow_missing: 'Workflow missing',
  claude_api_error: 'Claude API error',
  cursor_api_error: 'Cursor API error',
  sandbox_timeout: 'Ran out of time',
  scope_blocked: 'Outside allowed files',
  spec_violation: 'Failed the spec check',
  no_relevant_code: 'No matching code found',
  context_assembly_failed: 'Code lookup failed',
  ci_failed: 'CI failed',
  pr_closed_unmerged: 'PR closed without merge',
  unknown: 'Unrecognised error',
}

/** Plain-English name for a failure cause key (never a raw snake_case code). */
export function fixCauseLabel(cause: string | null | undefined): string {
  if (!cause) return 'Unrecognised error'
  return CAUSE_LABELS[cause] ?? cause.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
