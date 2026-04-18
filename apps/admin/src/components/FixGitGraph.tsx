/**
 * FILE: apps/admin/src/components/FixGitGraph.tsx
 * PURPOSE: Inline SVG branch-graph for one fix attempt. Walks the
 *          /v1/admin/fixes/:id/timeline events (dispatched → branch →
 *          commit → PR → CI → merge/fail) and renders them as a vertical
 *          GitHub-style commit lane with the main branch on the left.
 */

import { Fragment } from 'react'

export interface FixTimelineEvent {
  kind:
    | 'dispatched'
    | 'started'
    | 'branch'
    | 'commit'
    | 'pr_opened'
    | 'ci_started'
    | 'ci_resolved'
    | 'completed'
    | 'failed'
  at: string
  label: string
  detail?: string | null
  status?: 'ok' | 'fail' | 'pending' | null
}

interface FixGitGraphProps {
  events: FixTimelineEvent[]
  prUrl?: string | null
  branchName?: string | null
  baseBranch?: string
  className?: string
}

const STATUS_COLOR: Record<string, string> = {
  ok: 'oklch(0.72 0.19 155)',
  fail: 'oklch(0.65 0.22 25)',
  pending: 'oklch(0.68 0.16 240)',
  default: 'oklch(0.55 0 0)',
}

function nodeColor(e: FixTimelineEvent): string {
  if (e.status === 'fail') return STATUS_COLOR.fail
  if (e.status === 'pending') return STATUS_COLOR.pending
  if (e.status === 'ok') return STATUS_COLOR.ok
  return STATUS_COLOR.default
}

const ROW_H = 36
const LEFT_X = 14
const RIGHT_X = 60

export function FixGitGraph({
  events,
  prUrl,
  branchName,
  baseBranch = 'main',
  className = '',
}: FixGitGraphProps) {
  if (!events || events.length === 0) {
    return (
      <p className={`text-2xs text-fg-faint ${className}`}>No timeline events yet.</p>
    )
  }

  // We render two lanes:
  //   - main lane on the left (just an anchor + label)
  //   - feature lane on the right with one node per event
  // The main → feature transition only needs one curve at "branch" time;
  // the merge curve only appears at "completed" with PR.
  const totalH = events.length * ROW_H + 24
  const branchIdx = events.findIndex((e) => e.kind === 'branch')
  const completedIdx = events.findIndex((e) => e.kind === 'completed')
  const branchY = branchIdx >= 0 ? branchIdx * ROW_H + 12 : 12
  const mergeY = completedIdx >= 0 ? completedIdx * ROW_H + 12 : null

  return (
    <div className={`grid grid-cols-[7.5rem_1fr] gap-3 ${className}`}>
      <svg
        viewBox={`0 0 80 ${totalH}`}
        width="80"
        height={totalH}
        role="img"
        aria-label={`Fix branch graph for ${branchName ?? 'unknown branch'}`}
      >
        {/* main lane */}
        <line
          x1={LEFT_X}
          y1={0}
          x2={LEFT_X}
          y2={totalH}
          stroke="oklch(0.30 0 0)"
          strokeWidth="2"
        />
        {/* feature lane (only spans branch->merge or end) */}
        <line
          x1={RIGHT_X}
          y1={branchY}
          x2={RIGHT_X}
          y2={mergeY ?? totalH - 12}
          stroke="oklch(0.40 0.10 250)"
          strokeWidth="2"
        />
        {/* branch curve */}
        <path
          d={`M ${LEFT_X} ${branchY} C ${LEFT_X} ${branchY + 12}, ${RIGHT_X} ${branchY - 12}, ${RIGHT_X} ${branchY}`}
          stroke="oklch(0.40 0.10 250)"
          strokeWidth="2"
          fill="none"
        />
        {/* merge curve */}
        {mergeY != null && (
          <path
            d={`M ${RIGHT_X} ${mergeY} C ${RIGHT_X} ${mergeY + 12}, ${LEFT_X} ${mergeY - 12}, ${LEFT_X} ${mergeY}`}
            stroke="oklch(0.72 0.19 155)"
            strokeWidth="2"
            fill="none"
          />
        )}

        {/* Main branch label dot at top */}
        <circle cx={LEFT_X} cy={10} r={4} fill="oklch(0.55 0 0)" />

        {/* per-event nodes on the feature lane */}
        {events.map((e, i) => {
          const cy = i * ROW_H + 12
          const x = e.kind === 'dispatched' ? LEFT_X : RIGHT_X
          const r = e.kind === 'commit' || e.kind === 'pr_opened' ? 5 : 4
          return (
            <Fragment key={i}>
              <circle
                cx={x}
                cy={cy}
                r={r}
                fill={nodeColor(e)}
                stroke="oklch(0.10 0 0)"
                strokeWidth="1"
              />
              {e.status === 'pending' && (
                <circle
                  cx={x}
                  cy={cy}
                  r={r + 3}
                  fill="none"
                  stroke={nodeColor(e)}
                  strokeOpacity="0.4"
                  strokeWidth="1"
                />
              )}
            </Fragment>
          )
        })}
      </svg>

      <ul className="space-y-0 text-xs">
        <li className="h-3 text-3xs uppercase tracking-wider text-fg-faint flex items-center gap-2">
          <span className="font-mono">{baseBranch}</span>
          <span className="text-fg-faint">→</span>
          <span className="font-mono text-fg-secondary truncate">{branchName ?? 'feature/—'}</span>
        </li>
        {events.map((e, i) => (
          <li
            key={i}
            className="flex items-start gap-2"
            style={{ minHeight: `${ROW_H}px` }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-fg text-xs font-medium leading-tight truncate">
                  {e.label}
                </span>
                <span className="text-3xs text-fg-faint font-mono shrink-0">
                  {new Date(e.at).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {e.detail && (
                <div className="text-2xs text-fg-muted truncate" title={e.detail}>
                  {e.kind === 'pr_opened' && prUrl ? (
                    <a
                      href={prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
                    >
                      {e.detail}
                    </a>
                  ) : (
                    <span className="font-mono">{e.detail}</span>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
