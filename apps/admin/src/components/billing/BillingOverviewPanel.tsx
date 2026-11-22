/**
 * Billing overview tab — project cards (SDK check-in lives on Connect → SDK health).
 */

import { Link } from 'react-router-dom'
import { Btn, EmptyState } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'
import { ProjectBillingCard } from './ProjectBillingCard'
import type { BillingProject, PlanCatalog } from './types'
import type { useSetupStatus } from '../../lib/useSetupStatus'

export interface BillingOverviewPanelProps {
  projects: BillingProject[]
  plans: PlanCatalog[]
  actioning: string | null
  pickerFor: string | null
  onTogglePicker: (projectId: string) => void
  onPickPlan: (projectId: string, planId: string, billingInterval: 'monthly' | 'annual') => void
  onManage: (projectId: string) => void
  onReload: () => void
  activeProject: BillingProject | null
  setup: ReturnType<typeof useSetupStatus>
  /** The team meters are on the page: cards skip their quota meter. */
  quotaInStrip?: boolean
  /** The Seats meter's limit (members stats), for each card's entitlements. */
  seatLimit?: number | null
  seatLimitKnown?: boolean
}

export function BillingOverviewPanel({
  projects,
  plans,
  actioning,
  pickerFor,
  onTogglePicker,
  onPickPlan,
  onManage,
  onReload,
  activeProject,
  setup,
  quotaInStrip = false,
  seatLimit = null,
  seatLimitKnown = false,
}: BillingOverviewPanelProps) {
  return (
    <>
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project from the Projects page to start tracking usage and billing."
          action={
            <Btn to="/projects" size="sm">Go to Projects</Btn>
          }
        />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectBillingCard
              key={p.project_id}
              project={p}
              plans={plans}
              actioning={actioning}
              pickerOpen={pickerFor === p.project_id}
              onTogglePicker={() => onTogglePicker(p.project_id)}
              onPickPlan={(planId: string, billingInterval: 'monthly' | 'annual') =>
                onPickPlan(p.project_id, planId, billingInterval)
              }
              onManage={() => onManage(p.project_id)}
              onReload={onReload}
              quotaInStrip={quotaInStrip}
              seatLimit={seatLimit}
              seatLimitKnown={seatLimitKnown}
            />
          ))}
        </div>
      )}

      {/* The SDK connectivity panel ("App has not checked in recently ·
          Stale", amber, while it said "Normal for low-traffic apps") is not
          a billing fact: Connect → SDK health shows check-in state, and the
          app card links there when the app sent no reports (review 2026-11-18). */}

      {activeProject && !setup.getStep('sentry_connected')?.complete && (
        <ContainedBlock tone="muted" className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg">Richer bug context with Sentry</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-fg-muted">
              Connect Sentry to pull stack traces, breadcrumbs, and Seer AI summaries directly into each triage diagnosis — so Cursor gets more context without you copying anything.
            </p>
          </div>
          <Link to="/integrations/config" className="shrink-0">
            <span className="text-2xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity underline-offset-2">
              Connect →
            </span>
          </Link>
        </ContainedBlock>
      )}
    </>
  )
}
