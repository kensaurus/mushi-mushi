/**
 * FILE: ConnectStepLaneReadout.tsx
 * PURPOSE: Lane detail under the Connect pipeline — status chip, one guidance line,
 *          and a compact facts grid (versions, heartbeats, repo, MCP keys).
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { StepNodeData } from './ConnectStepFlow'
import { buildConnectLaneReadout } from '../../lib/connectLaneReadout'
import type { LaneMetaFact, LaneMetaTone } from '../../lib/connectLaneMetadata'

function factToneClass(tone: LaneMetaTone | undefined): string {
  switch (tone) {
    case 'ok':
      return 'text-ok'
    case 'warn':
      return 'text-warning-foreground'
    case 'info':
      return 'text-info'
    default:
      return 'text-fg-secondary'
  }
}

function LaneFactsGrid({ facts }: { facts: LaneMetaFact[] }) {
  if (facts.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-edge-subtle/50 pt-2 sm:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-3xs font-medium uppercase tracking-wide text-fg-faint">{fact.label}</dt>
          <dd className={`mt-0.5 truncate text-2xs font-semibold tabular-nums ${factToneClass(fact.tone)}`} title={fact.value}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export interface ConnectStepLaneReadoutProps {
  lane: StepNodeData
  icon?: ReactNode
  className?: string
}

export function ConnectStepLaneReadout({ lane, icon, className = '' }: ConnectStepLaneReadoutProps) {
  const model = buildConnectLaneReadout(lane)

  return (
    <div
      className={`rounded-md border border-edge-subtle/70 border-l-[3px] ${model.borderAccent} bg-surface-overlay/55 px-3 py-2.5 ${className}`.trim()}
      role="region"
      aria-label={`${model.title} setup details`}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon ? (
          <span
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge-subtle bg-surface-raised text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-xs font-semibold text-fg">{model.title}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide whitespace-nowrap ${model.chipClass}`}
            >
              {model.statusLabel}
            </span>
            {lane.metaLine ? (
              <span className={`text-3xs font-semibold tabular-nums whitespace-nowrap ${factToneClass(lane.metaTone)}`}>
                {lane.metaLine}
              </span>
            ) : null}
            {model.isNext ? (
              <span className="rounded-full bg-brand-subtle/80 px-2 py-0.5 text-3xs font-medium text-brand whitespace-nowrap">
                Next step
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
            {lane.actionHref ? (
              <Link to={lane.actionHref} className="text-brand hover:underline">
                {model.body}
              </Link>
            ) : (
              model.body
            )}
          </p>
          {lane.facts?.length ? <LaneFactsGrid facts={lane.facts} /> : null}
        </div>
      </div>
    </div>
  )
}
