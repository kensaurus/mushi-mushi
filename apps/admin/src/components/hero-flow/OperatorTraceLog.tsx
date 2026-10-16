/**
 * FILE: apps/admin/src/components/hero-flow/OperatorTraceLog.tsx
 * PURPOSE: Monospace operator trace — inline preview on tiles + full log in
 *          the detail panel with copy, filter, and portal tooltips.
 */
import { useMemo, useState } from 'react'

import { Btn, SegmentedControl } from '../ui'
import type { OperatorTraceLine, OperatorTraceLevel } from './operatorTrace'
import { summarizeOperatorTrace, traceToClipboardText } from './operatorTrace'
import { CHIP_TONE } from '../../lib/chipTone'

const LEVEL_CLASS: Record<OperatorTraceLevel, string> = {
  debug: 'text-fg-faint',
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-danger',
}

const LEVEL_BADGE: Record<OperatorTraceLevel, string> = {
  debug: 'bg-surface-overlay text-fg-faint',
  info: CHIP_TONE.infoSubtle,
  warn: CHIP_TONE.warnSubtle,
  error: 'bg-danger-muted/50 text-danger-foreground',
}

const LEVEL_ROW_BG: Record<OperatorTraceLevel, string> = {
  debug: '',
  info: '',
  warn: 'bg-warn/5',
  error: 'bg-danger/8',
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
            <span className="rounded bg-danger-muted/50 px-1 py-px text-3xs font-bold text-danger-foreground">
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
