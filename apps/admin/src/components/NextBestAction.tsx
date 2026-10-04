/**
 * FILE: apps/admin/src/components/NextBestAction.tsx
 * PURPOSE: Persistent "what should I do next?" strip rendered below the
 * PageHeader on every page in beginner mode
 *
 *          The strip shows the *single* next action the user should take,
 *          from real work first (unfixed urgent reports, stopped fixes, open
 *          PRs — counted per report, from useNavCounts) and setup gaps after.
 *          The rule order lives in lib/nextBestAction.ts, so every page
 *          (Dashboard, Reports, Fixes, Judge, Integrations, etc.) agrees.
 */

import { useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { usePostureHasStatusBanner } from '../lib/postureChromeStore'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'
import { useAdminMode } from '../lib/mode'
import { shouldShowQuickstartMegaCta } from '../lib/chromePosture'
import { useSendTestReport } from '../lib/useSendTestReport'
import { CHIP_TONE } from '../lib/chipTone'
import { Btn, ResultChip } from './ui'
import { computeNextAction, type NbaAction, type NbaTone, type NbaWork } from '../lib/nextBestAction'

const NBA_TONES: Record<NbaTone, { ring: string; bg: string; chipClass: string }> = {
  plan:  { ring: 'border-info/40',   bg: 'bg-info-muted/15',   chipClass: CHIP_TONE.infoSubtle },
  do:    { ring: 'border-edge',        bg: 'bg-surface-raised/40', chipClass: CHIP_TONE.brandSubtle },
  check: { ring: 'border-info/40',   bg: 'bg-info-muted/15',   chipClass: CHIP_TONE.infoSubtle },
  act:   { ring: 'border-ok/40',     bg: 'bg-ok-muted/15',     chipClass: CHIP_TONE.okSubtle },
  idle:  { ring: 'border-edge',      bg: 'bg-surface-raised/40', chipClass: CHIP_TONE.neutral },
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
export function NextBestAction({ work }: { work: NbaWork }) {
  // ALL hooks must run on every render — early returns below the hook block
  // only. Otherwise React throws "Rendered more hooks than during the
  // previous render" when the strip transitions from hidden (login/loading)
  // to visible (post-auth). Caught live in Playwright on 2026-04-20.
  const { isBeginner, isQuickstart } = useAdminMode()
  const { pathname } = useLocation()
  const postureHasStatusBanner = usePostureHasStatusBanner()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const sendTestReport = useSendTestReport()
  const [testState, setTestState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')

  // Compute the action even when we're going to bail — its identity drives
  // the handoff effect below, which must be declared before any early
  // return. `setup.loading` makes this a no-op (returns null).
  const action = setup.loading ? null : computeNextAction(setup, work, pathname)

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

  // Quick is the default mode — the guidance strip is exactly what new
  // users are missing there, so it renders in both Quick and Beginner.
  // Advanced stays opted out for a denser layout.
  if (!isBeginner && !isQuickstart) return null
  // The Quickstart mega CTA already names the next step on these routes.
  if (shouldShowQuickstartMegaCta(isQuickstart, pathname)) return null
  // Status banner on PagePosture already carries the next step for this route.
  if (postureHasStatusBanner) return null
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
        className={`mb-3 -mt-1 flex items-center gap-2.5 rounded-md border ${fromTone.ring} ${fromTone.bg} px-3 py-1.5 motion-safe:animate-mushi-fade-in`}
      >
        <span className={`inline-flex items-center gap-1 shrink-0 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${fromTone.chipClass}`}>
          <span aria-hidden="true">✓</span>
          Done: {NBA_LABELS[handoff.from]}
        </span>
        <p className="text-xs font-medium text-fg leading-tight truncate flex-1 min-w-0">
          Nice. Now: <span className="text-fg-muted">{handoff.nextTitle}</span>
        </p>
      </aside>
    )
  }

  const tone = NBA_TONES[action.tone]

  async function fireTestReport() {
    const projectId = setup.activeProject?.project_id
    if (!projectId) return
    setTestState('running')
    const res = await sendTestReport(projectId)
    setTestState(res.ok ? 'success' : 'error')
  }

  return (
    <aside
      role="complementary"
      aria-label="Next best action"
      className={`mb-3 -mt-1 flex items-center gap-2.5 rounded-md border ${tone.ring} ${tone.bg} px-3 py-1.5 motion-safe:animate-mushi-fade-in`}
    >
      <span className={`inline-flex items-center gap-1 shrink-0 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${tone.chipClass}`}>
        <span aria-hidden="true">→</span>
        {NBA_LABELS[action.tone]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-fg leading-tight truncate">{action.title}</p>
        {action.why && (
          <p className="text-3xs text-fg-muted mt-0.5 leading-snug truncate">{action.why}</p>
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
  // Outline, not filled: this strip rides above every page, so a filled CTA
  // here competed with each page's own primary action for attention.
  if (cta.kind === 'link') {
    return (
      <Btn to={cta.to} size="sm" variant="ghost">
        {cta.label} <span aria-hidden="true">→</span>
      </Btn>
    )
  }
  return (
    <Btn size="sm" variant="ghost" onClick={onTestReport} loading={testRunning}>
      {cta.label}
    </Btn>
  )
}
