import { Fragment, type ReactNode } from 'react'

/**
 * Discovery lifecycle stepper.
 *
 * Shows the four phases of the v2.1 hybrid-inventory loop as a single
 * horizontal strip with check / active / pending semantics:
 *
 *    ① Install ───── ② Observe ───── ③ Propose ───── ④ Accept
 *
 * The stepper is the answer to the user's "I don't know what's going
 * on" feedback. It tells you, at a squint, where this project is in
 * the loop without forcing them to read a paragraph.
 *
 * Each step has its own derived `state`:
 *   - `done`       (green check; this phase is complete)
 *   - `active`     (brand ring + emphasised value; user should act here)
 *   - `pending`    (faint, awaiting upstream)
 *
 * On narrow viewports the strip stacks vertically with the connecting
 * line rotated 90°.
 */
export type LifecycleStepState = 'done' | 'active' | 'pending'

export interface LifecycleStep {
  id: 'install' | 'observe' | 'propose' | 'accept'
  state: LifecycleStepState
  label: string
  /** Short status (e.g. "10 events", "5 routes seen", "ready"). */
  value: string
  /** Optional secondary detail (e.g. "last seen 2m ago"). */
  detail?: string
  /** Optional inline action for the user. */
  cta?: { label: string; onClick: () => void; disabled?: boolean }
  icon: ReactNode
}

interface Props {
  steps: LifecycleStep[]
}

const STATE_STYLES: Record<LifecycleStepState, {
  ring: string
  bg: string
  iconWrap: string
  iconColor: string
  numberColor: string
  labelColor: string
}> = {
  done: {
    ring: 'ring-1 ring-ok/30',
    bg: 'bg-ok-muted/40',
    iconWrap: 'bg-ok/15 text-ok',
    iconColor: 'text-ok',
    numberColor: 'text-ok',
    labelColor: 'text-fg',
  },
  active: {
    ring: 'ring-1 ring-brand/30',
    bg: 'bg-brand/[0.06]',
    iconWrap: 'bg-brand/15 text-brand',
    iconColor: 'text-brand',
    numberColor: 'text-fg',
    labelColor: 'text-fg',
  },
  pending: {
    ring: 'ring-1 ring-edge-subtle',
    bg: 'bg-surface-overlay/40',
    iconWrap: 'bg-surface-overlay text-fg-faint',
    iconColor: 'text-fg-faint',
    numberColor: 'text-fg-faint',
    labelColor: 'text-fg-muted',
  },
}

export function DiscoveryLifecycle({ steps }: Props) {
  return (
    <div
      role="list"
      aria-label="Inventory discovery lifecycle"
      // The horizontal 4-up stepper needs ~640 px to feel comfortable.
      // Below `lg`, stack vertically (each step on its own row) so the
      // labels and CTAs don't truncate. The connector hides on stack.
      className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-2 lg:gap-0 items-stretch"
    >
      {steps.map((step, idx) => (
        <Fragment key={step.id}>
          <LifecycleTile step={step} index={idx} />
          {idx < steps.length - 1 && (
            <Connector
              left={step.state}
              right={steps[idx + 1]!.state}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}

function LifecycleTile({ step, index }: { step: LifecycleStep; index: number }) {
  const style = STATE_STYLES[step.state]
  return (
    <article
      role="listitem"
      aria-current={step.state === 'active' ? 'step' : undefined}
      className={`relative flex flex-col gap-1 px-3 py-3 rounded-lg ${style.ring} ${style.bg} transition-colors`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${style.iconWrap} text-xs font-semibold tabular-nums`}
        >
          {step.state === 'done' ? <CheckGlyph /> : index + 1}
        </div>
        <div className="min-w-0">
          <p className={`text-2xs uppercase tracking-wider ${style.labelColor}`}>
            {step.label}
          </p>
          <p className={`text-sm font-semibold ${style.numberColor} tabular-nums truncate`}>
            {step.value}
          </p>
        </div>
      </div>
      {step.detail && (
        <p className="text-2xs text-fg-faint pl-9 truncate">{step.detail}</p>
      )}
      {step.cta && (
        <button
          type="button"
          onClick={step.cta.onClick}
          disabled={step.cta.disabled}
          className={`mt-1 ml-9 inline-flex items-center gap-1 text-2xs font-medium ${
            step.cta.disabled
              ? 'text-fg-faint cursor-not-allowed'
              : 'text-brand hover:text-brand-strong'
          }`}
        >
          {step.cta.label} <span aria-hidden>→</span>
        </button>
      )}
    </article>
  )
}

function Connector({
  left,
  right,
}: {
  left: LifecycleStepState
  right: LifecycleStepState
}) {
  // The connector takes its colour from the left step (the upstream
  // step that "feeds" the next one). When left is done, the line is
  // green up to the next tile. When left is active and right is
  // pending, we use a brand→neutral gradient so the eye reads the
  // direction of travel.
  const stroke =
    left === 'done'
      ? 'bg-ok/40'
      : left === 'active' && right === 'pending'
        ? 'bg-gradient-to-r from-brand/40 to-edge-subtle'
        : left === 'active'
          ? 'bg-brand/30'
          : 'bg-edge-subtle'
  return (
    <div
      aria-hidden
      className="hidden lg:flex items-center justify-center w-6 self-stretch"
    >
      <span className={`block w-full h-px ${stroke}`} />
    </div>
  )
}

function CheckGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 7.5L5.5 10L11 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
