import { Badge, DefinitionChips, LongFormText } from '../ui'
import { categoryBadge, categoryLabel } from '../../lib/tokens'
import { IconUser } from '../icons'
import { EmptySectionMessage } from './ReportClassification'
import { ContainedBlock } from './ReportSurface'
import type { ReportDetail } from './types'

/** User-submitted copy — description and intent in bordered blocks. */
export function UserReportFields({ report }: { report: ReportDetail }) {
  return (
    <div className="space-y-2.5">
      {report.user_category && (
        <DefinitionChips
          dense
          columns={1}
          className="mb-0"
          items={[
            {
              label: 'User category',
              hint: 'What the reporter said the issue was about, before LLM classification.',
              value: (
                <Badge className={categoryBadge(report.user_category)}>
                  {categoryLabel(report.user_category)}
                </Badge>
              ),
            },
          ]}
        />
      )}

      <ContainedBlock label="Description" tone="neutral">
        <div className="flex items-start gap-1.5">
          <IconUser className="mt-0.5 shrink-0 text-fg-faint" />
          <LongFormText value={report.description} maxWidth="max-w-none" />
        </div>
      </ContainedBlock>

      {report.user_intent && (
        <ContainedBlock label="User intent" tone="muted">
          <LongFormText value={report.user_intent} tone="muted" maxWidth="max-w-none" />
        </ContainedBlock>
      )}

      {!report.screenshot_url && (
        <EmptySectionMessage
          text="No screenshot was captured for this report."
          hint="Reporters must tap the camera button in the widget before submitting."
        />
      )}
    </div>
  )
}
