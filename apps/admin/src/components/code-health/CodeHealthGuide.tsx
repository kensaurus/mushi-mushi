/**
 * Visible bundle / god-file code health guide.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  CODE_HEALTH_EXPLAINER_SUMMARY,
  CODE_HEALTH_METRIC_DEFINITIONS,
  isCodeHealthGuideExpanded,
} from '../../lib/codeHealthExplainer'
import { codeHealthMetricOverlay } from '../../lib/guideLiveOverlay'
import type { CodeHealthStats, CodeHealthTopPriority } from './CodeHealthStatsTypes'

interface Props {
  topPriority?: CodeHealthTopPriority
  stats?: Pick<CodeHealthStats, 'errorCount' | 'warnCount' | 'hasRun' | 'topPriority'>
}

/**
 * Exported for tests. A size metric with nothing measured yet: grey "No data", never a green
 * "Within budget" or an amber chip under "No code size data yet" (2026-11-18). The ingest key
 * row keeps its amber "Not wired": that one is a setup step to do.
 */
export function isCodeHealthMetricUnmeasured(metricId: string, live: Pick<CodeHealthStats, 'hasRun'>): boolean {
  return !live.hasRun && (metricId === 'bundle' || metricId === 'god_file')
}

/** The same row shape as WorkflowStageRow, in neutral grey: nothing measured, nothing to judge. */
function NoDataRow({ label, plain, source }: { label: string; plain?: string; source: string }) {
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised px-2.5 py-2" data-testid="code-health-no-data-row">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <span className="shrink-0 rounded-sm border border-edge-subtle px-1.5 py-0.5 text-3xs font-semibold whitespace-nowrap text-fg-muted">No data</span>
      </div>
      {plain && <p className="mt-0.5 text-2xs text-fg-secondary">{plain}</p>}
      <p className="mt-0.5 text-2xs text-fg-muted">Source: {source}</p>
    </div>
  )
}

export function CodeHealthGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    errorCount: 0,
    warnCount: 0,
    hasRun: false,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="Bundle size and god files explained"
      summary={CODE_HEALTH_EXPLAINER_SUMMARY}
      defaultOpen={isCodeHealthGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {CODE_HEALTH_METRIC_DEFINITIONS.map((metric) => {
          if (isCodeHealthMetricUnmeasured(metric.id, live)) {
            return <NoDataRow key={metric.id} label={metric.label} plain={metric.plain} source={metric.source} />
          }
          const overlay = codeHealthMetricOverlay(metric.id, live)
          return (
            <WorkflowStageRow
              key={metric.id}
              id={metric.id}
              shortLabel={metric.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={metric.plain}
              actionLine={overlay.actionLine ?? `Source: ${metric.source}`}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        Pair with{' '}
        <Link to="/fullstack-audit" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Full-Stack Audit
        </Link>{' '}
        for backend schema and RLS checks.
      </p>
    </FeatureExplainPanel>
  )
}
