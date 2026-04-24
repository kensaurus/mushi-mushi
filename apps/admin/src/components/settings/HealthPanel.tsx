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
import { SdkInstallCard } from '../SdkInstallCard'

interface TestProject {
  id: string
  name: string
}

export function HealthPanel() {
  // Fetch the first project once at the panel level so both the SDK install
  // snippet and the smoke-test button share a single round trip and stay in
  // sync (you'd be surprised how often two near-identical components on the
  // same page would otherwise show different "active project" values for a
  // few hundred ms after a switch).
  const [project, setProject] = useState<TestProject | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)

  useEffect(() => {
    apiFetch<{ projects: TestProject[] }>('/v1/admin/projects')
      .then((res) => {
        if (res.ok && res.data) setProject(res.data.projects?.[0] ?? null)
      })
      .finally(() => setProjectLoading(false))
  }, [])

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

      <Section title="Install the SDK">
        <p className="text-2xs text-fg-muted mb-2">
          Per-framework <code className="font-mono">npm install</code> command and init snippet,
          pre-filled with this project's id.
        </p>
        {project ? (
          <SdkInstallCard projectId={project.id} />
        ) : projectLoading ? (
          <p className="text-2xs text-fg-faint">Loading project…</p>
        ) : (
          <p className="text-2xs text-fg-faint">Create a project first to see install snippets.</p>
        )}
      </Section>

      <QuickTestSection project={project} projectLoading={projectLoading} />
    </div>
  )
}

interface QuickTestSectionProps {
  project: TestProject | null
  projectLoading: boolean
}

function QuickTestSection({ project, projectLoading }: QuickTestSectionProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [detail, setDetail] = useState('')
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)

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
