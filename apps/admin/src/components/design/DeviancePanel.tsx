/**
 * FILE: apps/admin/src/components/design/DeviancePanel.tsx
 * PURPOSE: Everything about "how far the code is from its design system":
 *          score card, per-rule breakdown, score trend (unscored runs are
 *          dropped, never drawn as 0), top findings with the suggested token,
 *          and the "Run deviance check" action.
 */

import { BarSparkline } from '../charts'
import { formatChartDayLabel } from '../charts/chartAxis'
import { Badge, Btn, Callout, DataTableCell, DataTableHead, Section, formatRelative } from '../ui'
import type {
  DesignPlaneResponse,
  DevianceBreakdownEntry,
  DevianceFinding,
  DevianceRunStatus,
  DevianceSuggestion,
} from '../../lib/recipeTypes'
import { DevianceScoreCard } from './DevianceScoreCard'
import { ruleLabel } from './designTokens'

function SeverityBadge({ severity }: { severity: unknown }) {
  if (severity === 'error') return <Badge tone="dangerSubtle">Error</Badge>
  if (severity === 'warn') return <Badge tone="warnSubtle">Warn</Badge>
  return <Badge tone="neutral">Info</Badge>
}

function Breakdown({ rows }: { rows: DevianceBreakdownEntry[] }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">No rule breakdown for this run.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-120 text-xs">
        <thead>
          <tr>
            <DataTableHead>Rule</DataTableHead>
            <DataTableHead>Enabled</DataTableHead>
            <DataTableHead>Severity</DataTableHead>
            <DataTableHead align="right">Count</DataTableHead>
            <DataTableHead align="right">Density</DataTableHead>
            <DataTableHead align="right">Penalty</DataTableHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.rule} className="border-t border-edge-subtle">
              <DataTableCell>
                <span className="text-fg">{ruleLabel(b.rule)}</span>
                {!b.applicable && <span className="ml-1 text-2xs text-fg-faint">(nothing to judge)</span>}
              </DataTableCell>
              <DataTableCell>{b.enabled ? 'Yes' : 'No'}</DataTableCell>
              <DataTableCell>
                <SeverityBadge severity={b.severity} />
              </DataTableCell>
              <DataTableCell align="right">
                <span className="tabular-nums">{b.count.toLocaleString()}</span>
              </DataTableCell>
              <DataTableCell align="right">
                <span className="tabular-nums">{b.density === null ? '—' : b.density.toFixed(2)}</span>
              </DataTableCell>
              <DataTableCell align="right">
                <span className="tabular-nums">{Math.round(b.penalty * 100)}%</span>
              </DataTableCell>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-2xs text-fg-faint">
        Density is findings per 1,000 scanned lines (for contrast: the failing share of pairs).
      </p>
    </div>
  )
}

function Trend({ trend }: { trend: Array<{ at: string; score: number | null; status: DevianceRunStatus }> }) {
  const scored = trend.filter((t): t is typeof t & { score: number } => typeof t.score === 'number')
  const omitted = trend.length - scored.length
  if (scored.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No scored runs yet{omitted > 0 ? ` (${omitted} run${omitted === 1 ? '' : 's'} could not be scored)` : ''}.
      </p>
    )
  }
  const values = scored.map((t) => t.score)
  const timestamps = scored.map((t) => t.at)
  const xLabels = timestamps.map((ts) => formatChartDayLabel(ts.slice(0, 10)))
  return (
    <div className="flex flex-col gap-1">
      <BarSparkline
        values={values}
        timestamps={timestamps}
        xLabels={xLabels}
        barTitles={xLabels.map((l, i) => `${l}: score ${Math.round(values[i] ?? 0)}`)}
        height={64}
        accent="bg-brand"
        showAxes
        yAxisCaption="score"
        ariaLabel="Deviance score per run, lower is better"
      />
      <p className="text-2xs text-fg-faint">
        Lower is better.{omitted > 0 ? ` ${omitted} unscored run${omitted === 1 ? ' is' : 's are'} left out.` : ''}
      </p>
    </div>
  )
}

function Suggestion({ suggestion }: { suggestion: DevianceSuggestion }) {
  return (
    <p className="text-2xs text-fg-muted">
      Use <span className="font-mono text-fg">{suggestion.token}</span>
      {suggestion.cssVar && (
        <>
          {' '}
          (<span className="font-mono">{suggestion.cssVar}</span>)
        </>
      )}{' '}
      = <span className="font-mono">{suggestion.value}</span>
    </p>
  )
}

function Findings({ findings }: { findings: DevianceFinding[] }) {
  if (findings.length === 0) return <p className="text-xs text-fg-muted">No open findings in the latest scan.</p>
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <li key={f.id ?? `${f.rule_id}:${f.file_path}:${f.line}:${i}`} className="flex flex-col gap-1 border-b border-edge-subtle pb-2 last:border-b-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SeverityBadge severity={f.severity} />
            <span className="text-fg">{ruleLabel(f.rule_id)}</span>
            <span className="font-mono text-2xs text-fg-secondary wrap-break-word">
              {f.file_path ?? '(unknown file)'}
              {f.line !== null ? `:${f.line}` : ''}
            </span>
          </div>
          <p className="text-xs text-fg-secondary">
            <span className="font-mono text-fg">{f.value}</span> — {f.message}
          </p>
          {f.suggestion && <Suggestion suggestion={f.suggestion} />}
        </li>
      ))}
    </ul>
  )
}

export type DevianceRunNotice = { tone: 'info' | 'warn' | 'danger'; text: string } | null

interface DeviancePanelProps {
  deviance: DesignPlaneResponse['deviance']
  running: boolean
  /** startedAt of the background scan being followed, if any. */
  runningSince: string | null
  notice: DevianceRunNotice
  onRun: () => void
}

export function DeviancePanel({ deviance, running, runningSince, notice, onRun }: DeviancePanelProps) {
  const run = deviance.latest
  const since = runningSince ? new Date(runningSince) : null
  const sinceText = since && !Number.isNaN(since.getTime()) ? formatRelative(since) : null
  return (
    <Section
      title="Deviance"
      action={
        <Btn
          size="sm"
          variant="ghost"
          onClick={onRun}
          loading={running}
          disabled={running}
          title={running ? 'A scan is already running' : 'Refresh tokens, then scan the repo for off-system values'}
        >
          Run deviance check
        </Btn>
      }
    >
      <div className="flex flex-col gap-4">
        {running && (
          <p className="text-xs text-fg-muted" role="status">
            {runningSince
              ? `Scanning in the background${sinceText ? ` (started ${sinceText})` : ''}. Results appear here when it finishes; you can keep working.`
              : 'Refreshing tokens, then starting the scan…'}
          </p>
        )}
        {notice && (
          <Callout tone={notice.tone}>
            <span role="status" className="text-xs">
              {notice.text}
            </span>
          </Callout>
        )}
        <DevianceScoreCard run={run} />
        {run && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-fg-secondary">Per-rule breakdown</h3>
            <Breakdown rows={run.breakdown} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-fg-secondary">Trend</h3>
          <Trend trend={deviance.trend} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-fg-secondary">Top findings</h3>
          <Findings findings={deviance.topFindings} />
        </div>
      </div>
    </Section>
  )
}
