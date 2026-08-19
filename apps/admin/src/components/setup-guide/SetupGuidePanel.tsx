/**
 * FILE: apps/admin/src/components/setup-guide/SetupGuidePanel.tsx
 * PURPOSE: Presentational half of the docked setup guide. Takes a finished
 *          SetupGuideModel plus the current view state and renders the dock —
 *          no hooks, no fetching, no storage — so the state machine and the
 *          accessibility wiring can be asserted in vitest with
 *          renderToStaticMarkup.
 *
 *          Disclosure, not dialog: the launcher owns `aria-expanded` +
 *          `aria-controls`, the panel is a plain labelled region that stays in
 *          the DOM (`hidden` when closed) so the control never points at a
 *          missing id. Deliberately NOT `role="dialog" aria-modal` — the guide
 *          must never trap focus or block the page it is describing.
 */

import { Link } from 'react-router-dom'
import { forwardRef } from 'react'
import type { SetupGuideStep, SetupGuideStepState, SetupGuideModel } from '../../lib/setupGuideSteps'
import { setupGuideSummary } from '../../lib/setupGuideSteps'
import type { SetupGuideView } from '../../lib/setupGuidePrefs'
import { CHIP_TONE } from '../../lib/chipTone'
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconClock,
  IconClose,
  IconChevronDown,
} from '../icons'

export const SETUP_GUIDE_PANEL_ID = 'setup-guide-panel'

interface StateStyle {
  Icon: typeof IconCheck
  chip: string
  /** Marker ring around the icon — tone plus shape, never tone alone. */
  marker: string
}

const STATE_STYLE: Record<SetupGuideStepState, StateStyle> = {
  done: {
    Icon: IconCheck,
    chip: CHIP_TONE.okSubtle,
    marker: 'border-ok/45 bg-ok-muted/50 text-ok-foreground',
  },
  next: {
    Icon: IconBolt,
    chip: CHIP_TONE.brandSubtle,
    marker: 'border-brand/45 bg-brand/12 text-brand',
  },
  blocked: {
    Icon: IconClock,
    chip: CHIP_TONE.warnSubtle,
    marker: 'border-warn/40 bg-warn-muted/45 text-warning-foreground',
  },
  available: {
    Icon: IconArrowRight,
    chip: CHIP_TONE.neutral,
    marker: 'border-edge-subtle bg-surface-overlay text-fg-muted',
  },
}

const FACT_TONE: Record<string, string> = {
  ok: 'text-ok-foreground',
  warn: 'text-warning-foreground',
  muted: 'text-fg-muted',
}

export interface SetupGuidePanelProps {
  model: SetupGuideModel
  view: Exclude<SetupGuideView, 'dismissed'>
  onExpand: () => void
  onMinimize: () => void
  onDismiss: () => void
  /** Route navigation happens through <Link>; this only closes the panel. */
  onNavigate?: () => void
}

export const SetupGuidePanel = forwardRef<HTMLHeadingElement, SetupGuidePanelProps>(
  function SetupGuidePanel(
    { model, view, onExpand, onMinimize, onDismiss, onNavigate },
    headingRef,
  ) {
    const open = view === 'expanded'
    const summary = setupGuideSummary(model)

    return (
      <div
        // mushi-ui: docked chrome affordance — not Modal/Drawer (reason: a
        // non-modal, always-available disclosure that must not trap focus).
        // Left-docked and offset past the sidebar because the toast stack owns
        // `fixed bottom-4 right-4 z-[60]` (lib/toast.tsx); a right-docked
        // launcher would sit underneath every toast the console fires.
        className="fixed bottom-4 left-4 z-40 print:hidden md:left-20 [html[data-sidebar=expanded]_&]:md:left-64"
        data-setup-guide={view}
      >
        {!open && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onExpand}
              aria-expanded={false}
              aria-controls={SETUP_GUIDE_PANEL_ID}
              data-setup-guide-launcher="true"
              className="group inline-flex items-center gap-2 rounded-full border border-edge bg-surface-raised py-1.5 pl-2 pr-3 shadow-raised motion-safe:transition-transform motion-safe:duration-fast motion-safe:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ProgressDial percent={model.percent} done={model.allRequiredDone} />
              <span className="text-2xs font-medium text-fg-secondary">{summary}</span>
              <IconChevronDown className="h-3 w-3 rotate-180 text-fg-faint" />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Hide the setup guide"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-edge bg-surface-raised text-fg-faint shadow-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <IconClose size={11} />
            </button>
          </div>
        )}

        <section
          id={SETUP_GUIDE_PANEL_ID}
          hidden={!open}
          aria-labelledby="setup-guide-heading"
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
          className="w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-raised motion-safe:animate-mushi-modal-in"
        >
          <header className="border-b border-edge/60 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <h2
                id="setup-guide-heading"
                ref={headingRef}
                tabIndex={-1}
                className="text-xs font-semibold text-fg outline-none"
              >
                Set up Mushi
              </h2>
              <span className={`rounded-full px-1.5 py-0.5 text-3xs font-medium ${model.allRequiredDone ? CHIP_TONE.okSubtle : CHIP_TONE.brandSubtle}`}>
                {summary}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={onMinimize}
                  aria-expanded={open}
                  aria-controls={SETUP_GUIDE_PANEL_ID}
                  aria-label="Minimize the setup guide"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-faint hover:bg-surface-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <IconChevronDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Hide the setup guide"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-faint hover:bg-surface-overlay hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <IconClose size={12} />
                </button>
              </div>
            </div>
            <p className="mt-1 text-2xs text-fg-muted">
              {model.projectName
                ? `${model.projectName} · click any step to open the page that completes it.`
                : 'Click any step to open the page that completes it.'}
            </p>
            <ProgressMeter percent={model.percent} label={`${model.requiredComplete} of ${model.requiredTotal} required steps complete`} />
          </header>

          {model.hostMismatch && (
            <p className={`mx-3 mt-2.5 rounded-md px-2 py-1.5 text-2xs ${CHIP_TONE.warnSubtle}`}>
              Your SDK last reported to <span className="font-mono">{model.hostMismatch.sdkHost}</span>,
              but this console reads <span className="font-mono">{model.hostMismatch.adminHost}</span>.
              Reports sent to the other backend will not show up here.
            </p>
          )}

          {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
          <ol className="max-h-[min(26rem,calc(100vh-14rem))] space-y-1 overflow-y-auto overscroll-contain p-2">
            {model.steps.map((step) => (
              <SetupGuideRow key={step.id} step={step} onNavigate={onNavigate} />
            ))}
          </ol>

          <footer className="border-t border-edge/60 px-3 py-2">
            <button
              type="button"
              onClick={onDismiss}
              className="text-2xs text-fg-faint underline-offset-2 hover:text-fg-muted hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand rounded-sm"
            >
              Hide this guide
            </button>
            <span className="ml-2 text-3xs text-fg-faint">Bring it back from Get started.</span>
          </footer>
        </section>
      </div>
    )
  },
)

function SetupGuideRow({ step, onNavigate }: { step: SetupGuideStep; onNavigate?: () => void }) {
  const style = STATE_STYLE[step.state]
  const { Icon } = style
  return (
    <li>
      <Link
        to={step.to}
        onClick={onNavigate}
        data-step-id={step.id}
        data-step-state={step.state}
        className={`block rounded-md border px-2 py-2 motion-safe:transition-transform motion-safe:duration-fast motion-safe:hover:translate-x-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
          step.state === 'next'
            ? 'border-brand/40 bg-brand/8'
            : 'border-edge-subtle bg-surface-overlay/40 hover:border-edge'
        }`}
      >
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${style.marker}`}
          >
            <Icon size={11} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-2xs font-medium text-fg">{step.label}</span>
              <span className={`rounded-full px-1.5 py-px text-3xs font-medium ${style.chip}`}>
                {step.stateLabel}
              </span>
              {!step.required && step.state !== 'done' && (
                <span className="text-3xs text-fg-faint">optional</span>
              )}
            </span>
            {step.state !== 'done' && (
              <span className="mt-0.5 block text-3xs leading-snug text-fg-muted">
                {step.description}
              </span>
            )}
            {step.facts.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                {step.facts.map((f) => (
                  <span key={f.label} className="text-3xs text-fg-faint">
                    {f.label}:{' '}
                    <span className={`font-medium ${FACT_TONE[f.tone] ?? 'text-fg-muted'}`}>
                      {f.value}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="mt-0.5 shrink-0 text-3xs text-fg-faint">{step.ctaLabel} →</span>
        </div>
      </Link>
    </li>
  )
}

/** Meter exception in docs/MOTION.md — driven by scaleX, not width. */
function ProgressMeter({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-overlay"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full w-full origin-left rounded-full bg-brand motion-safe:transition-transform motion-safe:duration-base"
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})` }}
      />
    </div>
  )
}

/** Tiny dial on the docked pill — a ring, not a bare colour dot. */
function ProgressDial({ percent, done }: { percent: number; done: boolean }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const circumference = 2 * Math.PI * 6
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-edge" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={done ? 'text-ok' : 'text-brand'}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}
