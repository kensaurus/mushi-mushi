import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import { QUERY_EXPLAINER_SUMMARY, QUERY_MODES, isQueryGuideExpanded } from '../../lib/queryExplainer'

interface Props {
  errors24h?: number
}

export function QueryGuide({ errors24h = 0 }: Props) {
  return (
    <FeatureExplainPanel
      title="NL vs raw SQL — how Ask Your Data works"
      summary={QUERY_EXPLAINER_SUMMARY}
      defaultOpen={isQueryGuideExpanded(errors24h)}
    >
      <div className="space-y-1">
        {QUERY_MODES.map((mode) => (
          <WorkflowStageRow
            key={mode.id}
            id={mode.id}
            shortLabel={mode.label}
            posture="info"
            plain={mode.plain}
            actionLine={`Red means: ${mode.redMeans}`}
          />
        ))}
      </div>
    </FeatureExplainPanel>
  )
}
