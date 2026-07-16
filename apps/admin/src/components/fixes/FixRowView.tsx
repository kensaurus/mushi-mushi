/**
 * Compact fix attempt row — scannable like ReportsTable rows. Heavy PDCA
 * chrome lives in FixDetailPanel (progressive disclosure, NN/g #6).
 */

import { memo, useCallback } from 'react'
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
import { humanizeFixError } from '../../lib/humanizeFixError'
import { IconChevronDown, IconChevronUp } from '../icons'
import { FIXES_TABLE_COL, TABLE_CELL } from './fixesTableLayout'

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
  const humanized = fix.error ? humanizeFixError(fix.error, { agent: fix.agent, category: fix.failure_category }) : null

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
        className={`group border-t border-edge-subtle hover:bg-surface-overlay/50 motion-safe:transition-opacity cursor-pointer motion-safe:animate-mushi-fade-in ${flash.className}`}
        style={{ ...stagger(index), ...flash.style }}
        onAnimationEnd={flash.onAnimationEnd}
        onClick={onToggle}
        data-testid={index === 0 ? 'fix-row' : undefined}
        data-tour-id={index === 0 ? 'fix-card' : undefined}
      >
        <td className={`${FIXES_TABLE_COL.stripe} p-0 align-stretch`}>
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
          <span className={`block w-1 min-h-[2.75rem] ${stripe}`} aria-hidden />
        </td>
        <td className={`${FIXES_TABLE_COL.status} ${TABLE_CELL.pxMeta} py-2 align-middle whitespace-nowrap`}>
          <div className="flex flex-col gap-0.5 min-w-0">
            <Badge className={`w-fit max-w-full min-w-0 truncate text-2xs ${PIPELINE_STATUS[fix.status] ?? 'bg-surface-overlay text-fg-muted'}`}>
              {pipelineStatusLabel(fix.status)}
            </Badge>
            <span className="text-2xs text-fg-faint font-mono truncate">{agentShort}</span>
          </div>
        </td>
        <td className={`${FIXES_TABLE_COL.report} ${TABLE_CELL.pxLead} py-2 align-middle min-w-0 overflow-hidden`}>
          <div className="min-w-0 space-y-0.5">
            <Link
              to={`/reports/${fix.report_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-fg-secondary hover:text-fg font-medium truncate block"
            >
              Report {fix.report_id.slice(0, 8)}…
            </Link>
            {(fix.summary || humanized?.title) && (
              <p className="text-2xs text-fg-muted truncate" title={fix.summary ?? humanized?.title}>
                {humanized?.title ?? fix.summary}
              </p>
            )}
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
            {fix.status === 'failed' && (
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
                  {labels.retry}
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
