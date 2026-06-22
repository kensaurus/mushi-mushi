/**
 * FILE: ConnectActivationStrip.tsx
 * PURPOSE: Activation progress strip for Connect hub — chip rail while in
 *          progress; collapsible panel with install pipeline stepper when complete.
 */

import { useMemo } from 'react'
import { IconArrowRight, IconCheck, IconChevronDown, IconInfo, IconGit, IconIntegrations, IconMcp, IconTerminal } from '../icons'
import { ConnectStepFlow } from './ConnectStepFlow'
import { buildConnectStepLanes, type ConnectLaneFlags } from '../../lib/connectStepLanes'

const LANE_ICON: Record<string, typeof IconGit> = {
  github: IconGit,
  sdk: IconIntegrations,
  mcp: IconMcp,
  cli: IconTerminal,
  upgrade: IconIntegrations,
  native_ci: IconTerminal,
}

function renderLaneIcon(laneId: string | undefined) {
  if (!laneId) return null
  const Icon = LANE_ICON[laneId] ?? IconIntegrations
  return <Icon size={14} />
}

interface ActivationStep {
  done: boolean
  label: string
  href: string
  hint: string
}

interface Props {
  projectSelected: boolean
  activationSteps: ActivationStep[]
  /** Install pipeline flags — used when activation is complete to render stepper. */
  laneFlags: ConnectLaneFlags
}

function ActivationChipRail({ steps }: { steps: ActivationStep[] }) {
  const doneCount = steps.filter((s) => s.done).length
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => (
        <span
          key={s.label}
          className="flex items-center gap-px"
          aria-label={`${s.label}: ${s.done ? 'done' : 'pending'}`}
        >
          {i > 0 && <IconArrowRight className="h-2.5 w-2.5 text-fg-faint mx-0.5" aria-hidden />}
          <a
            href={s.href}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-px font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              s.done
                ? 'bg-ok/15 text-ok'
                : 'bg-surface-overlay text-fg-faint hover:bg-surface-raised'
            }`}
          >
            {s.done && <IconCheck className="h-2.5 w-2.5" aria-hidden />}
            {s.label}
          </a>
        </span>
      ))}
      <span className="sr-only">{doneCount} of {steps.length} activation steps complete</span>
    </span>
  )
}

export function ConnectActivationStrip({ projectSelected, activationSteps, laneFlags }: Props) {
  const doneCount = activationSteps.filter((s) => s.done).length
  const allDone = doneCount === activationSteps.length
  const firstIncomplete = activationSteps.find((s) => !s.done)
  const stepLanes = useMemo(() => buildConnectStepLanes(laneFlags), [laneFlags])

  if (!projectSelected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-edge-subtle bg-surface-raised/50 px-3 py-2 text-xs text-fg-muted">
        <IconInfo className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
        Select a project above to see setup status.
      </div>
    )
  }

  if (allDone) {
    return (
      <details className="group rounded-md border border-ok/30 bg-ok-muted/40 overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset">
          <IconCheck className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
          <span className="font-medium text-ok">Activation complete</span>
          <span className="min-w-0 flex-1 truncate text-fg-muted">
            — {doneCount}/{activationSteps.length} steps · expand for install pipeline
          </span>
          <span className="inline-flex items-center gap-1 text-2xs text-fg-faint shrink-0 group-open:hidden">
            Show pipeline
            <IconChevronDown className="h-3 w-3" aria-hidden />
          </span>
          <IconChevronDown
            className="h-3 w-3 shrink-0 text-fg-faint hidden group-open:inline motion-safe:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-3 border-t border-ok/20 px-3 py-3">
          <div>
            <p className="mb-2 text-3xs font-medium uppercase tracking-wider text-fg-faint">
              Activation checklist
            </p>
            <ActivationChipRail steps={activationSteps} />
          </div>
          <div>
            <p className="mb-2 text-3xs font-medium uppercase tracking-wider text-fg-faint">
              Install pipeline (6 lanes)
            </p>
            <div className="rounded-md border border-edge-subtle bg-surface-raised/40 py-2 px-1 min-w-0">
              <ConnectStepFlow lanes={stepLanes} renderLaneIcon={renderLaneIcon} />
            </div>
          </div>
        </div>
      </details>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-brand/25 bg-brand-subtle/40 px-3 py-2 text-xs">
      <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint shrink-0">
        Activation
      </span>
      <ActivationChipRail steps={activationSteps} />
      {firstIncomplete ? (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-fg-muted hidden sm:inline">{firstIncomplete.hint}</span>
          <a
            href={firstIncomplete.href}
            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-0.5 font-medium text-brand hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-focus"
          >
            {firstIncomplete.label}
            <IconArrowRight className="h-3 w-3" aria-hidden />
          </a>
        </span>
      ) : null}
    </div>
  )
}
