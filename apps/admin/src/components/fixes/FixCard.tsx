/**
 * FILE: apps/admin/src/components/fixes/FixCard.tsx
 * PURPOSE: Single-fix card. Status, model + token cost, PR link, Langfuse
 *          trace, retry button, and an expandable PDCA timeline + rationale +
 *          file list. The page composes these in a list.
 */

import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge, RelativeTime } from '../ui'
import { formatTokens } from '../charts'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens'
import { useRowFlash } from '../../lib/useRowFlash'
import { FixGitGraph, type FixTimelineEvent } from '../FixGitGraph'
import { PdcaReceipt } from './PdcaReceipt'
import { pluralizeWithCount } from '../../lib/format'
import { ciBadge, type FixAttempt } from './types'
import { FixAttemptFlow } from './FixAttemptFlow'

interface Props {
  fix: FixAttempt
  isOpen: boolean
  timeline: FixTimelineEvent[] | undefined
  traceUrl: string | null
  onToggle: () => void
  onRetry: () => Promise<void>
}

export function FixCard({ fix, isOpen, timeline, traceUrl, onToggle, onRetry }: Props) {
  const ci = ciBadge(fix)
  const totalTokens = (fix.llm_input_tokens ?? 0) + (fix.llm_output_tokens ?? 0)

  // Wave T.2.5: one-shot background wash on realtime status transitions so
  // a live dispatch `queued → running → completed` flashes in-card. Tone
  // follows the status's semantic colour so green = good, red = failed.
  const flashToneFor = useCallback((s: FixAttempt['status']) => {
    switch (s) {
      case 'completed':
      case 'merged':
        return 'var(--color-ok)'
      case 'failed':
      case 'cancelled':
        return 'var(--color-danger)'
      case 'running':
      case 'dispatched':
      case 'queued':
        return 'var(--color-info)'
      default:
        return 'var(--color-brand)'
    }
  }, [])
  const flash = useRowFlash({
    rowKey: fix.id,
    value: fix.status,
    toneFor: flashToneFor,
  })

  return (
    <div
      className={`rounded-md ${flash.className}`}
      style={flash.style}
      onAnimationEnd={flash.onAnimationEnd}
    >
    <Card className="p-3 space-y-1.5">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}>
            {pipelineStatusLabel(fix.status)}
          </Badge>
          <span className="text-2xs text-fg-muted">via {fix.agent}</span>
          {fix.llm_model && (
            <span className="text-2xs font-mono text-fg-faint" title="LLM model used">
              {fix.llm_model}
            </span>
          )}
          {ci && <Badge className={ci.className}>{ci.label}</Badge>}
          {fix.review_passed === false && (
            <Badge className="bg-warn-muted text-warn" title="The agent flagged this for extra human review.">
              Needs review
            </Badge>
          )}
        </div>
        <span className="text-2xs text-fg-muted tabular-nums">
          <RelativeTime value={fix.started_at} />
        </span>
      </div>

      {fix.summary && <p className="text-xs text-fg-secondary">{fix.summary}</p>}

      <FixAttemptFlow fix={fix} className="mt-1" />

      <PdcaReceipt fix={fix} timeline={timeline} className="pt-1" />

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted font-mono">
        <Link to={`/reports/${fix.report_id}`} className="hover:text-fg-secondary underline-offset-2 hover:underline">
          Report: {fix.report_id.slice(0, 8)}…
        </Link>
        {fix.branch && <span title={fix.branch}>Branch: {fix.branch.length > 32 ? `${fix.branch.slice(0, 32)}…` : fix.branch}</span>}
        {fix.lines_changed != null && <span>{pluralizeWithCount(fix.lines_changed, 'line')}</span>}
        {fix.files_changed && <span>{pluralizeWithCount(fix.files_changed.length, 'file')}</span>}
        {totalTokens > 0 && (
          <span title={`Input: ${fix.llm_input_tokens} · Output: ${fix.llm_output_tokens}`}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {fix.pr_url && (
          <a
            href={fix.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            View PR{fix.pr_number ? ` #${fix.pr_number}` : ''}
          </a>
        )}
        {traceUrl && (
          <a
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted hover:text-accent underline-offset-2 hover:underline"
            title="Inspect this fix's LLM call in Langfuse — prompts, output, token cost"
          >
            Langfuse trace
          </a>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="text-fg-muted hover:text-fg underline-offset-2 hover:underline"
        >
          {isOpen ? 'Hide details' : 'Show details'}
        </button>
        {fix.status === 'failed' && (
          <button
            type="button"
            onClick={() => void onRetry()}
            className="text-warn hover:text-warn underline-offset-2 hover:underline"
          >
            Retry
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-1 pt-2 border-t border-edge space-y-2">
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
              <ul className="text-2xs font-mono text-fg-muted space-y-0.5">
                {fix.files_changed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {fix.error && (
        <div className="rounded bg-danger-muted/40 px-2 py-1.5 text-2xs text-danger">
          <span className="font-mono uppercase tracking-wide">Error · </span>
          <span className="font-mono">{fix.error}</span>
        </div>
      )}
    </Card>
    </div>
  )
}
