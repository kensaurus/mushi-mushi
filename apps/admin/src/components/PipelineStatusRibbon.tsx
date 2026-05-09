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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminMode } from '../lib/mode'
import { useNavCounts } from '../lib/useNavCounts'

type Tone = 'ok' | 'warn' | 'danger' | 'idle'

// ----------------------------------------------------------------------------
// Persisted collapse state.
//
// The ribbon is page furniture — it sits at the top of every Advanced-mode
// route and steals ~64px of vertical real estate that operators on tall
// worklists (Reports, Fixes, Inventory) want back. Collapsing it leaves
// behind a single-row pill that still surfaces the worst-case stage tone,
// so users don't lose the "is anything red?" signal but reclaim the space
// for the page body. State persists in localStorage so the choice sticks
// across reloads — same pattern as focus mode + sidebar collapse.
// ----------------------------------------------------------------------------

const COLLAPSE_KEY = 'mushi:pipelineRibbon:collapsed:v1'

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSE_KEY) === '1'
}

function writeCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  } catch {
    // localStorage write can fail in private mode; non-fatal.
  }
}

// Severity rank for picking the "worst" stage to surface in the
// collapsed pill — higher = louder. Mirrors the at-a-glance triage
// the operator does when scanning the expanded ribbon.
const TONE_RANK: Record<Tone, number> = { idle: 0, ok: 1, warn: 2, danger: 3 }

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

const STAGE_BORDER_HEX: Record<RibbonTile['stage'], string> = {
  P: '#60a5fa',
  D: '#f5b544',
  C: '#fbbf24',
  A: '#34d399',
}

function PulseArrow({ fromHex, toHex }: { fromHex: string; toHex: string }) {
  const gId = `pa-${fromHex.slice(1)}-${toHex.slice(1)}`
  const animId = `pm-${fromHex.slice(1)}-${toHex.slice(1)}`
  // Marching dashes: same approach as HeroGradientEdge, no blur.
  return (
    <div className="hidden md:flex items-center justify-center w-8 shrink-0" aria-hidden="true">
      <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
        <defs>
          <linearGradient id={gId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={fromHex} />
            <stop offset="100%" stopColor={toHex} />
          </linearGradient>
        </defs>
        <style>{`
          @keyframes ${animId} {
            from { stroke-dashoffset: 14; }
            to   { stroke-dashoffset: 0; }
          }
        `}</style>
        {/* Faint base rail */}
        <path d="M2 10 L20 10" stroke={toHex} strokeWidth="1" strokeLinecap="round" opacity="0.25" />
        {/* Marching dashes */}
        <path
          d="M2 10 L20 10"
          stroke={`url(#${gId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="5 9"
          style={{ animation: `${animId} 0.9s linear infinite` }}
        />
        {/* Solid filled arrowhead */}
        <path d="M18 6 L24 10 L18 14 Z" fill={toHex} />
      </svg>
    </div>
  )
}

export function PipelineStatusRibbon() {
  const { isAdvanced } = useAdminMode()
  const nav = useNavCounts()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    writeCollapsed(collapsed)
  }, [collapsed])

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

  // Surface the loudest tile in the collapsed pill so users don't lose
  // the "is anything red?" signal when they trade ribbon density for
  // page real estate. `worst` is also used to tint the toggle chevron
  // when collapsed — a danger pulse should NOT be invisible just because
  // the operator collapsed the strip an hour ago and forgot.
  const worst = tiles.reduce<RibbonTile>((acc, t) => (TONE_RANK[t.tone] > TONE_RANK[acc.tone] ? t : acc), tiles[0])
  const worstTone = TONE_CLASS[worst.tone]

  if (collapsed) {
    return (
      <section
        role="status"
        aria-label="Pipeline pulse (collapsed — click to expand)"
        data-testid="pipeline-status-ribbon"
        data-collapsed="true"
        className="mb-3"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded="false"
          aria-controls="pipeline-status-ribbon-tiles"
          // Reads as a single chip rather than a card so collapsed mode
          // costs ~28px instead of the expanded ~64px. Tone-tints to the
          // worst stage so a danger condition still grabs the eye.
          className={`group flex items-center gap-2 w-full rounded-sm border ${worstTone.ring} bg-surface-raised/40 px-2.5 py-1.5 text-left motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
          title="Pipeline pulse — click to expand"
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${worstTone.dot}`} />
          <span className="text-2xs font-medium text-fg-secondary uppercase tracking-wider shrink-0">
            Pipeline
          </span>
          {/* Stage glyph row — every stage as a tinted single letter so
              the operator can scan all four tones in one glance even when
              the labels are hidden. */}
          <span className="flex items-center gap-1 shrink-0" aria-label="Stage tones">
            {tiles.map((t) => (
              <span
                key={t.stage}
                aria-label={`${t.label}: ${t.summary}`}
                title={`${t.label}: ${t.summary}`}
                className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[0.55rem] font-bold leading-none ${STAGE_TONE[t.stage]} ring-1 ring-inset ${TONE_CLASS[t.tone].ring}`}
              >
                {t.stage}
              </span>
            ))}
          </span>
          <span className={`text-2xs font-mono font-semibold truncate ${worstTone.label}`}>
            {worst.label}: {worst.summary}
          </span>
          <span aria-hidden className="ml-auto text-2xs text-fg-muted shrink-0 group-hover:text-fg motion-safe:transition-colors">
            Expand ▾
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      role="status"
      aria-label="Pipeline pulse"
      data-testid="pipeline-status-ribbon"
      data-collapsed="false"
      className="mb-3 rounded-md border border-edge bg-surface-raised/40 px-1.5 py-1.5"
    >
      {/* Header strip — provides the collapse affordance + a context label.
          Kept tight (one line) so the ribbon's vertical footprint barely
          grows from the previous version. */}
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <span className="text-3xs font-medium text-fg-faint uppercase tracking-wider">
          Pipeline pulse
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded="true"
          aria-controls="pipeline-status-ribbon-tiles"
          className="text-3xs text-fg-muted hover:text-fg motion-safe:transition-colors px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title="Collapse pipeline ribbon — leaves a single-line summary"
        >
          Collapse <span aria-hidden>▴</span>
        </button>
      </div>
      <div
        id="pipeline-status-ribbon-tiles"
        className="flex items-stretch gap-0 md:gap-0"
      >
        {tiles.map((tile, i) => {
          const tone = TONE_CLASS[tile.tone]
          const borderHex = STAGE_BORDER_HEX[tile.stage]
          return (
            <div key={tile.stage} className="flex items-stretch flex-1 min-w-0">
              <Link
                to={tile.to}
                className="group relative flex items-center gap-2 rounded-sm bg-surface px-2 py-1.5 motion-safe:transition-all motion-safe:duration-150 hover:bg-surface-overlay hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand flex-1 min-w-0"
                title={tile.summary}
                style={{
                  borderLeft: `3px solid ${borderHex}`,
                  borderTop: `1px solid ${borderHex}30`,
                  borderRight: `1px solid ${borderHex}30`,
                  borderBottom: `1px solid ${borderHex}30`,
                }}
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
              {i < tiles.length - 1 && (
                <PulseArrow
                  fromHex={borderHex}
                  toHex={STAGE_BORDER_HEX[tiles[i + 1].stage]}
                />
              )}
            </div>
          )
        })}
      </div>
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
