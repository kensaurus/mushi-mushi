/**
 * FILE: apps/admin/src/components/settings/HealthPanel.tsx
 * PURPOSE: Live connection health, SDK endpoint reference, and a one-click
 *          pipeline smoke test that submits a synthetic report to verify the
 *          ingest path works end-to-end.
 */

import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Section, Btn, Card, ResultChip, type ResultChipTone } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { RESOLVED_API_URL } from '../../lib/env'

interface TestProject {
  id: string
  name: string
}

export function HealthPanel() {
  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4">
        <ConnectionStatus />
      </Card>

      <Section title="SDK Configuration Reference">
        <p className="text-2xs text-fg-muted mb-2">Use these values when configuring the Mushi SDK in your app:</p>
        <div className="space-y-1.5">
          <div>
            <span className="text-xs text-fg-muted font-medium">API Endpoint</span>
            <code className="block text-xs font-mono text-fg-secondary bg-surface-raised px-2 py-1 rounded-sm mt-0.5 select-all">
              {RESOLVED_API_URL}
            </code>
          </div>
        </div>
      </Section>

      <QuickTestSection />
    </div>
  )
}

function QuickTestSection() {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [detail, setDetail] = useState('')
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [project, setProject] = useState<TestProject | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)

  // The pipeline test runs against the user's first project. We don't render a
  // picker because the test is a smoke check — owners with multiple projects
  // can rerun against a specific one from that project's settings later.
  useEffect(() => {
    apiFetch<{ projects: TestProject[] }>('/v1/admin/projects')
      .then((res) => {
        if (res.ok && res.data) setProject(res.data.projects?.[0] ?? null)
      })
      .finally(() => setProjectLoading(false))
  }, [])

  async function runTest() {
    if (!project) return
    setStatus('running')
    setDetail('')
    // Uses the JWT-authenticated admin endpoint instead of /v1/reports — that
    // one requires X-Mushi-Api-Key, which the admin has no plaintext access to
    // (keys are SHA-256 hashed at rest).
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
        {project && <> Tests the project <span className="font-mono text-fg-secondary">{project.name}</span>.</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          variant="primary"
          onClick={runTest}
          loading={status === 'running'}
          disabled={projectLoading || !project}
        >
          Send test report
        </Btn>
        {!projectLoading && !project && (
          <span className="text-2xs text-fg-muted">Create a project first to run this test.</span>
        )}
        {status !== 'idle' && (
          <ResultChip tone={chipTone} at={lastRunAt}>
            {detail || (status === 'running' ? 'Sending…' : 'Done')}
          </ResultChip>
        )}
      </div>
    </Section>
  )
}
