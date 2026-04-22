/**
 * FILE: apps/admin/src/components/report-detail/ReportBranchGraph.tsx
 * PURPOSE: Surface the per-fix GitHub branch / PR / CI timeline directly on
 *          the report-detail page, so triagers can see the full PDCA loop
 *          (branch created → commit → PR opened → CI passed) without
 *          navigating to /fixes and expanding a card.
 *
 *          Reuses the existing `FixGitGraph` SVG component verbatim and
 *          wraps it with branch/PR/CI metadata rendered via our primitives
 *          (`CodeValue`, `Badge`, `DefinitionChips`). Collapsible with a
 *          localStorage-backed open/closed memory, polls `/timeline` while
 *          the fix is in flight so live fixes animate in.
 */

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { FixGitGraph, type FixTimelineEvent } from '../FixGitGraph'
import { Badge, CodeValue, DefinitionChips, type DefinitionChipItem } from '../ui'
import { IconGit } from '../icons'
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
  if (c) return `CI: ${c.replace(/_/g, ' ')}`
  const s = fix.check_run_status?.toLowerCase()
  if (s) return `CI: ${s.replace(/_/g, ' ')}`
  return 'CI: not started'
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

  // Parent (ReportDetailPage) renders this without a `key={fix.id}` and can
  // swap `fix` when a newer attempt lands for the same report. `useState`
  // initializers only run once, so without this effect `open` and the cached
  // `events` would bleed across attempts. Reset here instead of forcing every
  // caller to remember the key.
  const lastFixIdRef = useRef(fix.id)
  if (lastFixIdRef.current !== fix.id) {
    lastFixIdRef.current = fix.id
    setOpen(readOpen(fix.id, true))
    setEvents(null)
    setLoadError(false)
  }

  const isLive = fix.status === 'queued' || fix.status === 'running'
  // Poll while CI is still running too — so the "CI pending" → "CI success"
  // transition animates in without a manual refresh.
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
  const metaItems: DefinitionChipItem[] = []
  if (fix.branch) {
    metaItems.push({
      label: 'Branch',
      value: <CodeValue value={fix.branch} tone="hash" />,
    })
  }
  metaItems.push({
    label: 'CI status',
    value: <Badge className={badgeToneClass(tone)}>{ciLabel(fix)}</Badge>,
  })
  if (fix.pr_url) {
    metaItems.push({
      label: 'Pull request',
      value: (
        <a
          href={fix.pr_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono text-xs"
        >
          #{fix.pr_number ?? '—'} ↗
        </a>
      ),
    })
  }
  if (fix.pr_state) {
    const prStateTone: Record<string, string> = {
      merged: 'bg-[oklch(0.30_0.10_300)] text-[oklch(0.92_0.08_300)]',
      open: 'bg-ok-subtle text-ok',
      closed: 'bg-danger-subtle text-danger',
      draft: 'bg-surface-overlay text-fg-muted',
    }
    metaItems.push({
      label: 'PR state',
      value: (
        <Badge className={prStateTone[fix.pr_state] ?? 'bg-surface-overlay text-fg-muted'}>
          {fix.pr_state}
        </Badge>
      ),
    })
  }
  if (fix.commit_sha) {
    metaItems.push({
      label: 'Commit',
      value: <CodeValue value={fix.commit_sha.slice(0, 7)} tone="hash" />,
    })
  }
  if (fix.files_changed && fix.files_changed.length > 0) {
    metaItems.push({
      label: 'Files',
      value: (
        <span className="text-xs text-fg-secondary">
          {fix.files_changed.length} file{fix.files_changed.length === 1 ? '' : 's'}
        </span>
      ),
    })
  }
  if (traceUrl) {
    metaItems.push({
      label: 'Trace',
      value: (
        <a
          href={traceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:text-brand-hover underline-offset-2 hover:underline font-mono text-xs"
        >
          Langfuse ↗
        </a>
      ),
    })
  }

  return (
    <section
      className={`rounded-md border border-edge-subtle bg-surface-overlay/25 ${className}`}
      aria-label="Branch & PR timeline"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-overlay/40 rounded-t-md motion-safe:transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <IconGit />
          <span className="text-xs font-semibold tracking-wide text-fg-secondary">
            Branch & PR timeline
          </span>
          {shouldPoll && (
            <span className="flex items-center gap-1 text-3xs uppercase tracking-wider text-info font-medium">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-info motion-safe:animate-pulse"
                aria-hidden="true"
              />
              <span>live</span>
              <span
                className="text-fg-faint font-mono normal-case tracking-normal"
                aria-live="polite"
              >
                · refreshes in {secondsToNextPoll}s
              </span>
            </span>
          )}
        </span>
        <span className="text-2xs text-fg-faint font-mono shrink-0" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-edge-subtle pt-2.5">
          {metaItems.length > 0 && <DefinitionChips items={metaItems} columns="auto" dense />}
          {events ? (
            events.length === 0 ? (
              <p className="text-2xs text-fg-faint">
                No timeline events yet — the fix worker will post updates here as
                it runs.
              </p>
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
            <p className="text-2xs text-danger">
              Could not load timeline. It'll retry on the next refresh.
            </p>
          ) : (
            <p className="text-2xs text-fg-faint">Loading timeline…</p>
          )}
        </div>
      )}
    </section>
  )
}
