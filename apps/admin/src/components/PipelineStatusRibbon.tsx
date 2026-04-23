/**
 * FILE: apps/admin/src/components/PipelineStatusRibbon.tsx
 * PURPOSE: Always-on "pipeline pulse" ribbon mounted once at the top of the
 *          Advanced-mode main area. Gives operators an at-a-glance PDCA
 *          heartbeat regardless of which page they're on — so someone
 *          deep in Compliance still sees when Reports is clogged or
 *          Fixes is red. Charts-first layouts used to hide this signal
 *          behind two clicks; the ribbon promotes it to page furniture.
 *
 *          Design:
 *          - 4 tiles mirroring the 4 PDCA stages.
 *          - Each tile shows a single metric + one-line summary.
 *          - Tiles link directly to the relevant page so "huh, Plan is
 *            red" becomes "let me click it and see" in one motion.
 *          - Hidden in beginner / quickstart modes because those users
 *            already have the global NextBestAction strip; stacking two
 *            status bars would be noisy.
 *
 *          Data source:
 *            `useNavCounts()` — already polled + realtime-subscribed so
 *            we don't double-fetch. The hook returns the core counters
 *            (untriaged backlog, in-flight fixes, failed fixes, open PRs)
 *            which is enough to render the Plan / Do / Act tiles. Check
 *            uses a "judge freshness" heuristic from localStorage that
 *            HealthPage keeps up to date — the ribbon renders 'unknown'
 *            if the page has never been visited yet, never 5xx.
 */

import { Link } from 'react-router-dom'
import { useAdminMode } from '../lib/mode'
import { useNavCounts } from '../lib/useNavCounts'

type Tone = 'ok' | 'warn' | 'danger' | 'idle'

interface RibbonTile {
  stage: 'P' | 'D' | 'C' | 'A'
  label: string
  tone: Tone
  metric: string
  summary: string
  to: string
}

const TONE_CLASS: Record<Tone, { dot: string; ring: string; label: string }> = {
  ok:     { dot: 'bg-ok',      ring: 'border-ok/30',    label: 'text-ok' },
  warn:   { dot: 'bg-warn',    ring: 'border-warn/30',  label: 'text-warn' },
  danger: { dot: 'bg-danger',  ring: 'border-danger/30',label: 'text-danger' },
  idle:   { dot: 'bg-fg-faint',ring: 'border-edge',     label: 'text-fg-muted' },
}

const STAGE_TONE: Record<RibbonTile['stage'], string> = {
  P: 'bg-info-muted text-info',
  D: 'bg-brand/15 text-brand',
  C: 'bg-warn-muted text-warn',
  A: 'bg-ok-muted text-ok',
}

export function PipelineStatusRibbon() {
  const { isAdvanced } = useAdminMode()
  const nav = useNavCounts()

  // Only Advanced mode surfaces the ribbon — beginners and quickstart
  // users have the NextBestAction strip which is higher signal for their
  // level of context.
  if (!isAdvanced) return null

  // Plan: backlog of untriaged reports.
  const planTone: Tone =
    !nav.ready ? 'idle' : nav.untriagedBacklog === 0 ? 'ok' : nav.untriagedBacklog <= 5 ? 'warn' : 'danger'
  const plan: RibbonTile = {
    stage: 'P',
    label: 'Plan',
    tone: planTone,
    metric: nav.ready ? String(nav.untriagedBacklog) : '—',
    summary:
      !nav.ready
        ? 'Loading…'
        : nav.untriagedBacklog === 0
          ? 'Triage caught up'
          : `${nav.untriagedBacklog} untriaged report${nav.untriagedBacklog === 1 ? '' : 's'}`,
    to: '/reports?status=new',
  }

  // Do: active fix dispatch (red if any failed, amber if in-flight, green if idle).
  const doTone: Tone =
    !nav.ready
      ? 'idle'
      : nav.fixesFailed > 0
        ? 'danger'
        : nav.fixesInFlight > 0
          ? 'warn'
          : 'ok'
  const doTile: RibbonTile = {
    stage: 'D',
    label: 'Do',
    tone: doTone,
    metric:
      !nav.ready
        ? '—'
        : nav.fixesFailed > 0
          ? `${nav.fixesFailed} failed`
          : nav.fixesInFlight > 0
            ? `${nav.fixesInFlight} in-flight`
            : '0',
    summary:
      !nav.ready
        ? 'Loading…'
        : nav.fixesFailed > 0
          ? 'Fix dispatch needs attention'
          : nav.fixesInFlight > 0
            ? 'Fix worker is processing'
            : 'Fix queue is idle',
    to: nav.fixesFailed > 0 ? '/fixes?status=failed' : '/fixes',
  }

  // Check: judge freshness — HealthPage stamps localStorage on each load.
  // Falls back to 'unknown' so this never crashes on an empty tenant.
  const check = computeCheckTile()

  // Act: open PRs awaiting review — a non-zero count is *good* (it means
  // the pipeline produced output), but stale PRs (> 7 days) matter too.
  // Without a stale count on the summary endpoint we stay on "count only".
  const actTone: Tone = !nav.ready ? 'idle' : nav.prsOpen > 0 ? 'ok' : 'idle'
  const act: RibbonTile = {
    stage: 'A',
    label: 'Act',
    tone: actTone,
    metric: nav.ready ? String(nav.prsOpen) : '—',
    summary:
      !nav.ready
        ? 'Loading…'
        : nav.prsOpen === 0
          ? 'No PRs awaiting review'
          : `${nav.prsOpen} PR${nav.prsOpen === 1 ? '' : 's'} awaiting review`,
    to: '/repo?tab=prs',
  }

  const tiles: RibbonTile[] = [plan, doTile, check, act]

  return (
    <section
      role="status"
      aria-label="Pipeline pulse"
      data-testid="pipeline-status-ribbon"
      className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-1.5 rounded-md border border-edge bg-surface-raised/40 px-1.5 py-1.5"
    >
      {tiles.map((tile) => {
        const tone = TONE_CLASS[tile.tone]
        return (
          <Link
            key={tile.stage}
            to={tile.to}
            className={`group relative flex items-center gap-2 rounded-sm border ${tone.ring} bg-surface px-2 py-1.5 motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60`}
            title={tile.summary}
          >
            <span
              aria-hidden
              className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[0.55rem] font-bold leading-none shrink-0 ${STAGE_TONE[tile.stage]}`}
            >
              {tile.stage}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`}
                />
                <span className="text-2xs font-medium text-fg-secondary uppercase tracking-wider">
                  {tile.label}
                </span>
                <span className={`ml-auto text-2xs font-mono font-semibold ${tone.label}`}>
                  {tile.metric}
                </span>
              </span>
              <span className="block text-3xs text-fg-muted truncate leading-snug mt-0.5">
                {tile.summary}
              </span>
            </span>
          </Link>
        )
      })}
    </section>
  )
}

const JUDGE_FRESHNESS_KEY = 'mushi:health:judge-freshness-ts'

/**
 * Check tile reads a "last judge batch ran at" timestamp that HealthPage
 * writes to localStorage on every load. This keeps the ribbon honest
 * without the cost of its own poll — if the user never visits Health,
 * the tile stays on 'unknown' and simply encourages them to click it.
 */
function computeCheckTile(): RibbonTile {
  if (typeof window === 'undefined') {
    return {
      stage: 'C',
      label: 'Check',
      tone: 'idle',
      metric: '—',
      summary: 'Loading…',
      to: '/health',
    }
  }
  const raw = window.localStorage.getItem(JUDGE_FRESHNESS_KEY)
  const ts = raw ? Number(raw) : NaN
  if (!Number.isFinite(ts)) {
    return {
      stage: 'C',
      label: 'Check',
      tone: 'idle',
      metric: '—',
      summary: 'Open Health to seed judge freshness',
      to: '/health',
    }
  }
  const hoursAgo = (Date.now() - ts) / 3_600_000
  const tone: Tone = hoursAgo > 48 ? 'warn' : 'ok'
  return {
    stage: 'C',
    label: 'Check',
    tone,
    metric: hoursAgo < 1 ? '<1h' : `${Math.floor(hoursAgo)}h`,
    summary:
      hoursAgo > 48
        ? 'Judge batch is overdue'
        : 'Judge batch is fresh',
    to: '/health',
  }
}

/**
 * Public helper — HealthPage calls this after every successful judge
 * freshness load. Kept next to the ribbon so the key is co-located with
 * its reader.
 */
export function markJudgeBatchSeen(ts: number = Date.now()) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(JUDGE_FRESHNESS_KEY, String(ts))
  } catch {
    // localStorage write can fail in private mode; non-fatal.
  }
}
