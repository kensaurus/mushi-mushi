/**
 * FILE: apps/admin/src/components/hero-flow/OperatorTraceLog.tsx
 * PURPOSE: Monospace operator trace — inline preview on tiles + full log in
 *          the detail panel with copy, filter, and portal tooltips.
 */
import { useMemo, useState } from 'react'

import { Btn, SegmentedControl, Tooltip } from '../ui'
import type { OperatorTraceLine, OperatorTraceLevel } from './operatorTrace'
import { summarizeOperatorTrace, traceToClipboardText } from './operatorTrace'
import { CHIP_TONE } from '../../lib/chipTone'

const LEVEL_CLASS: Record<OperatorTraceLevel, string> = {
  debug: 'text-fg-faint',
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-err',
}

const LEVEL_BADGE: Record<OperatorTraceLevel, string> = {
  debug: 'bg-surface-overlay text-fg-faint',
  info: CHIP_TONE.infoSubtle,
  warn: CHIP_TONE.warnSubtle,
  error: 'bg-err/15 text-err',
}

const LEVEL_ROW_BG: Record<OperatorTraceLevel, string> = {
  debug: '',
  info: '',
  warn: 'bg-warn/5',
  error: 'bg-err/8',
}

type TraceFilter = 'all' | 'signal' | 'error'

function formatTs(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function filterLines(lines: OperatorTraceLine[], filter: TraceFilter): OperatorTraceLine[] {
  if (filter === 'all') return lines
  if (filter === 'error') return lines.filter((l) => l.level === 'error')
  return lines.filter((l) => l.level === 'warn' || l.level === 'error' || l.level === 'info')
}

/** Small badge for tile headers when trace has warnings/errors. */
export function OperatorTraceBadge({ lines }: { lines: OperatorTraceLine[] }) {
  const summary = summarizeOperatorTrace(lines)
  if (summary.errorCount === 0 && summary.warnCount === 0) return null
  const label =
    summary.errorCount > 0
      ? `${summary.errorCount} err`
      : `${summary.warnCount} warn`
  const tone =
    summary.errorCount > 0
      ? 'bg-err/20 text-err border-err/30'
      : CHIP_TONE.warnSubtle + ' border-warn/30'
  return (
    <span
      className={`ml-1 inline-flex shrink-0 items-center rounded px-1 py-px text-3xs font-bold uppercase tracking-wide border ${tone} ${summary.errorCount > 0 ? 'motion-safe:animate-pulse' : ''}`}
      title={`Operator trace: ${summary.errorCount} error(s), ${summary.warnCount} warning(s)`}
    >
      {label}
    </span>
  )
}

export function OperatorTracePreview({ lines }: { lines: OperatorTraceLine[] }) {
  if (lines.length === 0) return null
  const preview = lines.find((l) => l.level === 'error')
    ?? lines.find((l) => l.level === 'warn')
    ?? lines.find((l) => l.level !== 'debug' && l.source !== 'dav')
    ?? lines[lines.length - 1]
  const fullText = lines.map((l) => `${l.level} ${l.source}: ${l.message}`).join('\n')

  // Truncate message to 60 chars max so the pill reads cleanly at node width
  const msgPreview = preview.message.length > 60 ? `${preview.message.slice(0, 57)}…` : preview.message

  const row = (
    <p className="mt-1 font-mono text-3xs leading-snug text-fg-faint flex items-center gap-1 min-w-0">
      <span className={`shrink-0 ${LEVEL_CLASS[preview.level]}`}>{preview.level}</span>
      <span aria-hidden className="shrink-0 text-fg-faint/60">·</span>
      <span className="truncate text-fg-muted">{msgPreview}</span>
    </p>
  )

  return (
    <Tooltip content={<span className="whitespace-pre-wrap font-mono text-3xs leading-relaxed">{fullText}</span>} side="bottom" nowrap={false} portal>
      <span className="block cursor-help">{row}</span>
    </Tooltip>
  )
}

interface OperatorTraceLogProps {
  lines: OperatorTraceLine[]
  variant?: 'compact' | 'full'
}

export function OperatorTraceLog({ lines, variant = 'full' }: OperatorTraceLogProps) {
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState<TraceFilter>('all')
  const summary = useMemo(() => summarizeOperatorTrace(lines), [lines])
  const visible = useMemo(() => filterLines(lines, filter), [lines, filter])

  if (lines.length === 0) return null

  async function handleCopy() {
    const text = traceToClipboardText(lines)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const maxH = variant === 'compact' ? 'max-h-24' : 'max-h-48'

  const filters: Array<{ id: TraceFilter; label: string; count?: number }> = [
    { id: 'all', label: 'All', count: summary.lineCount },
    { id: 'signal', label: 'Signal', count: summary.lineCount - lines.filter((l) => l.level === 'debug').length },
    { id: 'error', label: 'Errors', count: summary.errorCount },
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-3xs font-semibold uppercase tracking-wider text-fg-faint">
            Operator trace
          </span>
          {summary.errorCount > 0 && (
            <span className="rounded bg-err/15 px-1 py-px text-3xs font-bold text-err">
              {summary.errorCount} error{summary.errorCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <Btn size="sm" variant="ghost" onClick={() => void handleCopy()}>
          {copied ? 'Copied' : 'Copy trace'}
        </Btn>
      </div>
      {variant === 'full' && (
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={filters.map((f) => ({
            id: f.id,
            label: f.label,
            count: f.count != null && f.count > 0 ? f.count : undefined,
          }))}
          ariaLabel="Filter trace lines"
          size="sm"
        />
      )}
      <div
        className={`overflow-y-auto rounded-md border border-edge-subtle/80 bg-viz-terminal-bg/90 px-2.5 py-2 font-mono text-3xs leading-relaxed ${maxH}`}
        role="log"
        aria-label="Operator debug trace"
        aria-live="polite"
      >
        {visible.length === 0 ? (
          <p className="text-fg-faint py-1">No lines match this filter.</p>
        ) : (
          visible.map((line, i) => (
            <div
              key={`${line.source}-${line.ts ?? ''}-${i}`}
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm px-0.5 py-0.5 ${LEVEL_ROW_BG[line.level]}`}
            >
              {line.ts && (
                <span className="shrink-0 tabular-nums text-fg-faint/80">{formatTs(line.ts)}</span>
              )}
              <span className={`shrink-0 rounded px-1 py-px text-3xs font-bold uppercase ${LEVEL_BADGE[line.level]}`}>
                {line.level}
              </span>
              <span className="shrink-0 text-fg-faint">{line.source}</span>
              <span className={`min-w-0 break-words ${LEVEL_CLASS[line.level]}`}>{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
