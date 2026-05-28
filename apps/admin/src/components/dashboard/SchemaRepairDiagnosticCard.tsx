/**
 * FILE: apps/admin/src/components/dashboard/SchemaRepairDiagnosticCard.tsx
 * PURPOSE: Shows a diagnostic banner on the dashboard "Do" stage when
 *          actionable fix-worker failures are detected in the last 7 days.
 *          C6: widens past llm_no_object to also surface cursor_invalid_model,
 *          cursor_api_error, llm_schema_violation, and other retryable failures
 *          so operators see a "Retry with repair hint" button for each.
 *
 * Depends on:
 *   GET /v1/admin/fixes/repair-failures — returns recent LLM/Cursor failures
 *   POST /v1/admin/fixes/dispatch — retries the fix for the given report
 */

import { useCallback, useEffect, useState } from 'react'
import { Btn } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ContainedBlock, SignalChip } from '../report-detail/ReportSurface'

// Failure categories the repair card handles. Each has a different label
// and hint shown alongside the Retry button.
const ACTIONABLE_CATEGORIES = new Set([
  'llm_no_object',
  'llm_schema_violation',
  'llm_invalid_json',
  'llm_rate_limit',
  'cursor_api_error',
  'cursor_invalid_model',
  'cursor_validation_error',
  'embedding_provider_html_response',
  'upstream_internal_server',
  'sandbox_timeout',
])

const CATEGORY_HINT: Record<string, string> = {
  llm_no_object: "The LLM produced a response that didn't match the expected schema.",
  llm_schema_violation: 'The LLM response was valid JSON but failed schema validation.',
  llm_invalid_json: "The LLM response wasn't valid JSON.",
  llm_rate_limit: 'The LLM provider returned a rate-limit error.',
  cursor_api_error: 'Cursor Cloud rejected the dispatch — check your API key.',
  cursor_invalid_model: 'Cursor rejected the model slug — clear the model field in Cursor Cloud settings.',
  cursor_validation_error: 'Cursor returned a validation error — the request schema may have changed.',
  embedding_provider_html_response: 'The embedding provider returned an HTML error page instead of vectors.',
  upstream_internal_server: 'An upstream provider returned a 5xx server error.',
  sandbox_timeout: 'The fix sandbox timed out before the agent finished.',
}

interface RepairFailure {
  id: string
  report_id: string
  project_id: string
  failure_category?: string | null
  failure_diagnostic: string | null
  repair_attempts: number
  created_at: string
}

interface DbAdvisor {
  name: string
  title?: string
  description: string
  level?: string
}

interface Props {
  projectId: string
}

export function SchemaRepairDiagnosticCard({ projectId }: Props) {
  const toast = useToast()
  const [failures, setFailures] = useState<RepairFailure[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null) // report_id being retried
  const [loading, setLoading] = useState(true)
  const [advisors, setAdvisors] = useState<DbAdvisor[]>([])
  const [advisorsExpanded, setAdvisorsExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)

      const [repairRes, advisorRes] = await Promise.all([
        apiFetch<{ failures: RepairFailure[] }>('/v1/admin/fixes/repair-failures'),
        apiFetch<{ advisors: DbAdvisor[]; projectRef: string } | null>(
          `/v1/admin/projects/${projectId}/db-advisors`,
        ),
      ])

      if (cancelled) return

      if (repairRes.ok && repairRes.data) {
        // C6: widen from only llm_no_object to all actionable categories.
        setFailures(
          repairRes.data.failures.filter(
            (f) =>
              f.project_id === projectId &&
              (ACTIONABLE_CATEGORIES.has(f.failure_category ?? 'llm_no_object')),
          ),
        )
      }
      if (advisorRes.ok && advisorRes.data?.advisors) {
        setAdvisors(advisorRes.data.advisors)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [projectId])

  const handleRetry = useCallback(async (failure: RepairFailure) => {
    setRetrying(failure.report_id)
    try {
      const res = await apiFetch<{ dispatchId: string }>(
        `/v1/admin/fixes/dispatch`,
        {
          method: 'POST',
          body: JSON.stringify({
            reportId: failure.report_id,
            projectId: failure.project_id,
          }),
        },
      )
      if (res.ok) {
        toast.success(
          'Retry queued',
          'The fix-worker will re-attempt with the schema-repair hint.',
        )
        // Remove the retried failure from the list
        setFailures((prev) => prev.filter((f) => f.id !== failure.id))
      } else {
        toast.error('Retry failed', res.error?.message ?? 'Could not dispatch the fix.')
      }
    } finally {
      setRetrying(null)
    }
  }, [toast])

  const hasAdvisors = advisors.length > 0
  if (loading || dismissed || (failures.length === 0 && !hasAdvisors)) return null

  const latest = failures[0]
  const extraCount = failures.length - 1

  return (
    <div
      role="alert"
      aria-label="Schema repair diagnostic"
      className="mx-4 mb-3 space-y-2"
    >
      {/* ── Fix-worker failures ─────────────────────────────────────── */}
      {failures.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/80 dark:border-amber-700/50 dark:bg-amber-950/30 px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2L12.5 12H1.5L7 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="7" cy="10" r="0.7" fill="currentColor"/>
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-semibold text-amber-800 dark:text-amber-300">
                  Fix-worker failure{failures.length > 1 ? ` · ${failures.length} retryable failures` : ''} — <span className="font-normal">Do stage bottleneck</span>
                </p>
                {latest.failure_category && CATEGORY_HINT[latest.failure_category] && (
                  <ContainedBlock tone="warn" className="mt-1">
                    <p className="text-2xs text-amber-700 dark:text-amber-400 leading-snug">
                      {CATEGORY_HINT[latest.failure_category]}
                    </p>
                  </ContainedBlock>
                )}
                {latest.failure_diagnostic && (
                  <ContainedBlock tone="warn" className="mt-1">
                    <p className="text-2xs text-amber-700/70 dark:text-amber-400/70 leading-snug line-clamp-2 font-mono">
                      {latest.failure_diagnostic.slice(0, 180)}
                    </p>
                  </ContainedBlock>
                )}
                {extraCount > 0 && (
                  <SignalChip tone="warn" className="mt-1">
                    +{extraCount} more failure{extraCount !== 1 ? 's' : ''} in the last 7 days
                  </SignalChip>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="shrink-0 mt-0.5 text-danger hover:bg-danger-muted/40 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              aria-label="Dismiss schema repair alert"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="mt-2.5 flex gap-2">
            <Btn
              size="sm"
              variant="primary"
              onClick={() => handleRetry(latest)}
              loading={retrying === latest.report_id}
              disabled={retrying !== null}
            >
              Retry with repair hint
            </Btn>
            {failures.length > 1 && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={async () => {
                  for (const f of failures) await handleRetry(f)
                }}
                loading={retrying !== null && retrying !== latest.report_id}
                disabled={retrying !== null}
              >
                Retry all ({failures.length})
              </Btn>
            )}
          </div>
        </div>
      )}

      {/* ── Supabase MCP advisors ───────────────────────────────────── */}
      {hasAdvisors && (
        <div className="rounded-md border border-blue-300/50 bg-blue-50/70 dark:border-blue-700/40 dark:bg-blue-950/25 px-3.5 py-3">
          <button
            type="button"
            className="w-full flex items-start justify-between gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
            onClick={() => setAdvisorsExpanded((v) => !v)}
            aria-expanded={advisorsExpanded}
          >
            <div className="flex items-center gap-2">
              <span className="text-blue-600 dark:text-blue-400" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M7 5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="7" cy="9.5" r="0.65" fill="currentColor"/>
                </svg>
              </span>
              <p className="text-2xs font-semibold text-blue-800 dark:text-blue-300">
                {advisors.length} Supabase advisor{advisors.length !== 1 ? 's' : ''} — <span className="font-normal">from Supabase MCP</span>
              </p>
            </div>
            <span className={`text-blue-500 transition-transform ${advisorsExpanded ? 'rotate-180' : ''}`} aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>
          {advisorsExpanded && (
            <ul className="mt-2 space-y-1.5">
              {advisors.map((a, i) => (
                <li key={i}>
                  <ContainedBlock tone="info" className="border-blue-300/40 bg-blue-50/50 dark:border-blue-700/30 dark:bg-blue-950/20">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <SignalChip tone={a.level === 'ERROR' ? 'danger' : 'warn'}>
                        {a.level ?? 'INFO'}
                      </SignalChip>
                      <strong className="text-2xs text-blue-800 dark:text-blue-300">{a.title ?? a.name}</strong>
                    </div>
                    {a.description && (
                      <p className="text-2xs text-blue-700 dark:text-blue-300 leading-snug">
                        {a.description.slice(0, 140)}
                      </p>
                    )}
                  </ContainedBlock>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
