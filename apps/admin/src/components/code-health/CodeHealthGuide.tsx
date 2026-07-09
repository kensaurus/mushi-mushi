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
        <Link to="/fullstack-audit" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          Full-Stack Audit
        </Link>{' '}
        for backend schema and RLS checks.
      </p>
    </FeatureExplainPanel>
  )
}
