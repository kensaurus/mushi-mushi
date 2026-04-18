/**
 * FILE: apps/admin/src/components/dashboard/GettingStartedEmpty.tsx
 * PURPOSE: Dashboard fallback for accounts that have no projects (route to
 *          /onboarding) or have a project but haven't completed setup
 *          (inline checklist + install/test cards).
 */

import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useSetupStatus } from '../../lib/useSetupStatus'
import { PageHeader, Card, Btn, Loading } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { SetupChecklist } from '../SetupChecklist'

export function GettingStartedEmpty() {
  const navigate = useNavigate()
  const toast = useToast()
  const setup = useSetupStatus()
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  if (setup.loading) return <Loading text="Checking your account..." />

  // First-time visitors with no project at all are sent to the wizard. Once at
  // least one project + key exists, the dashboard takes over and the redirect
  // stops happening — the SetupChecklist banner finishes the journey inline.
  if (!setup.hasAnyProject) return <Navigate to="/onboarding" replace />

  const project = setup.activeProject
  if (!project) return <Loading text="Loading projects..." />

  async function submitTest() {
    if (!project) return
    setTestStatus('running')
    const res = await apiFetch(`/v1/admin/projects/${project.project_id}/test-report`, {
      method: 'POST',
    })
    setTestStatus(res.ok ? 'pass' : 'fail')
    if (res.ok) {
      toast.success('Test report queued', 'Watch it land in Reports within a few seconds.')
      setup.reload()
    } else {
      toast.error('Test report failed', res.error?.message ?? 'Check your project keys and try again.')
    }
  }

  const hasKey = !setup.isStepIncomplete('api_key_generated')

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Welcome to Mushi Mushi. Finish setup to start receiving reports."
      />
      <SetupChecklist project={project} mode="banner" onRefresh={setup.reload} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Install the SDK</h4>
          <p className="text-2xs text-fg-muted mb-3">
            Add the Mushi Mushi widget to your app in under 5 minutes.
          </p>
          <Btn size="sm" onClick={() => navigate('/onboarding')}>
            Setup guide
          </Btn>
        </Card>
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-fg mb-1">Submit a test report</h4>
          <p className="text-2xs text-fg-muted mb-3">
            Send a test report to verify your pipeline works end-to-end.
          </p>
          <Btn
            size="sm"
            variant={testStatus === 'pass' ? 'ghost' : 'primary'}
            disabled={!hasKey || testStatus === 'running'}
            onClick={submitTest}
          >
            {testStatus === 'running' ? 'Sending…' : testStatus === 'pass' ? '✓ Sent' : 'Send test report'}
          </Btn>
          {testStatus === 'fail' && <p className="text-2xs text-danger mt-1">Failed — check connection.</p>}
        </Card>
      </div>
      <Card className="p-4">
        <ConnectionStatus />
      </Card>
      <div className="mt-4 text-2xs text-fg-faint space-y-0.5">
        <p>
          Project: <span className="font-mono text-fg-secondary">{project.project_name}</span>{' '}
          <span className="font-mono">({project.project_id})</span>
        </p>
        <p>
          {project.report_count} report{project.report_count === 1 ? '' : 's'} · {project.fix_count} fix
          {project.fix_count === 1 ? '' : 'es'} dispatched
        </p>
      </div>
    </div>
  )
}
