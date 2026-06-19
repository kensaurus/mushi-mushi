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
import type { CodeHealthTopPriority } from './CodeHealthStatsTypes'

interface Props {
  topPriority?: CodeHealthTopPriority
}

export function CodeHealthGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="Bundle size and god files explained"
      summary={CODE_HEALTH_EXPLAINER_SUMMARY}
      defaultOpen={isCodeHealthGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {CODE_HEALTH_METRIC_DEFINITIONS.map((metric) => (
          <WorkflowStageRow
            key={metric.id}
            id={metric.id}
            shortLabel={metric.label}
            posture="info"
            plain={metric.plain}
            actionLine={`Source: ${metric.source}`}
          />
        ))}
      </div>
      <p className="text-2xs text-fg-faint">
        Pair with{' '}
        <Link to="/fullstack-audit" className="text-brand hover:underline">
          Full-Stack Audit
        </Link>{' '}
        for backend schema and RLS checks.
      </p>
    </FeatureExplainPanel>
  )
}
