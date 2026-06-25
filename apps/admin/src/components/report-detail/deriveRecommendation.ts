import { severityLabel } from '../../lib/tokens'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail, ReportFixAttempt } from './types'
import { pickPrimaryFixAttempt } from '../../lib/mergeFix'

export interface RecommendationMeta {
  label: string
  value: string
  /** Optional tone hint so the surface can colour the chip. */
  tone?: 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
}

export interface RecommendationAction {
  label: string
  to?: string
  href?: string
  onClick?: () => void
  tone?: 'primary' | 'ghost' | 'danger'
}

export interface Recommendation {
  title: string
  description: string
  cta?: { label: string; onClick?: () => void; href?: string; disabled?: boolean }
  tone: 'urgent' | 'info' | 'success' | 'neutral'
  /** Compact key/value chips shown under the title — used to surface "started
   *  3m ago", "agent: Sonnet 4.6", "files: 2 (+1 more)" without forcing the
   *  user to scroll down to FixProgressStream. */
  meta?: RecommendationMeta[]
  /** Inline recovery actions for non-happy paths. When the dispatch was
   *  skipped because codebase indexing is off, this surfaces an "Enable
   *  indexing & retry" link so the user fixes the prerequisite in one click
   *  instead of hunting through /integrations. */
  actions?: RecommendationAction[]
}

/** Format milliseconds as a human-friendly elapsed string ("47s", "3m 12s"). */
export function formatElapsed(ms: number): string {
  if (ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}

/** Pull "started 47s ago" + agent + model + files into chip metadata.
 *  The `nowMs` parameter is injected by the caller (typically from useNow())
 *  so elapsed time can be live-ticked without re-mounting. */
function buildFixingMeta(
  report: ReportDetail,
  dispatchState: DispatchState,
  nowMs: number = Date.now(),
): RecommendationMeta[] {
  const meta: RecommendationMeta[] = []
  const latest = pickPrimaryFixAttempt(report.fix_attempts)
  const startedAtIso = latest?.started_at ?? null
  if (startedAtIso) {
    const startedAt = new Date(startedAtIso)
    const elapsed = nowMs - startedAt.getTime()
    meta.push({
      label: 'Started',
      value: `${startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} \u00b7 ${formatElapsed(elapsed)} elapsed`,
      tone: 'info',
    })
  }
  if (latest?.llm_model) meta.push({ label: 'Model', value: latest.llm_model, tone: 'neutral' })
  if (latest?.agent) meta.push({ label: 'Agent', value: latest.agent, tone: 'neutral' })
  if (latest?.files_changed && latest.files_changed.length > 0) {
    const shown = latest.files_changed.slice(0, 1).join(', ')
    const more = latest.files_changed.length - 1
    meta.push({
      label: 'Files',
      value: more > 0 ? `${shown} +${more} more` : shown,
      tone: 'neutral',
    })
  }
  // Typical PDCA loop is 2-6 min; show an ETA chip so first-time users
  // know whether to refresh in 30s or come back in 5 min. Suppressed once
  // we have a PR URL because the work is functionally done.
  if (!dispatchState.prUrl) {
    meta.push({ label: 'Typical ETA', value: '2-6 min', tone: 'neutral' })
  }
  return meta
}

function mergeReadyRecommendation(
  _report: ReportDetail,
  prUrl: string,
  latest?: ReportFixAttempt | null,
): Recommendation {
  const ci = latest?.check_run_conclusion
  const meta: RecommendationMeta[] = []
  if (latest?.pr_number) {
    meta.push({ label: 'PR', value: `#${latest.pr_number}`, tone: 'neutral' })
  }
  if (ci) {
    meta.push({
      label: 'CI',
      value: ci,
      tone: ci === 'success' ? 'ok' : ci === 'failure' ? 'danger' : 'warn',
    })
  }
  const ciNote =
    ci === 'failure'
      ? ' CI is failing — resolve checks on GitHub or merge anyway if you accept the risk.'
      : ci === 'success'
        ? ' CI passed.'
        : ''
  return {
    title: 'Draft PR is ready — merge when satisfied',
    description: `Review the diff on GitHub, then use Merge PR in console below (or merge on GitHub).${ciNote} Merging marks this report Fixed and notifies the reporter.`,
    cta: { label: 'View PR', href: prUrl },
    tone: 'success',
    meta: meta.length > 0 ? meta : undefined,
    actions: [{ label: 'Open Fixes pipeline \u2192', to: '/fixes', tone: 'ghost' }],
  }
}

export function deriveRecommendation(
  report: ReportDetail,
  dispatchState: DispatchState,
  commentCount: number,
  onDispatch: () => void | Promise<void>,
  nowMs: number = Date.now(),
): Recommendation {
  if (dispatchState.status === 'completed' && dispatchState.prUrl) {
    return mergeReadyRecommendation(report, dispatchState.prUrl, pickPrimaryFixAttempt(report.fix_attempts))
  }

  const latestForMerge = pickPrimaryFixAttempt(report.fix_attempts)
  const openPrUrl = latestForMerge?.pr_url ?? dispatchState.prUrl ?? null
  if (
    openPrUrl &&
    latestForMerge?.pr_state !== 'merged' &&
    report.status !== 'fixed' &&
    report.status !== 'dismissed' &&
    (latestForMerge?.status === 'completed' || dispatchState.status === 'completed' || report.status === 'fixing')
  ) {
    return mergeReadyRecommendation(report, openPrUrl, latestForMerge)
  }

  if (
    dispatchState.status === 'queueing' ||
    dispatchState.status === 'queued' ||
    dispatchState.status === 'running'
  ) {
    const meta = buildFixingMeta(report, dispatchState, nowMs)
    const description =
      dispatchState.status === 'queueing'
        ? 'Sending dispatch request — should change to "Queued" in <1s.'
        : dispatchState.status === 'queued'
          ? 'Waiting for the fix-worker. The PR usually opens 2-6 minutes after this state.'
          : 'The agent is reading the repo and drafting a patch. You can close this page — work continues server-side.'
    return {
      title: 'Agent is working on a fix',
      description,
      tone: 'info',
      meta: meta.length > 0 ? meta : undefined,
      actions: [{ label: 'Open Fixes pipeline \u2192', to: '/fixes', tone: 'ghost' }],
    }
  }

  if (report.status === 'fixed') {
    return {
      title: 'Verify the fix and close out',
      description: 'Confirm the PR is merged and the report no longer reproduces.',
      tone: 'success',
    }
  }

  if (report.status === 'dismissed') {
    return {
      title: 'This report is dismissed',
      description:
        'No further action is needed. Reopen by changing the status above if it resurfaces.',
      tone: 'neutral',
    }
  }

  if (report.status === 'fixing') {
    const meta = buildFixingMeta(report, dispatchState, nowMs)
    return {
      title: 'A fix is in progress',
      description:
        'The PDCA loop is running in the background. Watch the live stream below or open the Fixes pipeline for the full agent log.',
      tone: 'info',
      meta: meta.length > 0 ? meta : undefined,
      actions: [{ label: 'Open Fixes pipeline \u2192', to: '/fixes', tone: 'ghost' }],
    }
  }

  // ---------------------------------------------------------------------------
  // Skipped / failed attempt — use structured status + failure_category fields
  // (written by categorizeFailure() in fix-worker) rather than substring
  // matching on the error string, which is brittle and locale-dependent.
  //
  // AUTOFIX_DISABLED is caught upstream in _shared/dispatch.ts before a
  // fix_attempt row is ever created, so it never appears here. That prereq is
  // surfaced via the DispatchPreflightBanner component on the report page.
  // ---------------------------------------------------------------------------
  const latest = pickPrimaryFixAttempt(report.fix_attempts)
  const isSkipped = latest?.status?.startsWith('skipped_')
  const isFailed = latest?.status === 'failed'

  if ((isSkipped || isFailed) && latest) {
    const lastAttemptMeta: RecommendationMeta[] = latest.started_at
      ? [
          {
            label: 'Last attempt',
            value: new Date(latest.started_at).toLocaleString(),
            tone: 'neutral' as const,
          },
        ]
      : []

    // skipped_no_context | no_relevant_code: no matching files in codebase index
    if (
      latest.status === 'skipped_no_context' ||
      latest.failure_category === 'no_relevant_code'
    ) {
      return {
        title: 'Fix skipped — no relevant code found in the index',
        description:
          'The agent searched the indexed codebase but found no files that match this bug. Enable codebase indexing on the correct repo, or expand path_globs to include the affected source files.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'Configure codebase indexing \u2192', to: '/integrations', tone: 'primary' },
          { label: 'Retry dispatch', onClick: () => onDispatch(), tone: 'ghost' },
        ],
      }
    }

    // context_assembly_failed: RAG embedding / retrieval pipeline error
    if (latest.failure_category === 'context_assembly_failed') {
      return {
        title: 'Fix skipped — context assembly failed',
        description:
          'The agent could not build a code context (RAG embedding or retrieval error). This is usually transient. Retry the dispatch; if it keeps failing, check the Fixes pipeline logs.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'Open Fixes pipeline \u2192', to: '/fixes', tone: 'ghost' },
          { label: 'Retry dispatch', onClick: () => onDispatch(), tone: 'primary' },
        ],
      }
    }

    // skipped_no_sandbox: sandbox environment not available
    if (latest.status === 'skipped_no_sandbox') {
      return {
        title: 'Fix skipped — sandbox environment not available',
        description:
          'The agent requires a sandbox to validate the patch before opening a PR. Sandbox support is available on paid plans.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          {
            label: 'View plan options \u2192',
            href: 'https://kensaur.us/mushi-mushi/docs/pricing',
            tone: 'primary',
          },
        ],
      }
    }

    // skipped_unsupported_agent: the agent type chosen is not supported
    if (latest.status === 'skipped_unsupported_agent') {
      return {
        title: 'Fix skipped — agent type not supported',
        description:
          'The configured agent type cannot handle this report. Switch to the default Claude agent in project settings.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [{ label: 'View project settings \u2192', to: '/integrations', tone: 'primary' }],
      }
    }

    // Anthropic / LLM key failures
    if (
      latest.failure_category === 'llm_rate_limit' ||
      latest.failure_category === 'llm_invalid_json' ||
      latest.failure_category === 'llm_no_object' ||
      latest.failure_category === 'llm_other_error'
    ) {
      const isRateLimit = latest.failure_category === 'llm_rate_limit'
      return {
        title: isRateLimit ? 'Fix failed — Anthropic rate limit hit' : 'Fix failed — LLM response error',
        description: isRateLimit
          ? 'Your Anthropic account hit its rate limit. Wait a few minutes and retry, or upgrade your Anthropic plan.'
          : 'The LLM returned an unexpected response. This is usually transient — retry the dispatch.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'Retry dispatch', onClick: () => onDispatch(), tone: 'primary' },
          {
            label: 'Check Anthropic dashboard \u2192',
            href: 'https://console.anthropic.com',
            tone: 'ghost',
          },
        ],
      }
    }

    // GitHub permission / not-found errors
    if (
      latest.failure_category === 'github_403' ||
      latest.failure_category === 'github_404' ||
      latest.failure_category === 'github_422' ||
      latest.failure_category === 'github_other_error'
    ) {
      const desc =
        latest.failure_category === 'github_403'
          ? "The integration token doesn't have write access to the target repo. Re-connect GitHub with a token that has repo write + PR permissions."
          : latest.failure_category === 'github_404'
            ? 'The target repository was not found. Check that the GitHub repo URL is correct in Integrations.'
            : 'The agent could not open a pull request. Check the Fixes pipeline for the full error.'
      return {
        title: 'Fix failed — GitHub integration error',
        description: desc,
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'Re-connect GitHub \u2192', to: '/integrations', tone: 'primary' },
          { label: 'View pipeline log \u2192', to: '/fixes', tone: 'ghost' },
        ],
      }
    }

    // Sandbox / validation failures
    if (
      latest.failure_category === 'sandbox_timeout' ||
      latest.failure_category === 'sandbox_error' ||
      latest.failure_category === 'validation_rejected' ||
      latest.failure_category === 'spec_violation' ||
      latest.failure_category === 'scope_blocked'
    ) {
      return {
        title: 'Fix failed — validation or sandbox error',
        description:
          latest.error ??
          'The patch was rejected by the validation step. Review the Fixes pipeline log and retry.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'View pipeline log \u2192', to: '/fixes', tone: 'ghost' },
          { label: 'Retry dispatch', onClick: () => onDispatch(), tone: 'primary' },
        ],
      }
    }

    // Generic failed with unknown / null failure_category
    if (isFailed) {
      return {
        title: 'Fix attempt failed',
        description:
          latest.error ?? 'An unexpected error stopped the agent. Check the Fixes pipeline for details.',
        tone: 'urgent',
        meta: lastAttemptMeta,
        actions: [
          { label: 'View pipeline log \u2192', to: '/fixes', tone: 'ghost' },
          { label: 'Retry dispatch', onClick: () => onDispatch(), tone: 'primary' },
        ],
      }
    }
  }

  if (!report.stage1_classification && !report.processing_error) {
    return {
      title: 'Classification pending',
      description: 'The LLM pipeline is still processing this report. Refresh in a few seconds.',
      tone: 'neutral',
    }
  }

  if (report.processing_error) {
    return {
      title: 'Classification failed — triage manually',
      description:
        'Pick a status and severity by hand, or dispatch a fix once you understand the issue.',
      tone: 'urgent',
    }
  }

  if (report.status === 'new' && (report.severity === 'critical' || report.severity === 'high')) {
    return {
      title: `Confirm priority for this ${severityLabel(report.severity).toLowerCase()} bug`,
      description: 'Set the status to Classified, then dispatch a fix or hand off to engineering.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'urgent',
    }
  }

  if (report.status === 'classified' && commentCount === 0) {
    return {
      title: 'Triage this report',
      description: 'Add a triage note for context, or dispatch an autofix attempt.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  if (report.status === 'new') {
    return {
      title: 'Start triage',
      description: 'Set the severity and update status, or dispatch a fix if confidence is high.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  return {
    title: 'No suggested action',
    description: 'Use the controls above to update status, severity, or dispatch a fix.',
    tone: 'neutral',
  }
}
