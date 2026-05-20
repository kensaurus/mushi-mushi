/**
 * FILE: apps/admin/src/components/hero-flow/operatorTrace.ts
 * PURPOSE: Build a structured operator/debug trace for DAV tiles — mirrors
 *          how SRE consoles surface "why" + "what fired" + anchor metadata
 *          without leaving the hero strip.
 */
import type { DavEvidence } from '../../lib/davManifest'
import type { PageHeroDecide, PageHeroVerify } from '../PageHero'
import type { PageAction } from '../PageActionBar'

export type OperatorTraceLevel = 'debug' | 'info' | 'warn' | 'error'

export interface OperatorTraceLine {
  level: OperatorTraceLevel
  source: string
  message: string
  ts?: string
}

export interface BuildOperatorTraceInput {
  scope: string
  tile: 'decide' | 'act' | 'verify'
  decide?: PageHeroDecide
  action?: PageAction | null
  verify?: PageHeroVerify
  evidence?: DavEvidence
  anchor?: string
  extraDebugLines?: OperatorTraceLine[]
}

function push(
  lines: OperatorTraceLine[],
  level: OperatorTraceLevel,
  source: string,
  message: string,
  ts?: string,
) {
  lines.push({ level, source, message, ts })
}

function appendEvidenceLines(lines: OperatorTraceLine[], evidence?: DavEvidence) {
  if (!evidence) return

  if (evidence.kind === 'rule-trace') {
    push(lines, 'info', 'rule', evidence.why)
    if (evidence.threshold) {
      push(lines, 'debug', 'rule.threshold', evidence.threshold)
    }
    return
  }

  if (evidence.kind === 'metric-breakdown') {
    if (evidence.whyNow) push(lines, 'info', 'metric', evidence.whyNow)
    for (const item of evidence.items) {
      push(
        lines,
        item.tone === 'crit' || item.tone === 'warn' ? 'warn' : 'info',
        `metric.${item.label}`,
        `${item.label}=${item.value}`,
      )
    }
    return
  }

  if (evidence.kind === 'last-event') {
    push(lines, 'info', 'event', evidence.payloadSummary, evidence.at)
    push(lines, 'debug', 'event.actor', evidence.by, evidence.at)
    if (evidence.status) {
      push(
        lines,
        evidence.status === 'error' ? 'error' : evidence.status === 'warn' ? 'warn' : 'info',
        'event.status',
        evidence.status,
        evidence.at,
      )
    }
  }
}

/** Compose a full trace for the detail panel + tile preview. */
export function buildOperatorTrace(input: BuildOperatorTraceInput): OperatorTraceLine[] {
  const lines: OperatorTraceLine[] = []
  const now = new Date().toISOString()

  push(lines, 'debug', 'dav', `${input.scope} · ${input.tile}`, now)
  if (input.anchor) push(lines, 'debug', 'anchor', input.anchor, now)

  if (input.tile === 'decide' && input.decide) {
    push(lines, 'info', 'state.label', input.decide.label, now)
    if (input.decide.metric) {
      push(lines, 'info', 'state.metric', input.decide.metric, now)
    }
    if (input.decide.severity) {
      push(lines, input.decide.severity === 'crit' ? 'error' : input.decide.severity === 'warn' ? 'warn' : 'info', 'severity', input.decide.severity, now)
    }
    push(lines, 'debug', 'summary', input.decide.summary, now)
  }

  if (input.tile === 'act') {
    if (input.action) {
      push(lines, 'info', 'action.tone', input.action.tone, now)
      push(lines, 'info', 'action.title', input.action.title, now)
      if (input.action.reason) push(lines, 'debug', 'action.reason', input.action.reason, now)
      if (input.action.primary) {
        const p = input.action.primary
        push(lines, 'debug', 'action.primary', p.kind === 'link' ? `${p.label} → ${p.to}` : p.label, now)
      }
    } else {
      push(lines, 'info', 'action', 'idle — no NBA surfaced for this scope', now)
    }
  }

  if (input.tile === 'verify' && input.verify) {
    push(lines, 'info', 'verify.label', input.verify.label, now)
    push(lines, 'info', 'verify.detail', input.verify.detail, now)
    if (input.verify.to) push(lines, 'debug', 'verify.link', input.verify.to, now)
  }

  appendEvidenceLines(lines, input.evidence)

  if (input.tile === 'decide' && input.decide?.debugLines) {
    for (const row of input.decide.debugLines) {
      push(lines, row.level ?? 'info', row.source ?? 'runtime', row.message, row.ts)
    }
  }
  if (input.tile === 'verify' && input.verify?.debugLines) {
    for (const row of input.verify.debugLines) {
      push(lines, row.level ?? 'info', row.source ?? 'runtime', row.message, row.ts)
    }
  }
  if (input.tile === 'act' && input.extraDebugLines) {
    for (const row of input.extraDebugLines) {
      push(lines, row.level ?? 'info', row.source ?? 'runtime', row.message, row.ts)
    }
  }

  return lines
}

/** One-line preview for collapsed tiles (highest-signal non-debug line). */
export function tracePreviewLine(lines: OperatorTraceLine[]): string | null {
  const pick =
    [...lines].reverse().find((l) => l.level === 'error')
    ?? [...lines].reverse().find((l) => l.level === 'warn')
    ?? lines.find((l) => l.level === 'info' && l.source !== 'dav')
    ?? lines.find((l) => l.source !== 'dav')
  if (!pick) return null
  return `${pick.source}: ${pick.message}`
}

export function traceToClipboardText(lines: OperatorTraceLine[]): string {
  return lines
    .map((l) => {
      const ts = l.ts ? new Date(l.ts).toISOString() : ''
      return [ts, l.level.toUpperCase(), l.source, l.message].filter(Boolean).join(' ')
    })
    .join('\n')
}

export interface OperatorTraceSummary {
  lineCount: number
  errorCount: number
  warnCount: number
  worstLevel: OperatorTraceLevel
}

export function summarizeOperatorTrace(lines: OperatorTraceLine[]): OperatorTraceSummary {
  let errorCount = 0
  let warnCount = 0
  let worstLevel: OperatorTraceLevel = 'debug'
  for (const line of lines) {
    if (line.level === 'error') errorCount++
    if (line.level === 'warn') warnCount++
    if (line.level === 'error') worstLevel = 'error'
    else if (line.level === 'warn' && worstLevel !== 'error') worstLevel = 'warn'
    else if (line.level === 'info' && worstLevel === 'debug') worstLevel = 'info'
  }
  return { lineCount: lines.length, errorCount, warnCount, worstLevel }
}
