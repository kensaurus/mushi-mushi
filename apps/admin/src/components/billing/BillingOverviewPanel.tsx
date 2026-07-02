/**
 * Billing overview tab — project cards and connectivity diagnostics.
 */

import { Link } from 'react-router-dom'
import { Btn, EmptyState } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'
import { SdkConnectivityEmptyState } from '../SdkHealthSummary'
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
}: BillingOverviewPanelProps) {
  return (
    <>
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project from the Projects page to start tracking usage and billing."
          action={
            <Link to="/projects">
              <Btn size="sm">Go to Projects</Btn>
            </Link>
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
            />
          ))}
        </div>
      )}

      {activeProject &&
        (activeProject.usage?.reports ?? 0) === 0 &&
        setup.activeProject?.project_id === activeProject.project_id && (
          <SdkConnectivityEmptyState
            projectId={activeProject.project_id}
            projectName={activeProject.project_name}
            lastReportAt={null}
            diagnostic={setup.getStep('sdk_installed')?.diagnostic ?? null}
            adminHost={setup.data?.admin_endpoint_host ?? null}
            headline="Why this period reads 0"
            onTestReportSent={() => {
              setup.reload()
              onReload()
            }}
          />
        )}

      {activeProject && !setup.getStep('sentry_connected')?.complete && (
        <ContainedBlock tone="muted" className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg">Richer bug context with Sentry</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-fg-muted">
              Connect Sentry to pull stack traces, breadcrumbs, and Seer AI summaries directly into each triage diagnosis — so Cursor gets more context without you copying anything.
            </p>
          </div>
          <Link to="/integrations" className="shrink-0">
            <span className="text-2xs font-medium text-brand underline underline-offset-2">
              Connect →
            </span>
          </Link>
        </ContainedBlock>
      )}
    </>
  )
}
