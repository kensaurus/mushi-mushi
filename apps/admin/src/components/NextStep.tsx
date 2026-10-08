/**
 * FILE: apps/admin/src/components/NextStep.tsx
 * PURPOSE: The one "what should I do next?" component (Plan 021 Phase 3).
 *
 *          Three placements, one look (stage icon + stage colour + verb-led
 *          title + one CTA), all fed by useNextStep:
 *            - `banner`: the strip under the page header in Layout. Quick and
 *              Beginner only. Replaces NextBestAction and the Quickstart
 *              mega CTA.
 *            - `card`: in page content: the dashboard's next step.
 *            - `inline`: the per-page prerequisite slot (was SetupNudge).
 *              Shows the missing step, else the page's own empty state.
 *
 *          The rules live in lib/nextBestAction.ts and lib/useNextStep.ts.
 *          At most one next step shows per screen: a card or an inline
 *          blocker on the page claims the slot and the banner stands down.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHIP_TONE } from '../lib/chipTone'
import type { NbaTone } from '../lib/nextBestAction'
import { useSendTestReport } from '../lib/useSendTestReport'
import {
  useClaimNextStep,
  useNextStep,
  type NextStepModel,
  type NextStepSource,
  type SetupBlocker,
} from '../lib/useNextStep'
import { IconCheck, IconEye, IconFixes, IconFlag, IconSend } from './icons'
import { Btn, Card, EmptyState, ResultChip } from './ui'

const TONE_STYLE: Record<NbaTone, { ring: string; bg: string; chip: string; label: string }> = {
  plan: { ring: 'border-info/40', bg: 'bg-info-muted/15', chip: CHIP_TONE.infoSubtle, label: 'Plan' },
  do: { ring: 'border-brand/30', bg: 'bg-brand/5', chip: CHIP_TONE.brandSubtle, label: 'Do' },
  check: { ring: 'border-info/40', bg: 'bg-info-muted/15', chip: CHIP_TONE.infoSubtle, label: 'Check' },
  act: { ring: 'border-ok/40', bg: 'bg-ok-muted/15', chip: CHIP_TONE.okSubtle, label: 'Ship' },
  idle: { ring: 'border-edge', bg: 'bg-surface-raised/40', chip: CHIP_TONE.neutral, label: 'All clear' },
}

function ToneIcon({ tone, size = 14 }: { tone: NbaTone; size?: number }) {
  switch (tone) {
    case 'plan':
      return <IconFlag size={size} />
    case 'do':
      return <IconFixes size={size} />
    case 'check':
      return <IconEye size={size} />
    case 'act':
      return <IconSend size={size} />
    case 'idle':
      return <IconCheck size={size} />
  }
}

interface InlineSlotProps {
  /** What blocks this page when missing. Order matters: first incomplete wins. */
  requires: SetupBlocker[]
  /** Title for "everything is set up but no data yet". */
  emptyTitle: string
  emptyDescription?: string
  /** Action for the "no data yet" path (e.g. a Refresh button). */
  emptyAction?: ReactNode
  /** Illustration above the title on the "no data yet" path. */
  emptyIcon?: ReactNode
  /** Illustration while a setup step is blocking; defaults to the stage icon. */
  blockedIcon?: ReactNode
  emptyHints?: string[]
}

type NextStepProps =
  | { variant: 'banner' }
  | { variant: 'card'; className?: string }
  | ({ variant: 'inline' } & InlineSlotProps)

const NO_REQUIREMENTS: SetupBlocker[] = []

function sourceFor(props: NextStepProps): NextStepSource {
  if (props.variant === 'inline') return { kind: 'prerequisites', requires: props.requires ?? NO_REQUIREMENTS }
  return { kind: 'loop', placement: props.variant === 'banner' ? 'layout' : 'page' }
}

type TestState = 'idle' | 'running' | 'success' | 'error'

export function NextStep(props: NextStepProps) {
  // Every hook runs on every render; early returns come after the hook block.
  const source = sourceFor(props)
  const { step, projectId, loading } = useNextStep(source)
  const sendTestReport = useSendTestReport()
  const [testState, setTestState] = useState<TestState>('idle')
  const handoff = useHandoff(source.kind === 'loop' ? step : null)

  // A card or inline blocker on the page is this screen's next step.
  const claimsPage = props.variant !== 'banner' && step !== null
  useClaimNextStep('page', claimsPage)

  async function fireTestReport() {
    if (!projectId) return
    setTestState('running')
    const res = await sendTestReport(projectId)
    setTestState(res.ok ? 'success' : 'error')
  }

  if (props.variant === 'inline') {
    if (loading) return null
    if (step) {
      return (
        <EmptyState
          icon={props.blockedIcon ?? props.emptyIcon ?? <ToneIcon tone={step.tone} size={18} />}
          title={step.title}
          description={step.why}
          action={<StepCta step={step} size="sm" variant="primary" onTestReport={fireTestReport} testState={testState} />}
        />
      )
    }
    return (
      <EmptyState
        icon={props.emptyIcon}
        title={props.emptyTitle}
        description={props.emptyDescription}
        action={props.emptyAction}
        hints={props.emptyHints}
      />
    )
  }

  if (!step) return null

  if (handoff) {
    const from = TONE_STYLE[handoff.from]
    return (
      <aside
        role="status"
        aria-live="polite"
        className={`${props.variant === 'banner' ? 'mb-3 -mt-1' : ''} flex items-center gap-2.5 rounded-md border ${from.ring} ${from.bg} px-3 py-1.5 motion-safe:animate-mushi-fade-in`}
      >
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${from.chip}`}>
          <IconCheck size={10} />
          Done: {from.label}
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-medium leading-tight text-fg">
          Nice. Now: <span className="text-fg-muted">{handoff.nextTitle}</span>
        </p>
      </aside>
    )
  }

  const tone = TONE_STYLE[step.tone]

  if (props.variant === 'banner') {
    return (
      <aside
        role="complementary"
        aria-label="Next step"
        data-next-step="banner"
        className={`mb-3 -mt-1 flex items-center gap-2.5 rounded-md border ${tone.ring} ${tone.bg} px-3 py-1.5 motion-safe:animate-mushi-fade-in`}
      >
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide ${tone.chip}`}>
          <ToneIcon tone={step.tone} size={10} />
          {tone.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-tight text-fg">{step.title}</p>
          {step.why && <p className="mt-0.5 truncate text-3xs leading-snug text-fg-muted">{step.why}</p>}
        </div>
        {/* Outline, not filled: the strip rides above every page, so a filled
            CTA here competed with each page's own primary action. */}
        <div className="flex shrink-0 items-center gap-2">
          <StepCta step={step} size="sm" variant="ghost" onTestReport={fireTestReport} testState={testState} />
        </div>
      </aside>
    )
  }

  return (
    <Card className={`border ${tone.ring} ${tone.bg} px-3 py-3 ${props.className ?? ''}`.trim()}>
      <section aria-label="Next step" data-next-step="card" className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm ${tone.chip}`}>
          <ToneIcon tone={step.tone} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">Do this next · {tone.label}</p>
          <p className="mt-0.5 text-sm font-semibold leading-tight text-fg">{step.title}</p>
          {step.why && <p className="mt-0.5 text-xs leading-snug text-fg-muted">{step.why}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 self-center">
          <StepCta step={step} size="sm" variant="primary" onTestReport={fireTestReport} testState={testState} />
        </div>
      </section>
    </Card>
  )
}

function StepCta({
  step,
  size,
  variant,
  onTestReport,
  testState,
}: {
  step: NextStepModel
  size: 'sm'
  variant: 'primary' | 'ghost'
  onTestReport: () => void
  testState: TestState
}) {
  if (step.cta.kind === 'link') {
    return (
      <Btn to={step.cta.to} size={size} variant={variant}>
        {step.cta.label} <span aria-hidden="true">→</span>
      </Btn>
    )
  }
  return (
    <>
      {testState !== 'idle' && (
        <ResultChip tone={testState === 'success' ? 'success' : testState === 'error' ? 'error' : 'running'}>
          {testState === 'running' ? 'Sending test…' : testState === 'success' ? 'Sent' : 'Failed'}
        </ResultChip>
      )}
      <Btn size={size} variant={variant} onClick={onTestReport} loading={testState === 'running'}>
        {step.cta.label}
      </Btn>
    </>
  )
}

/**
 * When the step the user was on is satisfied, flash "Done: Plan. Now: …" for
 * ~1.4s before showing the next one, so progress is visible.
 */
function useHandoff(step: NextStepModel | null): { from: NbaTone; nextTitle: string } | null {
  const previous = useRef<NextStepModel | null>(null)
  const [handoff, setHandoff] = useState<{ from: NbaTone; nextTitle: string } | null>(null)
  const title = step?.title
  const tone = step?.tone
  useEffect(() => {
    const prev = previous.current
    previous.current = step
    if (prev && step && prev.title !== step.title) {
      setHandoff({ from: prev.tone, nextTitle: step.title })
      const t = setTimeout(() => setHandoff(null), 1400)
      return () => clearTimeout(t)
    }
  }, [title, tone])
  return handoff
}
