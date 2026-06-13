/**
 * Inline CI status for a fix attempt — pull latest from GitHub on demand and
 * link out to the PR checks tab for full logs.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { RelativeTime } from '../ui'

interface Props {
  fixId: string
  prUrl: string
  prNumber?: number | null
  ciConclusion?: string | null
  ciStatus?: string | null
  ciUpdatedAt?: string | null
  onRefresh?: (next: { conclusion: string | null; status: string | null; updatedAt: string | null }) => void
  compact?: boolean
}

function checksUrl(prUrl: string): string {
  return prUrl.endsWith('/checks') ? prUrl : `${prUrl.replace(/\/$/, '')}/checks`
}

function toneForConclusion(conclusion: string | null | undefined): string {
  const c = conclusion?.toLowerCase()
  if (c === 'success') return 'text-ok border-ok/30 bg-ok/10'
  if (c === 'failure' || c === 'timed_out' || c === 'cancelled') return 'text-danger border-danger/30 bg-danger/10'
  if (c === 'neutral' || c === 'skipped') return 'text-fg-secondary border-edge-subtle bg-surface-overlay'
  return 'text-warn border-warn/30 bg-warn/10'
}

function labelForConclusion(conclusion: string | null | undefined, status: string | null | undefined): string {
  const c = conclusion?.toLowerCase()
  const s = status?.toLowerCase()
  if (s === 'in_progress' || s === 'queued') return 'CI running…'
  if (c === 'success') return 'CI passed'
  if (c === 'failure') return 'CI failed'
  if (c === 'timed_out') return 'CI timed out'
  if (c === 'cancelled') return 'CI cancelled'
  if (c === 'neutral' || c === 'skipped') return `CI ${c}`
  return 'CI status unknown'
}

export function FixCiFeedback({
  fixId,
  prUrl,
  prNumber,
  ciConclusion,
  ciStatus,
  ciUpdatedAt,
  onRefresh,
  compact = false,
}: Props) {
  const [conclusion, setConclusion] = useState(ciConclusion ?? null)
  const [status, setStatus] = useState(ciStatus ?? null)
  const [updatedAt, setUpdatedAt] = useState(ciUpdatedAt ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    setError(null)
    const res = await apiFetch<{
      check_run_conclusion?: string | null
      check_run_status?: string | null
      check_run_updated_at?: string | null
    }>(`/v1/admin/fixes/${fixId}/refresh-ci`, { method: 'POST' })
    setRefreshing(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not refresh CI')
      return
    }
    const next = {
      conclusion: res.data?.check_run_conclusion ?? null,
      status: res.data?.check_run_status ?? null,
      updatedAt: res.data?.check_run_updated_at ?? new Date().toISOString(),
    }
    setConclusion(next.conclusion)
    setStatus(next.status)
    setUpdatedAt(next.updatedAt)
    onRefresh?.(next)
  }

  const tone = toneForConclusion(conclusion)
  const label = labelForConclusion(conclusion, status)
  const ghChecks = checksUrl(prUrl)

  return (
    <div
      className={
        compact
          ? 'space-y-1'
          : 'rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2.5 py-2 space-y-1.5'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium ${tone}`}
        >
          {label}
          {prNumber ? ` · PR #${prNumber}` : ''}
        </span>
        {updatedAt && (
          <span className="text-2xs text-fg-faint">
            synced <RelativeTime value={updatedAt} />
          </span>
        )}
      </div>

      {!compact && (
        <p className="text-2xs text-fg-muted leading-relaxed">
          {conclusion === 'failure' || conclusion === 'timed_out' ? (
            <>
              GitHub reported a failing check (typically{' '}
              <span className="font-medium text-fg-secondary">Lint, Type-check &amp; Build</span>
              ). Open the run log, fix the branch, then refresh here before merging.
            </>
          ) : conclusion === 'success' ? (
            <>All required checks passed — safe to squash-merge from the console.</>
          ) : (
            <>Pull the latest check-run state from GitHub or open the PR checks tab.</>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="font-medium text-accent hover:underline disabled:opacity-50"
        >
          {refreshing ? 'Refreshing CI…' : 'Refresh CI status'}
        </button>
        <span aria-hidden="true" className="text-fg-faint select-none">·</span>
        <a
          href={ghChecks}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent hover:underline"
        >
          View GitHub Actions log →
        </a>
      </div>

      {error && (
        <p className="text-2xs text-danger">{error}</p>
      )}
    </div>
  )
}
