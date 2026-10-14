/**
 * FILE: apps/admin/src/components/check/CheckVerificationHub.tsx
 * PURPOSE: Verification hub landing at `/health?hub=check` — groups the
 *          4 · Verify tools into the two buckets of the Advanced sidebar
 *          (App checks, AI quality).
 *
 * OVERVIEW:
 * - SegmentedControl switches system-health / quality-gates
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

// Same order as the sidebar: verify the app, then the AI that triaged it.
const SUB_GROUP_ORDER: CheckSubGroupId[] = ['system-health', 'quality-gates']

export function CheckVerificationHub() {
  const [activeGroup, setActiveGroup] = useState<CheckSubGroupId>('system-health')

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
        description="Pick a lane — App checks or AI quality. Beginner mode shows Scheduled tests and Triage grading in the sidebar; everything else lives here."
        helpTitle="About verification"
        helpWhatIsIt="A grouped index of the 4 · Verify tools, so you can prove a fix works before you ship it without scanning a long flat list."
        helpUseCases={[
          'After a fix PR: run Scheduled tests and the Full-stack audit from App checks',
          'Before release: open App health for schema changes and unusual spikes',
          'Weekly: check Triage grading and Lessons under AI quality',
        ]}
        helpHowToUse="Choose a tab, then open the tool you need. For live AI-call and job telemetry, open App checks → App health."
      >
        <Btn to="/health" size="sm" variant="ghost">
            Open live health dashboard →
          </Btn>
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
              className="block rounded-lg border border-edge bg-surface-raised p-4 motion-safe:transition-opacity hover:border-brand/40 hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
