/**
 * FILE: apps/admin/src/components/dashboard/GettingStartedEmpty.tsx
 * PURPOSE: First-run dashboard. Shown when the user has no projects (we send
 *          them straight to the onboarding wizard) or has projects but no
 *          inbound reports yet (we frame their first PDCA loop with three
 *          stages — Plan / Do / Check — so they immediately see the loop the
 *          README promises instead of an empty grid).
 *
 *          Reuses the canonical <SetupChecklist> primitive in banner mode so
 *          checklist progress stays in lock-step with the wizard.
 */

import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useSetupStatus, type SetupProject } from '../../lib/useSetupStatus'
import { pluralize } from '../../lib/format'
import { PageHeader, Card, Btn, Loading } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { SetupChecklist } from '../SetupChecklist'

type LoopStageId = 'plan' | 'do' | 'check'

interface LoopStage {
  id: LoopStageId
  letter: string
  label: string
  headline: string
  body: string
  cta: { to?: string; onClick?: () => void; label: string; primary?: boolean }
  state: 'active' | 'next' | 'done'
}

export function GettingStartedEmpty() {
  const navigate = useNavigate()
  const toast = useToast()
  const setup = useSetupStatus()
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  if (setup.loading) return <Loading text="Checking your account..." />
  if (!setup.hasAnyProject) return <Navigate to="/onboarding" replace />

  const project = setup.activeProject
  if (!project) return <Loading text="Loading projects..." />

  const sdkInstalled = !setup.isStepIncomplete('sdk_installed')
  const hasReports = project.report_count > 0
  const hasFix = project.fix_count > 0

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

  const stages: LoopStage[] = buildStages({
    project,
    sdkInstalled,
    hasReports,
    hasFix,
    onSendTest: submitTest,
    testStatus,
    onSetup: () => navigate('/onboarding'),
  })

  return (
    <div>
      <PageHeader
        title="Welcome to Mushi Mushi"
        description="Run your first user-felt-bug PDCA loop in three stages."
      />

      <SetupChecklist project={project} mode="banner" onRefresh={setup.reload} />

      <FirstLoopPanel stages={stages} project={project} />

      <Card className="p-3 mt-4">
        <ConnectionStatus />
      </Card>

      <div className="mt-4 text-2xs text-fg-faint flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Active project: <span className="font-mono text-fg-secondary">{project.project_name}</span>
        </span>
        <span>
          {project.report_count} {pluralize(project.report_count, 'report')} · {project.fix_count} {pluralize(project.fix_count, 'fix', 'fixes')} dispatched
        </span>
        <Link to="/projects" className="text-brand hover:underline">Switch project →</Link>
      </div>
    </div>
  )
}

interface BuildStageArgs {
  project: SetupProject
  sdkInstalled: boolean
  hasReports: boolean
  hasFix: boolean
  onSendTest: () => void
  testStatus: 'idle' | 'running' | 'pass' | 'fail'
  onSetup: () => void
}

function buildStages(args: BuildStageArgs): LoopStage[] {
  const { sdkInstalled, hasReports, hasFix, onSendTest, testStatus, onSetup } = args

  // Stage rules:
  //  - "active" = the next thing the user should actually do
  //  - "done"   = already verifiably finished
  //  - "next"   = locked behind a previous active stage
  return [
    {
      id: 'plan',
      letter: 'P',
      label: 'Plan',
      headline: 'Capture your first user-felt bug',
      body: sdkInstalled
        ? 'SDK is installed. Send a synthetic test report or wait for a real one to land in Reports.'
        : 'Drop the Mushi Mushi widget into your app so end-users can flag bugs without opening DevTools.',
      cta: sdkInstalled
        ? { onClick: onSendTest, label: testStatus === 'running' ? 'Sending…' : testStatus === 'pass' ? '✓ Test sent' : 'Send test report', primary: testStatus !== 'pass' }
        : { onClick: onSetup, label: 'Open setup wizard', primary: true },
      state: hasReports ? 'done' : 'active',
    },
    {
      id: 'do',
      letter: 'D',
      label: 'Do',
      headline: 'Dispatch a fix',
      body: hasReports
        ? 'Open the latest report, classify it if needed, then click "Dispatch fix" to let the agent draft a PR on a feature branch.'
        : 'Once your first report lands, you\u2019ll dispatch the auto-fix agent here. It needs a GitHub repo + an Anthropic key in BYOK.',
      cta: hasReports
        ? { to: '/reports', label: 'Open Reports', primary: true }
        : { to: '/integrations', label: 'Connect GitHub & Anthropic', primary: false },
      state: hasFix ? 'done' : hasReports ? 'active' : 'next',
    },
    {
      id: 'check',
      letter: 'C',
      label: 'Check',
      headline: 'Verify the loop',
      body: hasFix
        ? 'A draft PR has been opened. Review the agent\u2019s rationale + diff in /fixes, then merge — the loop is closed.'
        : 'Watch the dispatched fix progress through Plan → Do → Check on the /fixes timeline. Each step writes a Langfuse trace.',
      cta: { to: '/fixes', label: 'Open Fixes', primary: hasFix },
      state: hasFix ? 'done' : hasReports ? 'next' : 'next',
    },
  ]
}

interface PanelProps {
  stages: LoopStage[]
  project: SetupProject
}

function FirstLoopPanel({ stages, project }: PanelProps) {
  const completedCount = stages.filter(s => s.state === 'done').length
  const allDone = completedCount === stages.length
  return (
    <section aria-label="Your first PDCA loop" className="rounded-lg border border-edge-subtle bg-surface-raised/30 p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-fg">Your first PDCA loop</h2>
          <p className="text-2xs text-fg-muted mt-0.5">
            {allDone
              ? 'Loop closed. You\u2019ve shipped your first auto-fix on this project.'
              : `Stage ${completedCount + 1} of ${stages.length} · finish each step to close the loop on ${project.project_name}.`}
          </p>
        </div>
        <Link to="/onboarding" className="text-2xs text-brand hover:underline">
          Open full setup guide →
        </Link>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {stages.map((stage, i) => (
          <LoopStageCard key={stage.id} stage={stage} step={i + 1} />
        ))}
      </ol>
    </section>
  )
}

function LoopStageCard({ stage, step }: { stage: LoopStage; step: number }) {
  const tone = stage.state === 'done'
    ? { ring: 'ring-1 ring-ok/30 bg-ok-muted/10', letter: 'bg-ok text-ok-fg' }
    : stage.state === 'active'
      ? { ring: 'ring-2 ring-brand/40 bg-brand/5', letter: 'bg-brand text-brand-fg' }
      : { ring: 'ring-1 ring-edge-subtle bg-surface-raised/30', letter: 'bg-surface-overlay text-fg-muted' }

  const isLocked = stage.state === 'next'
  const cta = stage.cta

  return (
    <li className={`relative rounded-md p-3 ${tone.ring} ${isLocked ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md font-bold text-xs leading-none ${tone.letter}`}>
          {stage.state === 'done' ? '✓' : stage.letter}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-2xs uppercase tracking-wider text-fg-muted">Step {step} · {stage.label}</span>
          <h3 className="text-xs font-semibold text-fg truncate">{stage.headline}</h3>
        </div>
      </div>
      <p className="text-2xs text-fg-secondary leading-snug min-h-[3rem]">{stage.body}</p>
      <div className="mt-2.5">
        {cta.to ? (
          <Link
            to={cta.to}
            className={cta.primary
              ? 'inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors'
              : 'inline-flex items-center gap-1 text-xs text-brand hover:underline'
            }
            aria-disabled={isLocked}
            tabIndex={isLocked ? -1 : 0}
          >
            {cta.label} {cta.primary && <span aria-hidden="true">→</span>}
          </Link>
        ) : (
          <Btn
            size="sm"
            variant={cta.primary ? 'primary' : 'ghost'}
            onClick={cta.onClick}
            disabled={isLocked}
          >
            {cta.label}
          </Btn>
        )}
      </div>
    </li>
  )
}
