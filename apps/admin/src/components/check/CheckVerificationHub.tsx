/**
 * FILE: apps/admin/src/components/check/CheckVerificationHub.tsx
 * PURPOSE: Verification hub landing at `/health?hub=check` — groups Check-stage
 *          tools into three progressive-disclosure buckets matching the Advanced
 *          sidebar sub-groups.
 *
 * OVERVIEW:
 * - SegmentedControl switches quality-gates / system-health / release-intel
 * - Each segment lists deep links from navRegistry (single source of truth)
 *
 * DEPENDENCIES: navRegistry, PageHeaderBar, ui primitives
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../PageHeaderBar'
import {
  CHECK_SUB_GROUPS,
  checkEntriesBySubGroup,
  type CheckSubGroupId,
} from '../../lib/navRegistry'
import { Card, SegmentedControl, Btn } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'

const SUB_GROUP_ORDER: CheckSubGroupId[] = [
  'quality-gates',
  'system-health',
  'release-intel',
]

export function CheckVerificationHub() {
  const [activeGroup, setActiveGroup] = useState<CheckSubGroupId>('quality-gates')

  const tabOptions = useMemo(
    () =>
      SUB_GROUP_ORDER.map((id) => ({
        id,
        label: CHECK_SUB_GROUPS[id].title,
      })),
    [],
  )

  const entries = useMemo(
    () => checkEntriesBySubGroup(activeGroup),
    [activeGroup],
  )

  const groupMeta = CHECK_SUB_GROUPS[activeGroup]

  return (
    <div className="space-y-4" data-testid="mushi-check-verification-hub">
      <PageHeaderBar
        title="Verification hub"
        description="Pick a verification lane — quality gates, system health, or release intel. Beginner mode shows Judge, Health, and QA Coverage in the sidebar; everything else lives here."
        helpTitle="About verification"
        helpWhatIsIt="A grouped index of Check-stage tools so you can verify fixes before merge without scanning twelve flat sidebar items."
        helpUseCases={[
          'After a fix PR: run Judge and QA Coverage from Quality gates',
          'Before release: scan Drift and Anomalies under System health',
          'Weekly ops: open Intelligence and Releases under Release & intel',
        ]}
        helpHowToUse="Choose a sub-group tab, then open the tool you need. For live LLM + cron telemetry, open System health → Health."
      >
        <Link to="/health">
          <Btn size="sm" variant="ghost">
            Open live health dashboard →
          </Btn>
        </Link>
      </PageHeaderBar>

      <SegmentedControl
        value={activeGroup}
        onChange={setActiveGroup}
        options={tabOptions}
        ariaLabel="Verification sub-groups"
        size="sm"
      />

      <p className="text-xs text-fg-muted">{groupMeta.hint}</p>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              to={entry.path}
              className="block rounded-lg border border-edge bg-surface-raised p-4 motion-safe:transition-colors hover:border-brand/40 hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="text-sm font-semibold text-fg">{entry.label}</span>
              <span className="mt-1 block text-2xs leading-relaxed text-fg-muted">
                {entry.paletteDescription}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {activeGroup === 'system-health' ? (
        <Card className="p-4">
          <p className="text-xs text-fg-muted">
            Need LLM call rates, cron job status, and provider probes?{' '}
            <Link to="/health" className={LINK_ACCENT}>
              Open the Health dashboard →
            </Link>
          </p>
        </Card>
      ) : null}
    </div>
  )
}
