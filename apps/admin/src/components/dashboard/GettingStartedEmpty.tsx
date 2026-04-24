/**
 * FILE: apps/admin/src/components/dashboard/GettingStartedEmpty.tsx
 * PURPOSE: First-run dashboard. Shown when the user has no projects (we send
 *          them straight to the onboarding wizard) or has projects but no
 *          inbound reports yet (we frame their first PDCA loop with FOUR
 *          stages — Plan / Do / Check / Act — so the model the user sees
 *          here matches the cockpit, sidebar, narrative strip, and live
 *          pipeline diagram everywhere else in the app).
 *
 * unified to 4 stages (was 3) and pulls outcome copy from
 *          `lib/pdca.ts > PDCA_STAGE_OUTCOMES` so a future wording change
 *          updates first-run, cockpit, and pipeline in lock-step.
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
import { PDCA_STAGES, PDCA_ORDER, PDCA_STAGE_OUTCOMES, type PdcaStageId } from '../../lib/pdca'
import { PageHeader, Card, Btn, Skeleton } from '../ui'
import { ConnectionStatus } from '../ConnectionStatus'
import { SetupChecklist } from '../SetupChecklist'
import { useActiveProjectId } from '../ProjectSwitcher'

interface LoopStage {
  id: PdcaStageId
  cta: { to?: string; onClick?: () => void; label: string; primary?: boolean }
  state: 'active' | 'next' | 'done'
  /** Per-stage status line under the body — what's currently happening. */
  status?: string
}

export function GettingStartedEmpty() {
  const navigate = useNavigate()
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  if (setup.loading) return <GettingStartedSkeleton />
  if (!setup.hasAnyProject) return <Navigate to="/onboarding" replace />

  const project = setup.activeProject
  if (!project) return <GettingStartedSkeleton />

  const sdkInstalled = !setup.isStepIncomplete('sdk_installed')
  const hasReports = project.report_count > 0
  const hasFix = project.fix_count > 0
  const hasMerged = project.merged_fix_count > 0

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
    hasMerged,
    onSendTest: submitTest,
    testStatus,
    onSetup: () => navigate('/onboarding'),
  })

  return (
    <div>
      <PageHeader
        title="Welcome to Mushi Mushi"
        description="Run your first user-felt-bug PDCA loop. Four stages, one closed loop."
      />

      <SetupChecklist project={project} mode="banner" onRefresh={setup.reload} />

      <FirstLoopPanel stages={stages} project={project} />

      <Card className="p-3 mt-4">
        <ConnectionStatus />
      </Card>

      <div className="mt-4 text-2xs text-fg-faint flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Viewing: <span className="font-mono text-fg-secondary">{project.project_name}</span>
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
  hasMerged: boolean
  onSendTest: () => void
  testStatus: 'idle' | 'running' | 'pass' | 'fail'
  onSetup: () => void
}

function buildStages(args: BuildStageArgs): LoopStage[] {
  const { sdkInstalled, hasReports, hasFix, hasMerged, onSendTest, testStatus, onSetup } = args

  // Stage rules:
  //  - "active" = the next thing the user should actually do
  //  - "done"   = already verifiably finished
  //  - "next"   = locked behind a previous active stage
  return [
    {
      id: 'plan',
      cta: sdkInstalled
        ? {
            onClick: onSendTest,
            label:
              testStatus === 'running' ? 'Sending…' :
              testStatus === 'pass' ? '✓ Test sent' :
              testStatus === 'fail' ? 'Retry test' :
              'Send test report',
            primary: testStatus !== 'pass',
          }
        : { onClick: onSetup, label: 'Open setup wizard', primary: true },
      state: hasReports ? 'done' : 'active',
      status: sdkInstalled
        ? 'SDK is connected — fire a synthetic report or wait for a real one.'
        : 'Drop the Mushi widget into your app so end-users can flag bugs without DevTools.',
    },
    {
      id: 'do',
      cta: hasReports
        ? { to: '/reports', label: 'Open Reports', primary: true }
        : { to: '/integrations', label: 'Connect GitHub & Anthropic', primary: false },
      state: hasFix ? 'done' : hasReports ? 'active' : 'next',
      status: hasReports
        ? 'Open the latest report and click "Dispatch fix" to draft a PR on a feature branch.'
        : 'Once your first report lands, the auto-fix agent drafts a PR. Needs a GitHub repo + an Anthropic key.',
    },
    {
      id: 'check',
      cta: hasFix
        ? { to: '/judge', label: 'See judge scores', primary: hasFix && !hasMerged }
        : { to: '/judge', label: 'Tour the judge', primary: false },
      state: hasMerged ? 'done' : hasFix ? 'active' : 'next',
      status: hasFix
        ? 'An independent LLM grades the draft + screenshot diff. Bad fixes are blocked from merge.'
        : 'After Do, an LLM judge + screenshot diff verify the fix is real before it can ship.',
    },
    {
      id: 'act',
      cta: hasMerged
        ? { to: '/integrations', label: 'See routing destinations', primary: true }
        : { to: '/integrations', label: 'Set up routing', primary: false },
      state: hasMerged ? 'done' : 'next',
      status: hasMerged
        ? 'Loop closed. Merged fixes flow back to Sentry, Slack, and your CI automatically.'
        : 'After Check, verified fixes route to Sentry/Slack/GitHub. Set up where bugs should land.',
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

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {stages.map((stage, i) => (
          <LoopStageCard key={stage.id} stage={stage} step={i + 1} isLast={i === stages.length - 1} />
        ))}
      </ol>
    </section>
  )
}

function LoopStageCard({ stage, step, isLast }: { stage: LoopStage; step: number; isLast: boolean }) {
  const meta = PDCA_STAGES[stage.id]
  const outcome = PDCA_STAGE_OUTCOMES[stage.id]
  const tone = stage.state === 'done'
    ? { ring: 'ring-1 ring-ok/30 bg-ok-muted/10', letter: 'bg-ok text-ok-fg' }
    : stage.state === 'active'
      ? { ring: `ring-2 ${meta.ring} ${meta.tintBg}`, letter: `${meta.badgeBg} ${meta.badgeFg}` }
      : { ring: 'ring-1 ring-edge-subtle bg-surface-raised/30', letter: 'bg-surface-overlay text-fg-muted' }

  const isLocked = stage.state === 'next'
  const cta = stage.cta

  return (
    <li className={`relative rounded-md p-3 ${tone.ring} ${isLocked ? 'opacity-60' : ''}`}>
      {!isLast && (
        <span aria-hidden="true" className="hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10 w-4 h-4 items-center justify-center text-fg-faint">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h7m0 0L7 4m3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md font-bold text-xs leading-none ${tone.letter}`}>
          {stage.state === 'done' ? '✓' : meta.letter}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-2xs uppercase tracking-wider text-fg-muted">Step {step} · {meta.label}</span>
          <h3 className="text-xs font-semibold text-fg truncate">{outcome.headline}</h3>
        </div>
      </div>
      <p className="text-2xs text-fg-secondary leading-snug min-h-[3rem]">{stage.status ?? outcome.outcome}</p>
      <div className="mt-2.5">
        <StageCta cta={cta} isLocked={isLocked} />
      </div>
    </li>
  )
}

const CTA_BASE_PRIMARY = 'inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg'
const CTA_BASE_GHOST = 'inline-flex items-center gap-1 text-xs text-brand'

function ctaClass(primary: boolean | undefined, locked: boolean): string {
  const base = primary ? CTA_BASE_PRIMARY : CTA_BASE_GHOST
  if (locked) return `${base} cursor-not-allowed`
  return primary
    ? `${base} hover:bg-brand-hover motion-safe:transition-colors`
    : `${base} hover:underline`
}

function StageCta({ cta, isLocked }: { cta: LoopStage['cta']; isLocked: boolean }) {
  const label = (
    <>
      {cta.label} {cta.primary && <span aria-hidden="true">→</span>}
    </>
  )

  if (cta.to) {
    if (isLocked) {
      return (
        <span className={ctaClass(cta.primary, true)} aria-disabled="true">
          {label}
        </span>
      )
    }
    return (
      <Link to={cta.to} className={ctaClass(cta.primary, false)}>
        {label}
      </Link>
    )
  }

  return (
    <Btn
      size="sm"
      variant={cta.primary ? 'primary' : 'ghost'}
      onClick={cta.onClick}
      disabled={isLocked}
    >
      {cta.label}
    </Btn>
  )
}

/**
 * Layout-shaped skeleton that matches the rendered first-run loop so the
 * page doesn't jolt when setup data resolves. Replaces the prior
 * <Loading text="Checking your account..." /> spinner
 */
function GettingStartedSkeleton() {
  return (
    <div>
      <div className="mb-5">
        <Skeleton className="h-4 w-44 mb-2" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Skeleton className="h-12 w-full mb-4" />
      <section className="rounded-lg border border-edge-subtle bg-surface-raised/30 p-4">
        <div className="mb-3">
          <Skeleton className="h-3.5 w-40 mb-1" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {PDCA_ORDER.map((id) => (
            <div key={id} className="rounded-md ring-1 ring-edge-subtle bg-surface-raised/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Skeleton className="h-6 w-6 rounded-md" />
                <Skeleton className="h-3 flex-1" />
              </div>
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-3/4 mb-1" />
              <Skeleton className="h-3 w-2/3 mb-3" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
