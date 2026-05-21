/**
 * FILE: apps/admin/src/components/report-detail/ReportBranchGraph.tsx
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch } from '../../lib/supabase'
import { FixGitGraph, type FixTimelineEvent } from '../FixGitGraph'
import { Badge, DetailRows } from '../ui'
import { IconGit } from '../icons'
import { EmptySectionMessage } from './ReportClassification'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from './ReportSurface'
import type { ReportFixAttempt } from './types'

interface Props {
  fix: ReportFixAttempt
  traceUrl?: string | null
  className?: string
}

const OPEN_KEY_PREFIX = 'mushi.report-branchgraph.open:'

function readOpen(fixId: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(OPEN_KEY_PREFIX + fixId)
    if (raw == null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

function persistOpen(fixId: string, open: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPEN_KEY_PREFIX + fixId, open ? '1' : '0')
  } catch {
    /* best-effort */
  }
}

function ciTone(conclusion?: string | null, status?: string | null):
  | 'neutral'
  | 'info'
  | 'ok'
  | 'warn'
  | 'danger' {
  const c = conclusion?.toLowerCase()
  if (c === 'success') return 'ok'
  if (c === 'failure' || c === 'timed_out') return 'danger'
  if (c === 'action_required') return 'warn'
  const s = status?.toLowerCase()
  if (s === 'in_progress' || s === 'queued' || s === 'pending') return 'info'
  return 'neutral'
}

function ciLabel(fix: ReportFixAttempt): string {
  const c = fix.check_run_conclusion?.toLowerCase()
  if (c) return c.replace(/_/g, ' ')
  const s = fix.check_run_status?.toLowerCase()
  if (s) return s.replace(/_/g, ' ')
  return 'not started'
}

function badgeToneClass(
  tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger',
): string {
  switch (tone) {
    case 'ok':
      return 'bg-ok-subtle text-ok'
    case 'danger':
      return 'bg-danger-subtle text-danger'
    case 'warn':
      return 'bg-warn-subtle text-warn'
    case 'info':
      return 'bg-info-subtle text-info'
    default:
      return 'bg-surface-overlay text-fg-muted'
  }
}

const POLL_INTERVAL_MS = 15000

export function ReportBranchGraph({ fix, traceUrl, className = '' }: Props) {
  const [open, setOpen] = useState(() => readOpen(fix.id, true))
  const [events, setEvents] = useState<FixTimelineEvent[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [secondsToNextPoll, setSecondsToNextPoll] = useState<number>(POLL_INTERVAL_MS / 1000)
  const cancelledRef = useRef(false)

  const lastFixIdRef = useRef(fix.id)
  if (lastFixIdRef.current !== fix.id) {
    lastFixIdRef.current = fix.id
    setOpen(readOpen(fix.id, true))
    setEvents(null)
    setLoadError(false)
  }

  const isLive = fix.status === 'queued' || fix.status === 'running'
  const isCiPending = (() => {
    const c = fix.check_run_conclusion?.toLowerCase()
    if (c) return false
    const s = fix.check_run_status?.toLowerCase()
    return s === 'in_progress' || s === 'queued' || s === 'pending'
  })()
  const shouldPoll = isLive || isCiPending

  useEffect(() => {
    cancelledRef.current = false
    let timer: ReturnType<typeof setInterval> | null = null
    let countdownTimer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const res = await apiFetch<{ events: FixTimelineEvent[] }>(
          `/v1/admin/fixes/${fix.id}/timeline`,
        )
        if (cancelledRef.current) return
        if (res.ok && res.data) setEvents(res.data.events)
        else setLoadError(true)
      } catch {
        if (!cancelledRef.current) setLoadError(true)
      }
      if (!cancelledRef.current) {
        setSecondsToNextPoll(POLL_INTERVAL_MS / 1000)
      }
    }

    void load()
    if (shouldPoll) {
      timer = setInterval(load, POLL_INTERVAL_MS)
      countdownTimer = setInterval(() => {
        if (cancelledRef.current) return
        setSecondsToNextPoll((prev) => (prev > 1 ? prev - 1 : POLL_INTERVAL_MS / 1000))
      }, 1000)
    }

    return () => {
      cancelledRef.current = true
      if (timer) clearInterval(timer)
      if (countdownTimer) clearInterval(countdownTimer)
    }
  }, [fix.id, shouldPoll])

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      persistOpen(fix.id, next)
      return next
    })
  }

  const tone = ciTone(fix.check_run_conclusion, fix.check_run_status)
  const ciSignalTone =
    tone === 'ok' ? 'info' : tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'neutral'

  const prStateTone: Record<string, string> = {
    merged: 'bg-[oklch(0.30_0.10_300)] text-[oklch(0.92_0.08_300)]',
    open: 'bg-ok-subtle text-ok',
    closed: 'bg-danger-subtle text-danger',
    draft: 'bg-surface-overlay text-fg-muted',
  }

  const metaRows = [
    fix.branch
      ? {
          label: 'Branch',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-2xs text-fg-secondary">
              {fix.branch}
            </code>
          ),
          wrap: true,
        }
      : null,
    {
      label: 'CI status',
      value: <Badge className={badgeToneClass(tone)}>{ciLabel(fix)}</Badge>,
    },
    fix.pr_state
      ? {
          label: 'PR state',
          value: (
            <Badge className={prStateTone[fix.pr_state] ?? 'bg-surface-overlay text-fg-muted'}>
              {fix.pr_state}
            </Badge>
          ),
        }
      : null,
    fix.commit_sha
      ? {
          label: 'Commit',
          value: (
            <code className="rounded-sm border border-edge-subtle bg-surface-overlay/45 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-fg">
              {fix.commit_sha.slice(0, 7)}
            </code>
          ),
        }
      : null,
    fix.files_changed && fix.files_changed.length > 0
      ? {
          label: 'Diff size',
          value: (
            <span className="inline-flex items-center gap-1">
              <SignalChip tone="neutral" className="font-mono">
                {fix.files_changed.length} file{fix.files_changed.length === 1 ? '' : 's'}
              </SignalChip>
              {fix.lines_changed != null && (
                <SignalChip tone="brand" className="font-mono tabular-nums">
                  {fix.lines_changed} lines
                </SignalChip>
              )}
            </span>
          ),
        }
      : null,
    fix.agent || fix.llm_model
      ? {
          label: 'Agent',
          value: (
            <code className="font-mono text-2xs text-fg-secondary">
              {fix.llm_model ?? fix.agent}
            </code>
          ),
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: ReactNode; wrap?: boolean }>

  return (
    <section
      className={`overflow-hidden rounded-md border border-edge-subtle bg-surface-overlay/25 ${className}`}
      aria-label="Branch & PR timeline"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-t-md px-3 py-2.5 text-left hover:bg-surface-overlay/40 motion-safe:transition-colors"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <IconGit />
          <span className="text-xs font-semibold tracking-wide text-fg-secondary">
            Branch & PR timeline
          </span>
          {fix.pr_number && (
            <SignalChip tone="brand" className="font-mono">
              PR #{fix.pr_number}
            </SignalChip>
          )}
          <SignalChip tone={ciSignalTone as 'info' | 'danger' | 'warn' | 'neutral'} className="uppercase tracking-wide">
            CI · {ciLabel(fix)}
          </SignalChip>
          {shouldPoll && (
            <SignalChip tone="info" className="gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-info motion-safe:animate-pulse" aria-hidden />
              live · {secondsToNextPoll}s
            </SignalChip>
          )}
        </span>
        <span className="shrink-0 rounded-sm border border-edge-subtle bg-surface-overlay/40 px-1.5 py-0.5 font-mono text-2xs text-fg-faint" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-edge-subtle px-3 pb-3 pt-2.5">
          {metaRows.length > 0 && <DetailRows dense items={metaRows} />}

          <ActionPillRow>
            {fix.pr_url && (
              <ActionPill href={fix.pr_url} tone="brand">
                View PR{fix.pr_number ? ` #${fix.pr_number}` : ''} ↗
              </ActionPill>
            )}
            {traceUrl && (
              <ActionPill href={traceUrl} tone="neutral">
                Langfuse trace ↗
              </ActionPill>
            )}
            {fix.branch && fix.pr_url && (
              <ActionPill
                href={`${fix.pr_url.replace(/\/pull\/\d+.*/, '')}/tree/${encodeURIComponent(fix.branch)}`}
                tone="neutral"
              >
                Branch on GitHub ↗
              </ActionPill>
            )}
          </ActionPillRow>

          <ContainedBlock label="Pipeline events" tone="muted">
            {events ? (
              events.length === 0 ? (
                <EmptySectionMessage
                  text="No timeline events yet."
                  hint="The fix worker will post branch, commit, and PR updates here as it runs."
                />
              ) : (
                <FixGitGraph
                  events={events}
                  prUrl={fix.pr_url}
                  prNumber={fix.pr_number}
                  prState={fix.pr_state}
                  branchName={fix.branch}
                  commitSha={fix.commit_sha}
                  agentModel={fix.llm_model ?? fix.agent}
                  filesChanged={fix.files_changed}
                  linesChanged={fix.lines_changed}
                />
              )
            ) : loadError ? (
              <EmptySectionMessage
                text="Could not load timeline."
                hint="It will retry on the next refresh."
              />
            ) : (
              <p className="rounded-sm border border-edge-subtle/50 bg-surface-overlay/30 px-2 py-1 text-2xs text-fg-faint">
                Loading timeline…
              </p>
            )}
          </ContainedBlock>
        </div>
      )}
    </section>
  )
}
