/**
 * FILE: apps/admin/src/components/FixGitGraph.tsx
 * PURPOSE: Inline SVG branch-graph for one fix attempt. Walks the
 *          /v1/admin/fixes/:id/timeline events (dispatched → branch →
 *          commit → PR → CI → merge/fail) and renders them as a vertical
 *          GitHub-style commit lane with the main branch on the left.
 *
 *          Interactive: each node is a focusable button with a rich hover
 *          tooltip (kind / status / exact timestamp / agent model / detail).
 *          Clicking / focusing a node highlights the matching row in the
 *          event list (keyboard accessible via Tab + Enter/Space).
 *
 *          Link-outs: when we have a PR URL we derive the repo base
 *          (`https://github.com/{owner}/{repo}`) and link commit SHAs,
 *          branch names, and CI rows directly to GitHub. The PR number
 *          stays a link too.
 *
 *          Diff peek: clicking a commit node opens a lightweight
 *          dialog showing `files_changed[]`, line count, and a link
 *          out to the GitHub commit diff.
 *
 *          Live state: while the parent reports `live`, pending-status
 *          nodes get an animated pulsing halo so the graph visibly
 *          breathes instead of looking frozen.
 */

import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Modal } from './Modal'
import { Badge, CodeValue } from './ui'

export interface FixTimelineEvent {
  // Lock-step with the DB constraint on `fix_events.kind`
  // (20260422060000_fix_events_and_pr_state.sql), the API timeline builder
  // in packages/server/.../api/index.ts, and the webhook emitter in
  // webhooks-github-indexer. Drift here silently produces
  // `"undefined"` tooltips — `kindLabel` relies on switch exhaustiveness.
  kind:
    | 'dispatched'
    | 'started'
    | 'branch'
    | 'commit'
    | 'pr_opened'
    | 'ci_started'
    | 'ci_resolved'
    | 'pr_state_changed'
    | 'completed'
    | 'failed'
  at: string
  label: string
  detail?: string | null
  status?: 'ok' | 'fail' | 'pending' | null
}

export type PrState = 'open' | 'closed' | 'merged' | 'draft'

interface FixGitGraphProps {
  events: FixTimelineEvent[]
  prUrl?: string | null
  prNumber?: number | null
  /** GitHub PR lifecycle state. Renders a colored badge next to the pr_opened row. */
  prState?: PrState | null
  branchName?: string | null
  baseBranch?: string
  /** When provided, the commit node links out to GitHub and opens the diff dialog. */
  commitSha?: string | null
  /** Agent model (e.g. "claude-3-5-sonnet") — surfaces in node tooltips. */
  agentModel?: string | null
  /** File list — rendered in the commit diff modal. */
  filesChanged?: string[] | null
  /** Lines changed — rendered in the commit diff modal. */
  linesChanged?: number | null
  /** Bubble selection state up to callers (e.g. ReportBranchGraph heading). */
  onSelectEvent?: (index: number | null, event: FixTimelineEvent | null) => void
  className?: string
}

const STATUS_COLOR: Record<string, string> = {
  ok: 'oklch(0.72 0.19 155)',
  fail: 'oklch(0.65 0.22 25)',
  pending: 'oklch(0.68 0.16 240)',
  default: 'oklch(0.55 0 0)',
}

const PR_STATE_TONE: Record<PrState, string> = {
  open: 'bg-ok-subtle text-ok',
  merged: 'bg-[oklch(0.30_0.10_300)] text-[oklch(0.92_0.08_300)]',
  closed: 'bg-danger-subtle text-danger',
  draft: 'bg-surface-overlay text-fg-muted',
}

function nodeColor(e: FixTimelineEvent): string {
  if (e.status === 'fail') return STATUS_COLOR.fail
  if (e.status === 'pending') return STATUS_COLOR.pending
  if (e.status === 'ok') return STATUS_COLOR.ok
  return STATUS_COLOR.default
}

function kindLabel(kind: FixTimelineEvent['kind']): string {
  switch (kind) {
    case 'dispatched':
      return 'Dispatched'
    case 'started':
      return 'Agent started'
    case 'branch':
      return 'Branch'
    case 'commit':
      return 'Commit'
    case 'pr_opened':
      return 'PR opened'
    case 'ci_started':
      return 'CI running'
    case 'ci_resolved':
      return 'CI finished'
    case 'pr_state_changed':
      return 'PR state changed'
    case 'completed':
      return 'Fix completed'
    case 'failed':
      return 'Fix failed'
  }
}

/**
 * Build a tooltip string shown on SVG hover via <title> (native) and on the
 * row via title= (native). Keeps browser-native tooltips as a no-JS fallback
 * while the selection ring handles the rich visual state.
 */
function tooltipFor(
  e: FixTimelineEvent,
  agentModel?: string | null,
): string {
  const parts = [kindLabel(e.kind)]
  if (e.status) parts.push(`status: ${e.status}`)
  parts.push(new Date(e.at).toISOString())
  if (e.detail && e.detail !== agentModel) parts.push(e.detail)
  if (e.kind === 'started' && agentModel) parts.push(`model: ${agentModel}`)
  return parts.join('  ·  ')
}

/**
 * Derive `https://github.com/{owner}/{repo}` from any PR URL
 * (`https://github.com/owner/repo/pull/123`). Returns null when we can't
 * parse it — callers then skip link-outs gracefully.
 */
function repoBaseFromPrUrl(prUrl?: string | null): string | null {
  if (!prUrl) return null
  const m = prUrl.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/)
  return m ? m[1] : null
}

const ROW_H = 36
const LEFT_X = 14
const RIGHT_X = 60

export function FixGitGraph({
  events,
  prUrl,
  prNumber,
  prState,
  branchName,
  baseBranch = 'main',
  commitSha,
  agentModel,
  filesChanged,
  linesChanged,
  onSelectEvent,
  className = '',
}: FixGitGraphProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)

  const repoBase = useMemo(() => repoBaseFromPrUrl(prUrl), [prUrl])
  const commitUrl = useMemo(() => {
    if (!repoBase || !commitSha) return null
    return `${repoBase}/commit/${commitSha}`
  }, [repoBase, commitSha])
  const branchUrl = useMemo(() => {
    if (!repoBase || !branchName) return null
    return `${repoBase}/tree/${encodeURIComponent(branchName)}`
  }, [repoBase, branchName])
  const checksUrl = useMemo(() => (prUrl ? `${prUrl}/checks` : null), [prUrl])

  if (!events || events.length === 0) {
    return (
      <p className={`text-2xs text-fg-faint ${className}`}>No timeline events yet.</p>
    )
  }

  const select = (i: number | null) => {
    setSelectedIdx(i)
    onSelectEvent?.(i, i == null ? null : events[i])
  }

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, i: number, ev: FixTimelineEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      select(i)
      if (ev.kind === 'commit' && (commitSha || (filesChanged && filesChanged.length > 0))) {
        setDiffOpen(true)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      select(Math.min((selectedIdx ?? -1) + 1, events.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      select(Math.max((selectedIdx ?? events.length) - 1, 0))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      select(null)
    }
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

        {/* per-event nodes on the feature lane — each is a focusable button */}
        {events.map((e, i) => {
          const cy = i * ROW_H + 12
          const x = e.kind === 'dispatched' ? LEFT_X : RIGHT_X
          const r = e.kind === 'commit' || e.kind === 'pr_opened' ? 5 : 4
          const selected = selectedIdx === i
          const canDiff = e.kind === 'commit' && (commitSha || (filesChanged && filesChanged.length > 0))
          return (
            <g
              key={i}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={tooltipFor(e, agentModel)}
              className="cursor-pointer outline-none focus-visible:[&_circle]:stroke-[oklch(0.75_0.18_240)]"
              onClick={() => {
                select(i)
                if (canDiff) setDiffOpen(true)
              }}
              onKeyDown={(ev) => onNodeKey(ev, i, e)}
              onMouseEnter={() => select(i)}
              onFocus={() => select(i)}
              onBlur={() => {
                // only clear if focus moved outside graph (leave hover-selected)
              }}
            >
              <title>{tooltipFor(e, agentModel)}</title>
              {/* invisible hit-target so tiny circles are easy to click */}
              <circle cx={x} cy={cy} r={10} fill="transparent" />
              {/* selection halo */}
              {selected && (
                <circle
                  cx={x}
                  cy={cy}
                  r={r + 4}
                  fill="none"
                  stroke="oklch(0.82 0.16 240)"
                  strokeWidth="1.5"
                />
              )}
              <circle
                cx={x}
                cy={cy}
                r={r}
                fill={nodeColor(e)}
                stroke="oklch(0.10 0 0)"
                strokeWidth="1"
              />
              {e.status === 'pending' && (
                <>
                  {/* Static outer ring (no-motion safe) */}
                  <circle
                    cx={x}
                    cy={cy}
                    r={r + 3}
                    fill="none"
                    stroke={nodeColor(e)}
                    strokeOpacity="0.4"
                    strokeWidth="1"
                  />
                  {/* Animated pulse — only plays when the user hasn't requested reduced motion */}
                  <circle
                    cx={x}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={nodeColor(e)}
                    strokeWidth="1.5"
                    className="motion-safe:[animation:mushi-git-pulse_1.8s_ease-out_infinite]"
                  />
                </>
              )}
            </g>
          )
        })}
      </svg>

      <ul className="space-y-0 text-xs">
        <li className="h-3 text-3xs uppercase tracking-wider text-fg-faint flex items-center gap-2">
          <span className="font-mono">{baseBranch}</span>
          <span className="text-fg-faint">→</span>
          {branchUrl && branchName ? (
            <a
              href={branchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-fg-secondary truncate hover:text-brand underline-offset-2 hover:underline"
              title={`View branch ${branchName} on GitHub`}
            >
              {branchName}
            </a>
          ) : (
            <span className="font-mono text-fg-secondary truncate">
              {branchName ?? 'feature/—'}
            </span>
          )}
          {prState && (
            <Badge className={`${PR_STATE_TONE[prState]} text-3xs uppercase tracking-wider`}>
              {prState}
            </Badge>
          )}
        </li>
        {events.map((e, i) => {
          const selected = selectedIdx === i
          const canDiff = e.kind === 'commit' && (commitSha || (filesChanged && filesChanged.length > 0))
          return (
            <li
              key={i}
              className={[
                'flex items-start gap-2 rounded-sm px-1 -mx-1 motion-safe:transition-colors',
                selected ? 'bg-brand/10 ring-1 ring-brand/40' : '',
              ].join(' ')}
              style={{ minHeight: `${ROW_H}px` }}
              aria-current={selected ? 'true' : undefined}
              onMouseEnter={() => select(i)}
              onClick={() => {
                select(i)
                if (canDiff) setDiffOpen(true)
              }}
              title={tooltipFor(e, agentModel)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-fg text-xs font-medium leading-tight truncate">
                    {e.label}
                  </span>
                  <span
                    className="text-3xs text-fg-faint font-mono shrink-0"
                    title={new Date(e.at).toISOString()}
                  >
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
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {prNumber ? `#${prNumber}` : e.detail} ↗
                      </a>
                    ) : e.kind === 'commit' && commitUrl ? (
                      <a
                        href={commitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {commitSha ? commitSha.slice(0, 7) : e.detail} ↗
                      </a>
                    ) : e.kind === 'branch' && branchUrl ? (
                      <a
                        href={branchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.detail} ↗
                      </a>
                    ) : (e.kind === 'ci_started' || e.kind === 'ci_resolved') && checksUrl ? (
                      <a
                        href={checksUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.detail} ↗
                      </a>
                    ) : (
                      <span className="font-mono">{e.detail}</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {diffOpen && (
        <CommitDiffModal
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          commitSha={commitSha}
          commitUrl={commitUrl}
          filesChanged={filesChanged ?? []}
          linesChanged={linesChanged ?? null}
          branchName={branchName}
        />
      )}
    </div>
  )
}

interface CommitDiffModalProps {
  open: boolean
  onClose: () => void
  commitSha?: string | null
  commitUrl?: string | null
  filesChanged: string[]
  linesChanged: number | null
  branchName?: string | null
}

function CommitDiffModal({
  open,
  onClose,
  commitSha,
  commitUrl,
  filesChanged,
  linesChanged,
  branchName,
}: CommitDiffModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span>Commit diff</span>
          {commitSha && <CodeValue value={commitSha.slice(0, 7)} tone="hash" />}
        </span>
      }
      headerAction={
        commitUrl && (
          <a
            href={commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono"
          >
            View on GitHub ↗
          </a>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {branchName && (
            <>
              <span>on branch</span>
              <CodeValue value={branchName} tone="hash" />
            </>
          )}
          {linesChanged != null && (
            <span className="text-fg-secondary">
              · {linesChanged.toLocaleString()} line{linesChanged === 1 ? '' : 's'} changed
            </span>
          )}
          <span className="text-fg-secondary">
            · {filesChanged.length} file{filesChanged.length === 1 ? '' : 's'}
          </span>
        </div>
        {filesChanged.length === 0 ? (
          <p className="text-xs text-fg-faint">
            No file list recorded for this commit. Open on GitHub for the full diff.
          </p>
        ) : (
          <ul className="divide-y divide-edge-subtle rounded-sm border border-edge-subtle bg-surface/30 overflow-hidden">
            {filesChanged.map((path, i) => (
              <li
                key={`${path}-${i}`}
                className="flex items-center gap-2 px-2.5 py-1.5 text-2xs"
              >
                <span className="text-fg-faint font-mono shrink-0" aria-hidden="true">
                  +
                </span>
                <CodeValue value={path} tone="neutral" className="wrap-anywhere" />
              </li>
            ))}
          </ul>
        )}
        <p className="text-3xs text-fg-faint">
          Inline diffs aren't embedded yet — click "View on GitHub" above for the
          full patch with syntax highlighting.
        </p>
      </div>
    </Modal>
  )
}
