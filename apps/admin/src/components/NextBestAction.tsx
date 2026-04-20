/**
 * FILE: apps/admin/src/components/NextBestAction.tsx
 * PURPOSE: Persistent "what should I do next?" strip rendered below the
 *          PageHeader on every page in beginner mode (Wave L).
 *
 *          The strip computes the *single* next action the user should take
 *          across the whole loop, sourced from setup status + active project
 *          counts. The order matches the Plan→Do→Check→Act sequence so the
 *          beginner is always pulled forward, not sideways.
 *
 *          One source of truth: change the rule order below and every page
 *          (Dashboard, Reports, Fixes, Judge, Integrations, etc.) updates.
 */

import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'
import { useAdminMode } from '../lib/mode'
import { useToast } from '../lib/toast'
import { apiFetch } from '../lib/supabase'
import { Btn, ResultChip } from './ui'

type NbaTone = 'plan' | 'do' | 'check' | 'act' | 'idle'

interface NbaAction {
  /** PDCA-aligned tone so the strip colour matches the stage being worked. */
  tone: NbaTone
  /** Verb-led headline. */
  title: string
  /** One-sentence "why this matters right now". */
  why?: string
  /** Primary CTA — internal route or inline trigger (mutually exclusive). */
  cta:
    | { kind: 'link'; to: string; label: string }
    | { kind: 'inline-test-report'; label: string }
}

const NBA_TONES: Record<NbaTone, { ring: string; bg: string; chip: string; chipText: string }> = {
  plan:  { ring: 'border-info/40',   bg: 'bg-info-muted/15',   chip: 'bg-info-muted',   chipText: 'text-info' },
  do:    { ring: 'border-brand/40',  bg: 'bg-brand/10',        chip: 'bg-brand/15',     chipText: 'text-brand' },
  check: { ring: 'border-warn/40',   bg: 'bg-warn/10',         chip: 'bg-warn-muted',   chipText: 'text-warn' },
  act:   { ring: 'border-ok/40',     bg: 'bg-ok-muted/15',     chip: 'bg-ok-muted',     chipText: 'text-ok' },
  idle:  { ring: 'border-edge',      bg: 'bg-surface-raised/40', chip: 'bg-surface-overlay', chipText: 'text-fg-muted' },
}

const NBA_LABELS: Record<NbaTone, string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Ship',
  idle: 'Idle',
}

/**
 * Renders the strip below the PageHeader. No-op outside beginner mode so
 * power users on advanced mode get a denser layout.
 */
export function NextBestAction() {
  // ALL hooks must run on every render — early returns below the hook block
  // only. Otherwise React throws "Rendered more hooks than during the
  // previous render" when the strip transitions from hidden (login/loading)
  // to visible (post-auth). Caught live in Playwright on 2026-04-20.
  const { isBeginner } = useAdminMode()
  const { pathname } = useLocation()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const toast = useToast()
  const [testState, setTestState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')

  // Compute the action even when we're going to bail — its identity drives
  // the handoff effect below, which must be declared before any early
  // return. `setup.loading` makes this a no-op (returns null).
  const action = setup.loading ? null : computeNextAction(setup, pathname)

  // Track the previous gate so we can flash a "✓ Done — next: X" handoff
  // strip for ~1.4s when the user satisfies the current rule.
  const previousActionRef = useRef<NbaAction | null>(null)
  const [handoff, setHandoff] = useState<{ from: NbaTone; to: NbaTone; nextTitle: string } | null>(null)
  useEffect(() => {
    const prev = previousActionRef.current
    if (prev && action && prev.title !== action.title) {
      setHandoff({ from: prev.tone, to: action.tone, nextTitle: action.title })
      const t = setTimeout(() => setHandoff(null), 1400)
      previousActionRef.current = action
      return () => clearTimeout(t)
    }
    previousActionRef.current = action
  }, [action?.title, action?.tone])

  if (!isBeginner) return null
  // Login/recovery routes are unauthenticated — never render the strip.
  if (pathname.startsWith('/login') || pathname.startsWith('/recovery')) return null
  if (setup.loading) return null
  if (!action) return null

  if (handoff) {
    const fromTone = NBA_TONES[handoff.from]
    return (
      <aside
        role="status"
        aria-live="polite"
        className={`mb-4 -mt-2 flex items-center gap-3 rounded-md border ${fromTone.ring} ${fromTone.bg} px-3 py-2 motion-safe:animate-mushi-fade-in`}
      >
        <span className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${fromTone.chip} ${fromTone.chipText}`}>
          <span aria-hidden="true">✓</span>
          Done: {NBA_LABELS[handoff.from]}
        </span>
        <p className="text-xs font-medium text-fg leading-tight truncate flex-1 min-w-0">
          Nice. Next up: <span className="text-fg-muted">{handoff.nextTitle}</span>
        </p>
      </aside>
    )
  }

  const tone = NBA_TONES[action.tone]

  async function fireTestReport() {
    const projectId = setup.activeProject?.project_id
    if (!projectId) return
    setTestState('running')
    const res = await apiFetch(`/v1/admin/projects/${projectId}/test-report`, { method: 'POST' })
    if (res.ok) {
      setTestState('success')
      toast.success('Test report queued', 'Watch it land in Reports within a few seconds.')
      setup.reload()
    } else {
      setTestState('error')
      toast.error('Test report failed', res.error?.message ?? 'Check project keys and try again.')
    }
  }

  return (
    <aside
      role="complementary"
      aria-label="Next best action"
      className={`mb-4 -mt-2 flex items-center gap-3 rounded-md border ${tone.ring} ${tone.bg} px-3 py-2 motion-safe:animate-mushi-fade-in`}
    >
      <span className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${tone.chip} ${tone.chipText}`}>
        <span aria-hidden="true">→</span>
        Next: {NBA_LABELS[action.tone]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-fg leading-tight truncate">{action.title}</p>
        {action.why && (
          <p className="text-2xs text-fg-muted mt-0.5 leading-snug truncate">{action.why}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {testState !== 'idle' && action.cta.kind === 'inline-test-report' && (
          <ResultChip tone={testState === 'success' ? 'success' : testState === 'error' ? 'error' : 'running'}>
            {testState === 'running' ? 'Sending test…' : testState === 'success' ? 'Sent' : 'Failed'}
          </ResultChip>
        )}
        <NbaCta cta={action.cta} onTestReport={fireTestReport} testRunning={testState === 'running'} />
      </div>
    </aside>
  )
}

function NbaCta({
  cta,
  onTestReport,
  testRunning,
}: {
  cta: NbaAction['cta']
  onTestReport: () => void
  testRunning: boolean
}) {
  if (cta.kind === 'link') {
    return (
      <Link
        to={cta.to}
        className="inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors motion-safe:active:scale-[0.97] motion-safe:duration-150"
      >
        {cta.label} <span aria-hidden="true">→</span>
      </Link>
    )
  }
  return (
    <Btn size="sm" variant="primary" onClick={onTestReport} loading={testRunning}>
      {cta.label}
    </Btn>
  )
}

/**
 * Rule order = beginner journey. The first matching rule wins, so newer
 * users always see the earliest-stage gate; once setup is finished, they
 * see the most-recent operational nudge instead. Pages that already render
 * a stronger CTA (Dashboard's hero, Reports' inline trigger) suppress the
 * strip via the `pathname` skiplist below.
 */
function computeNextAction(
  setup: ReturnType<typeof useSetupStatus>,
  pathname: string,
): NbaAction | null {
  // Pages with their own dominant first-action surface: don't double up.
  // Dashboard renders <FirstReportHero> + <PdcaCockpit>; Onboarding is the
  // wizard itself. Showing a strip there would be redundant noise.
  if (pathname === '/' || pathname.startsWith('/onboarding')) return null

  const project = setup.activeProject
  if (!setup.hasAnyProject || !project) {
    return {
      tone: 'plan',
      title: 'Create your first project',
      why: 'A project is the inbox for user-felt bugs from one of your apps.',
      cta: { kind: 'link', to: '/onboarding', label: 'Open setup wizard' },
    }
  }

  if (setup.isStepIncomplete('sdk_installed')) {
    return {
      tone: 'plan',
      title: 'Install the Mushi widget in your app',
      why: 'Without the SDK, end-users have no way to flag bugs.',
      cta: { kind: 'link', to: '/onboarding', label: 'Open install steps' },
    }
  }

  if (project.report_count === 0) {
    return {
      tone: 'plan',
      title: 'Send a test report to see the loop run',
      why: 'A synthetic report flows through Plan → Do → Check → Act in ~30s.',
      cta: { kind: 'inline-test-report', label: 'Send test report' },
    }
  }

  if (project.fix_count === 0) {
    return {
      tone: 'do',
      title: `Dispatch a fix on your ${project.report_count} waiting ${project.report_count === 1 ? 'report' : 'reports'}`,
      why: 'Mushi opens a draft PR with rationale. You review the diff, not the ticket.',
      cta: { kind: 'link', to: '/reports', label: 'Open Reports' },
    }
  }

  if (project.merged_fix_count === 0) {
    return {
      tone: 'check',
      title: 'Review the auto-drafted PR',
      why: 'Judge scores + screenshot diff are ready for your read-through.',
      cta: { kind: 'link', to: '/fixes', label: 'Open Fixes' },
    }
  }

  // Loop closed — surface routing setup as the natural Act-stage next step.
  if (setup.isStepIncomplete('sentry_connected')) {
    return {
      tone: 'act',
      title: 'Wire merged fixes back to Sentry / Slack',
      why: 'Close the loop end-to-end so your team sees fixes where they already work.',
      cta: { kind: 'link', to: '/integrations', label: 'Set up routing' },
    }
  }

  return {
    tone: 'idle',
    title: 'You\u2019re green across the loop. Try the live demo to see it run.',
    cta: { kind: 'link', to: '/', label: 'Watch the demo' },
  }
}
