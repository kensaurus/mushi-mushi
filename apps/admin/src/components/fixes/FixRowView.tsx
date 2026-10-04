/**
 * Compact fix attempt row — scannable like ReportsTable rows. Heavy PDCA
 * chrome lives in FixDetailPanel (progressive disclosure, NN/g #6).
 */

import { memo, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, RelativeTime, Tooltip, PipelineStrip, Btn } from '../ui'
import { PIPELINE_STATUS, pipelineStatusLabel } from '../../lib/tokens'
import { isGithubUrl } from '../../lib/githubUrl'
import { useRowFlash } from '../../lib/useRowFlash'
import { useStaggeredAppear } from '../../lib/useStaggeredAppear'
import { CursorAgentBadge } from './CursorAgentBadge'
import { ClaudeAgentBadge } from './ClaudeAgentBadge'
import { buildFixPipelineStages, fixStatusStripeClass } from './fixPipelineStages'
import { ciBadge, type FixAttempt } from './types'
import { credentialAdvice, failureHeadline, fixReportLabel, isSuperseded, needsAttention, supersededLabel } from '../../lib/fixReportTruth'
import { IconChevronDown, IconChevronUp } from '../icons'
import { FIXES_TABLE_COL, TABLE_CELL } from './fixesTableLayout'
import { fixRowDomId } from '../../lib/fixDeepLink'

const AGENT_LABEL: Record<string, string> = {
  cursor_cloud: 'Cursor',
  claude_code_agent: 'Claude',
}

interface Props {
  fix: FixAttempt
  index: number
  isExpanded: boolean
  isInFlight: boolean
  onToggle: () => void
  onRetry: () => void
  compactTable?: boolean
  actionLabels?: {
    openPr?: string
    retry?: string
    expand?: string
    collapse?: string
  }
}

function FixRowViewInner({
  fix,
  index,
  isExpanded,
  isInFlight,
  onToggle,
  onRetry,
  compactTable = false,
  actionLabels,
}: Props) {
  const ci = ciBadge(fix)
  const stages = buildFixPipelineStages(fix)
  const stripe = fixStatusStripeClass(fix)
  const agentShort = AGENT_LABEL[fix.agent] ?? fix.agent
  // Read against the report's current state: an attempt whose report a later
  // PR fixed is neutral history, the latest stopped attempt shows its real
  // reason inline (A12, glot.it 2026-10-04).
  const superseded = isSuperseded(fix)
  const stopped = needsAttention(fix)
  const headline = stopped || (!superseded && fix.error) ? failureHeadline(fix) : null
  const keyAdvice = stopped ? credentialAdvice(fix) : null
  const [detailsOpen, setDetailsOpen] = useState(false)

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

  const stagger = useStaggeredAppear({ stepMs: 18, max: 12 })

  const labels = {
    openPr: actionLabels?.openPr ?? 'PR',
    retry: actionLabels?.retry ?? 'Retry',
    expand: actionLabels?.expand ?? 'Expand fix details',
    collapse: actionLabels?.collapse ?? 'Collapse fix details',
  }

  return (
    <>
      <tr
        id={fixRowDomId(fix.id)}
        className={`group border-t border-edge-subtle hover:bg-surface-overlay/50 motion-safe:transition-opacity cursor-pointer motion-safe:animate-mushi-fade-in ${flash.className}`}
        style={{ ...stagger(index), ...flash.style }}
        onAnimationEnd={flash.onAnimationEnd}
        onClick={onToggle}
        data-testid={index === 0 ? 'fix-row' : undefined}
        data-tour-id={index === 0 ? 'fix-card' : undefined}
      >
        <td className={`${FIXES_TABLE_COL.stripe} p-0 align-stretch`}>
          {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
          <span className={`block w-1 min-h-[2.75rem] ${stripe}`} aria-hidden />
        </td>
        <td className={`${FIXES_TABLE_COL.status} ${TABLE_CELL.pxMeta} py-2 align-middle whitespace-nowrap`}>
          <div className="flex flex-col gap-0.5 min-w-0">
            {superseded ? (
              <Badge className="w-fit max-w-full min-w-0 truncate text-2xs bg-surface-overlay text-fg-muted">
                Superseded
              </Badge>
            ) : (
              <Badge className={`w-fit max-w-full min-w-0 truncate text-2xs ${PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}`}>
                {pipelineStatusLabel(fix.status)}
              </Badge>
            )}
            <span className="text-2xs text-fg-faint font-mono truncate">{agentShort}</span>
          </div>
        </td>
        <td className={`${FIXES_TABLE_COL.report} ${TABLE_CELL.pxLead} py-2 align-middle min-w-0 overflow-hidden`}>
          <div className="min-w-0 space-y-0.5">
            <Link
              to={`/reports/${fix.report_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-fg-secondary hover:text-fg font-medium truncate block"
              title={fix.report_title ?? undefined}
            >
              {fixReportLabel(fix)}
            </Link>
            {superseded ? (
              <p className="text-2xs text-fg-muted truncate" data-testid="fix-row-superseded">
                {supersededLabel(fix)}
              </p>
            ) : headline ? (
              <div className="min-w-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <p
                  className={`text-2xs truncate ${stopped ? 'text-danger' : 'text-fg-muted'}`}
                  title={headline.title}
                  data-testid="fix-row-reason"
                >
                  {keyAdvice?.message ?? headline.title}
                </p>
                <div className="flex flex-wrap items-center gap-x-2">
                  {keyAdvice?.to && keyAdvice.linkLabel ? (
                    <Link to={keyAdvice.to} className="text-2xs text-accent hover:underline">
                      {keyAdvice.linkLabel}
                    </Link>
                  ) : null}
                  {headline.firstLine ? (
                    <button
                      type="button"
                      className="text-2xs text-fg-faint underline underline-offset-2 hover:text-fg-muted"
                      aria-expanded={detailsOpen}
                      onClick={() => setDetailsOpen((o) => !o)}
                    >
                      {detailsOpen ? 'Hide details' : 'Details'}
                    </button>
                  ) : null}
                </div>
                {detailsOpen && headline.firstLine ? (
                  <p className="mt-0.5 text-2xs font-mono text-fg-faint whitespace-pre-wrap break-all">
                    {headline.firstLine}
                  </p>
                ) : null}
              </div>
            ) : fix.summary ? (
              <p className="text-2xs text-fg-muted truncate" title={fix.summary}>
                {fix.summary}
              </p>
            ) : null}
          </div>
        </td>
        {!compactTable ? (
          <td className={`${FIXES_TABLE_COL.pipeline} ${TABLE_CELL.pxMeta} py-2 align-middle whitespace-nowrap`}>
            <PipelineStrip stages={stages} compact />
          </td>
        ) : null}
        {!compactTable ? (
          <td className={`${FIXES_TABLE_COL.ci} ${TABLE_CELL.pxMeta} py-2 align-middle hidden md:table-cell`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              {fix.agent === 'cursor_cloud' && fix.cursor_agent_id && (
                <CursorAgentBadge agentId={fix.cursor_agent_id} />
              )}
              {fix.agent === 'claude_code_agent' && (
                <ClaudeAgentBadge
                  workflowRunUrl={fix.claude_workflow_run_url}
                  isRunning={fix.status === 'running' || fix.status === 'queued'}
                />
              )}
              {ci ? (
                <Badge className={ci.className}>{ci.label}</Badge>
              ) : (
                <span className="text-3xs text-fg-faint">—</span>
              )}
            </div>
          </td>
        ) : null}
        <td className={`${FIXES_TABLE_COL.started} ${TABLE_CELL.pxMeta} py-2 align-middle text-right tabular-nums whitespace-nowrap`}>
          <RelativeTime value={fix.started_at} className="text-2xs text-fg-muted" />
        </td>
        <td className={`${FIXES_TABLE_COL.action} ${TABLE_CELL.pxMeta} py-2 align-middle text-right whitespace-nowrap`}>
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {fix.retryable === true && (
              isInFlight ? (
                <Tooltip content="A fix for this report is already in-flight.">
                  <span className="text-3xs text-fg-faint px-1">{labels.retry}</span>
                </Tooltip>
              ) : (
                <Btn
                  size="sm"
                  variant="ghost"
                  className="text-warn hover:text-warn/90 !px-1.5 !py-0.5 text-2xs"
                  onClick={() => onRetry()}
                >
                  {keyAdvice?.retryNow ? 'Retry fix' : labels.retry}
                </Btn>
              )
            )}
            {fix.pr_url && isGithubUrl(fix.pr_url) && (
              <a
                href={fix.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xs text-accent hover:underline px-1 whitespace-nowrap"
              >
                {fix.pr_number ? `${labels.openPr} #${fix.pr_number}` : labels.openPr}
              </a>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-overlay"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? labels.collapse : labels.expand}
            >
              {isExpanded ? <IconChevronUp className="h-3.5 w-3.5" /> : <IconChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </td>
      </tr>
    </>
  )
}

export const FixRowView = memo(FixRowViewInner)
