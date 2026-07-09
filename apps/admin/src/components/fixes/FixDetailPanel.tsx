/**
 * Expanded fix detail — PDCA flow, receipt, timeline, errors. Shown only when
 * a row is expanded so the attempts list stays scannable.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isGithubUrl } from '../../lib/githubUrl'
import { FixGitGraph, type FixTimelineEvent } from '../FixGitGraph'
import { PdcaReceipt } from './PdcaReceipt'
import { FixAttemptFlow } from './FixAttemptFlow'
import { CursorArtifactsGallery } from './CursorArtifactsGallery'
import { FixErrorPanel } from './FixErrorPanel'
import { pluralizeWithCount } from '../../lib/format'
import { formatTokens } from '../charts'
import type { FixAttempt } from './types'
import { RelativeTime } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import * as Sentry from '@sentry/react'

interface InventoryActionSummary {
  actionNodeId: string
  actionLabel: string
  actionDescription?: string | null
  pagePath?: string | null
  storyTitle?: string | null
  expectedOutcome?: Record<string, unknown> | null
  status?: string | null
}

interface Props {
  fix: FixAttempt
  timeline: FixTimelineEvent[] | undefined
  traceUrl: string | null
  onRetry: () => Promise<void>
  onRefreshed?: () => void
  isInFlight?: boolean
  inventoryAction?: InventoryActionSummary | null
}

export function FixDetailPanel({
  fix,
  timeline,
  traceUrl,
  onRetry,
  onRefreshed,
  isInFlight = false,
  inventoryAction,
}: Props) {
  const toast = useToast()
  const totalTokens = (fix.llm_input_tokens ?? 0) + (fix.llm_output_tokens ?? 0)
  const specWarnings = fix.spec_validation_warnings ?? []

  const [ciRefreshing, setCiRefreshing] = useState(false)
  const handleRefreshCi = async () => {
    if (ciRefreshing) return
    setCiRefreshing(true)
    try {
      await apiFetch(`/v1/admin/fixes/${fix.id}/refresh-ci`, { method: 'POST' })
      onRefreshed?.()
    } catch (err) {
      toast.error('Could not refresh CI status from GitHub')
      Sentry.captureMessage('fix refresh-ci failed', {
        level: 'warning',
        extra: { fixId: fix.id, error: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      setCiRefreshing(false)
    }
  }

  return (
    <div className="border-t border-edge bg-surface-overlay/30 px-3 py-3 space-y-3">
      <FixAttemptFlow fix={fix} />
      <PdcaReceipt fix={fix} timeline={timeline} />

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted font-mono">
        {fix.branch && (
          <span title={fix.branch}>
            Branch: {fix.branch.length > 40 ? `${fix.branch.slice(0, 40)}…` : fix.branch}
          </span>
        )}
        {fix.lines_changed != null && <span>{pluralizeWithCount(fix.lines_changed, 'line')}</span>}
        {fix.files_changed && <span>{pluralizeWithCount(fix.files_changed.length, 'file')}</span>}
        {totalTokens > 0 && (
          <span title={`Input: ${fix.llm_input_tokens} · Output: ${fix.llm_output_tokens}`}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
        {traceUrl && (
          <a
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            Langfuse trace ↗
          </a>
        )}
        {fix.agent === 'cursor_cloud' && fix.cursor_agent_id && (
          <a
            href={`https://cursor.com/agents/${fix.cursor_agent_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-foreground hover:text-accent-hover underline"
          >
            Cursor agent ↗
          </a>
        )}
        {fix.pr_url && isGithubUrl(fix.pr_url) && (
          <a
            href={fix.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            {`PR${fix.pr_number ? ` #${fix.pr_number}` : ''} ↗`}
          </a>
        )}
        {fix.pr_url && (
          <button
            type="button"
            onClick={() => void handleRefreshCi()}
            disabled={ciRefreshing}
            className="text-fg-muted hover:text-fg underline disabled:opacity-50 disabled:cursor-wait"
            title="Fetch latest CI / merge state from GitHub"
          >
            {ciRefreshing ? 'Refreshing…' : 'Refresh from GitHub'}
          </button>
        )}
        {fix.check_run_updated_at && (
          <span className="text-fg-faint" title={`CI last synced: ${new Date(fix.check_run_updated_at).toLocaleString()}`}>
            CI synced <RelativeTime value={fix.check_run_updated_at} />
          </span>
        )}
        <Link to={`/reports/${fix.report_id}`} className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          Source report →
        </Link>
        {fix.failure_category && (
          <Link to="/judge" className="text-fg-muted hover:text-fg underline">
            Judge scores →
          </Link>
        )}
      </div>

      {timeline ? (
        <div>
          <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-1">PDCA timeline</h4>
          <FixGitGraph
            events={timeline}
            prUrl={fix.pr_url}
            prNumber={fix.pr_number}
            prState={fix.pr_state}
            branchName={fix.branch}
            commitSha={fix.commit_sha}
            agentModel={fix.llm_model ?? fix.agent}
            filesChanged={fix.files_changed}
            linesChanged={fix.lines_changed}
          />
        </div>
      ) : (
        <p className="text-2xs text-fg-faint">Loading timeline…</p>
      )}

      {fix.rationale && (
        <div>
          <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Rationale</h4>
          <p className="text-xs text-fg-secondary whitespace-pre-wrap">{fix.rationale}</p>
        </div>
      )}

      {fix.files_changed && fix.files_changed.length > 0 && (
        <div>
          <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Files changed</h4>
          <ul className="text-2xs font-mono text-fg-muted space-y-0.5 max-h-32 overflow-y-auto">
            {fix.files_changed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {specWarnings.length > 0 && (
        <div>
          <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-0.5">Spec validation warnings</h4>
          <ul className="text-2xs text-fg-secondary space-y-1">
            {specWarnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="rounded border border-warn/40 bg-warn-muted/20 px-2 py-1"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-warn">{w.code}</span>
                  <span>{w.message}</span>
                </div>
                {w.hint && <p className="text-fg-muted mt-0.5">Hint: {w.hint}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fix.agent === 'cursor_cloud' && fix.cursor_artifacts && fix.cursor_artifacts.length > 0 && (
        <CursorArtifactsGallery artifacts={fix.cursor_artifacts} />
      )}

      {inventoryAction && (
        <div>
          <h4 className="text-2xs uppercase tracking-wide text-fg-faint mb-1">Origin — Inventory action</h4>
          <div className="rounded border border-edge bg-surface-overlay px-2 py-1.5 space-y-0.5 text-2xs">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-accent">{inventoryAction.actionLabel}</span>
              {inventoryAction.status && (
                <span
                  className={
                    inventoryAction.status === 'verified'
                      ? 'text-ok'
                      : inventoryAction.status === 'regressed'
                        ? 'text-danger'
                        : 'text-fg-muted'
                  }
                >
                  {inventoryAction.status}
                </span>
              )}
            </div>
            {inventoryAction.actionDescription && (
              <p className="text-fg-secondary">{inventoryAction.actionDescription}</p>
            )}
            {inventoryAction.pagePath && (
              <p className="text-fg-muted font-mono">{inventoryAction.pagePath}</p>
            )}
            {inventoryAction.storyTitle && (
              <p className="text-fg-faint">Story: {inventoryAction.storyTitle}</p>
            )}
          </div>
        </div>
      )}

      <FixErrorPanel
        error={fix.error}
        agent={fix.agent}
        category={fix.failure_category}
        onRetry={isInFlight ? undefined : () => void onRetry()}
      />
    </div>
  )
}
