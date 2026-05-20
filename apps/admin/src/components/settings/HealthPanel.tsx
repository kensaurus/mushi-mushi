/**
 * FILE: apps/admin/src/components/settings/HealthPanel.tsx
 * PURPOSE: Live connection health, SDK endpoint reference, and a one-click
 *          pipeline smoke test that submits a synthetic report to verify the
 *          ingest path works end-to-end.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Section, Btn, ResultChip, type ResultChipTone } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { RESOLVED_API_URL } from '../../lib/env'
import { SdkInstallCard } from '../SdkInstallCard'
import { SettingsCard, SettingsPanelLayout } from './SettingsPanelLayout'

interface HealthPanelProps {
  projectId: string
  projectName?: string | null
}

export function HealthPanel({ projectId, projectName }: HealthPanelProps) {
  const project = { id: projectId, name: projectName ?? projectId }

  return (
    <SettingsPanelLayout
      fullWidth={
        <SettingsCard className="p-4">
          <ConnectionStatus />
        </SettingsCard>
      }
    >
      <Section title="SDK Configuration Reference">
        <p className="text-2xs text-fg-muted mb-2">Use these values when configuring the Mushi SDK in your app:</p>
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-fg-muted font-medium">API Endpoint</span>
            <code className="block text-xs font-mono text-fg-secondary bg-surface-raised px-2 py-1 rounded-sm mt-0.5 select-all break-all">
              {RESOLVED_API_URL}
            </code>
          </div>
        </div>
      </Section>

      <QuickTestSection project={project} />

      <Section title="Install the SDK" className="lg:col-span-2">
        <p className="text-2xs text-fg-muted mb-2">
          Per-framework <code className="font-mono">npm install</code> command and init snippet,
          pre-filled with this project&apos;s id.
        </p>
        <SdkInstallCard projectId={project.id} />
      </Section>
    </SettingsPanelLayout>
  )
}

interface QuickTestSectionProps {
  project: { id: string; name: string }
}

function QuickTestSection({ project }: QuickTestSectionProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [detail, setDetail] = useState('')
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)

  async function runTest() {
    setStatus('running')
    setDetail('')
    const res = await apiFetch<{ reportId: string; projectName: string }>(
      `/v1/admin/projects/${project.id}/test-report`,
      { method: 'POST' },
    )
    if (res.ok && res.data) {
      setStatus('pass')
      setDetail(`Report ${res.data.reportId} submitted to ${res.data.projectName}`)
    } else {
      setStatus('fail')
      setDetail(res.error?.message ?? 'Submission failed')
    }
    setLastRunAt(new Date().toISOString())
  }

  const chipTone: ResultChipTone =
    status === 'running' ? 'running' : status === 'pass' ? 'success' : status === 'fail' ? 'error' : 'idle'

  return (
    <Section title="Pipeline Quick Test">
      <p className="text-2xs text-fg-muted mb-2">
        Submit a test report to verify the ingest pipeline works end-to-end.
        Tests the project <span className="font-mono text-fg-secondary">{project.name}</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          variant="primary"
          onClick={runTest}
          loading={status === 'running'}
        >
          Send test report
        </Btn>
        {status !== 'idle' && (
          <ResultChip tone={chipTone} at={lastRunAt}>
            {detail || (status === 'running' ? 'Sending…' : 'Done')}
          </ResultChip>
        )}
      </div>
    </Section>
  )
}
