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

import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Tooltip } from './ui'
import { CHIP_TONE } from '../lib/chipTone'
import { useAdminMode } from '../lib/mode'
import { useNavCounts } from '../lib/useNavCounts'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import { useActiveProjectId } from './ProjectSwitcher'
import { readJudgeStaleHours } from '../lib/judgeFreshness'
import { hasPageOwnedHero } from '../lib/pageHeroOwnership'
import { shouldDefaultCollapsePipelineRibbon } from '../lib/chromeLayers'
import { shouldShowPipelineRibbon } from '../lib/pipelineRibbonVisibility'
import type { PdcaStageId } from '../lib/pdca'

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
const DASHBOARD_COLLAPSE_KEY = 'mushi:pipelineRibbon:dashboardCollapsed:v1'

/** User preference on layout-fallback routes (billing, …). */
function readGlobalRibbonCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  const stored = window.localStorage.getItem(COLLAPSE_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return false
}

function readDashboardRibbonCollapsed(): boolean {
  if (typeof window === 'undefined') return true
  const stored = window.localStorage.getItem(DASHBOARD_COLLAPSE_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return true
}

function ribbonCollapsePersists(pathname: string): boolean {
  return !hasPageOwnedHero(pathname) && pathname !== '/dashboard'
}

function readInitialCollapsed(pathname: string): boolean {
  if (shouldDefaultCollapsePipelineRibbon(pathname)) return readDashboardRibbonCollapsed()
  if (hasPageOwnedHero(pathname)) return true
  return readGlobalRibbonCollapsed()
}

function writeCollapsed(pathname: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const key = pathname === '/dashboard' ? DASHBOARD_COLLAPSE_KEY : COLLAPSE_KEY
    window.localStorage.setItem(key, value ? '1' : '0')
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
  P: CHIP_TONE.infoSubtle,
  D: 'bg-brand-subtle text-brand border border-brand/35',
  C: CHIP_TONE.warnSubtle,
  A: CHIP_TONE.okSubtle,
}

const STAGE_BORDER: Record<RibbonTile['stage'], string> = {
  P: 'border-l-info',
  D: 'border-l-brand',
  C: 'border-l-warn',
  A: 'border-l-ok',
}

const BOTTLENECK_TO_RIBBON_STAGE: Record<PdcaStageId, RibbonTile['stage']> = {
  plan: 'P',
  do: 'D',
  check: 'C',
  act: 'A',
}

/** Arrow connectors read theme tokens so light/dark stay in sync. */
const STAGE_ARROW: Record<RibbonTile['stage'], string> = {
  P: 'var(--color-info)',
  D: 'var(--color-brand)',
  C: 'var(--color-warn)',
  A: 'var(--color-ok)',
}

function PulseArrow({
  fromColor,
  toColor,
  fromLabel,
  toLabel,
  animated = false,
}: {
  fromColor: string
  toColor: string
  fromLabel: string
  toLabel: string
  /** Marching dashes — only when pipeline needs attention. */
  animated?: boolean
}) {
  const gId = `pa-${fromColor.replace(/\W/g, '')}-${toColor.replace(/\W/g, '')}`
  const animId = `pm-${fromColor.replace(/\W/g, '')}-${toColor.replace(/\W/g, '')}`
  const fullLabel = `${fromLabel} → ${toLabel}`
  const shortLabel = `${fromLabel}→${toLabel}`

  return (
    <Tooltip content={fullLabel} side="top" portal>
      <div
        // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
        className="relative z-[1] hidden md:flex flex-col items-center justify-center shrink-0 w-16 lg:w-[4.5rem] xl:w-20 px-0.5 self-center overflow-visible pt-3"
        aria-label={fullLabel}
        role="img"
      >
        {/* HTML pill — SVG text was clipped by neighbouring tiles in the narrow gutter.
            Tint to the source stage colour so the pill matches the arrow's gradient origin
            (NN/g #6 Recognition over Recall — colour signals direction without reading copy). */}
        <span
          className="absolute top-0 left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap rounded-full border bg-surface-overlay px-1.5 py-px text-2xs font-semibold uppercase tracking-wide shadow-sm pointer-events-none"
          style={{ color: fromColor, borderColor: fromColor }}
          title={fullLabel}
        >
          {shortLabel}
        </span>
        <svg width="64" height="28" viewBox="0 0 64 28" fill="none" className="w-full h-auto">
          <defs>
            <linearGradient id={gId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={fromColor} />
              <stop offset="100%" stopColor={toColor} />
            </linearGradient>
          </defs>
          {animated && (
            <style>{`
              @keyframes ${animId} {
                from { stroke-dashoffset: 18; }
                to   { stroke-dashoffset: 0; }
              }
            `}</style>
          )}
          {/* Surface casing */}
          <path d="M2 16 L42 16" stroke="var(--color-surface-root)" strokeWidth="8" strokeLinecap="round" />
          {/* Wide track */}
          <path d="M2 16 L42 16" stroke={toColor} strokeWidth="6" strokeLinecap="round" opacity="0.22" />
          {/* Base rail */}
          <path d="M2 16 L42 16" stroke={toColor} strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
          {/* Gradient dashes */}
          <path
            d="M2 16 L42 16"
            stroke={`url(#${gId})`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={animated ? '7 9' : 'none'}
            style={{ animation: animated ? `${animId} 0.85s linear infinite` : 'none' }}
          />
          {/* Arrowhead */}
          <path d="M38 11 L52 16 L38 21 Z" fill="var(--color-surface-root)" />
          <path d="M40 12.5 L49 16 L40 19.5 Z" fill={toColor} stroke="var(--color-surface-root)" strokeWidth="0.75" />
        </svg>
      </div>
    </Tooltip>
  )
}

const STAGE_FLOW_LABEL: Record<RibbonTile['stage'], string> = {
  P: 'Triage',
  D: 'Fix',
  C: 'Judge',
  A: 'Ship',
}

export function PipelineStatusRibbon({ embedded = false }: { embedded?: boolean }) {
  const { isAdvanced } = useAdminMode()
  const { pathname } = useLocation()
  const nav = useNavCounts()
  const snapshots = useProjectSnapshots()
  const activeProjectId = useActiveProjectId()
  const focusBottleneck = activeProjectId
    ? snapshots.byId.get(activeProjectId)?.pdca_bottleneck ?? null
    : null
  const focusRibbonStage = focusBottleneck
    ? BOTTLENECK_TO_RIBBON_STAGE[focusBottleneck]
    : null
  const [collapsed, setCollapsed] = useState(() => readInitialCollapsed(pathname))

  // Page-owned routes always start collapsed so only one DAV strip is expanded.
  // Manual expand on those routes is session-only — preference persists only on
  // layout-fallback routes where the ribbon is the sole hero chrome.
  useEffect(() => {
    if (hasPageOwnedHero(pathname) || shouldDefaultCollapsePipelineRibbon(pathname)) {
      setCollapsed(readInitialCollapsed(pathname))
    } else {
      setCollapsed(readGlobalRibbonCollapsed())
    }
  }, [pathname])

  useEffect(() => {
    if (ribbonCollapsePersists(pathname)) {
      writeCollapsed(pathname, collapsed)
    }
  }, [collapsed, pathname])

  // Only Advanced mode surfaces the ribbon — beginners and quickstart
  // users have the NextBestAction strip which is higher signal for their
  // level of context.
  if (!isAdvanced) return null

  // Workspace timeline only on PDCA hub routes — not billing, projects, etc.
  if (!shouldShowPipelineRibbon(pathname)) return null

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

  // Check: judge disagreements + freshness — disagreements trump stale batch.
  const check = computeCheckTile(nav.judgeDisagreements)

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
  const arrowsAnimated = worst.tone === 'warn' || worst.tone === 'danger'
  const collapsedTooltip = tiles
    .map((t) => `${t.label}: ${t.metric} — ${t.summary}`)
    .join('\n')

  if (collapsed && !embedded) {
    return (
      <section
        role="status"
        aria-label="Pipeline pulse (collapsed — click to expand)"
        data-testid="pipeline-status-ribbon"
        data-collapsed="true"
        className="mb-3"
      >
        <Tooltip content={<span className="whitespace-pre-wrap text-2xs leading-relaxed">{collapsedTooltip}</span>} side="bottom" nowrap={false} portal>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded="false"
          aria-controls="pipeline-status-ribbon-tiles"
          // Reads as a single chip rather than a card so collapsed mode
          // costs ~28px instead of the expanded ~64px. Tone-tints to the
          // worst stage so a danger condition still grabs the eye.
          className={`group flex items-center gap-2 w-full rounded-sm bg-surface-overlay px-2.5 py-1.5 text-left motion-safe:transition-opacity hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
          title="Pipeline pulse — click to expand"
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${worstTone.dot}`} />
          <span className="text-2xs font-medium text-fg-secondary uppercase tracking-wider shrink-0">
            Workspace pipeline
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
                className={`inline-flex items-center justify-center w-5 h-5 rounded-sm text-2xs font-bold leading-none ${STAGE_TONE[t.stage]} ring-1 ring-inset ${TONE_CLASS[t.tone].ring}`}
              >
                {t.stage}
              </span>
            ))}
          </span>
          <span className={`text-2xs font-mono font-semibold truncate ${worstTone.label}`}>
            {worst.label}: {worst.summary}
          </span>
          <span aria-hidden className="ml-auto shrink-0 text-2xs text-fg-muted group-hover:text-fg motion-safe:transition-opacity">
            Expand ▾
          </span>
        </button>
        </Tooltip>
      </section>
    )
  }

  return (
    <section
      role="status"
      aria-label="Pipeline pulse"
      data-testid="pipeline-status-ribbon"
      data-collapsed="false"
      className={
        embedded
          ? 'w-full px-1 py-1'
          : 'mb-3 w-full rounded-md border border-edge-subtle bg-surface-raised shadow-card px-1 py-1'
      }
    >
      {!embedded && (
      <div className="flex items-center justify-between gap-2 px-2 pb-1 border-b border-edge-subtle/50">
        <span className="flex items-center gap-2 text-2xs font-medium text-fg-faint uppercase tracking-wider">
          Workspace pipeline
          {!nav.ready && (
            <span className="inline-block h-1.5 w-8 animate-pulse rounded-full bg-fg-faint/30" aria-label="Loading counts" />
          )}
          {nav.ready && worst.tone === 'danger' && (
            <span className={`normal-case rounded px-1 py-px text-2xs font-semibold motion-safe:animate-pulse ${CHIP_TONE.dangerSubtle}`}>
              attention
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded="true"
          aria-controls="pipeline-status-ribbon-tiles"
          className="text-2xs text-fg-muted hover:text-fg motion-safe:transition-opacity px-1.5 py-0.5 rounded-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title="Collapse pipeline ribbon — leaves a single-line summary"
        >
          Collapse <span aria-hidden>▴</span>
        </button>
      </div>
      )}
      {/* Mobile/tablet: 2×2 grid. Desktop: tiles + fixed-width arrow gutters. */}
      <div
        id="pipeline-status-ribbon-tiles"
        className="grid grid-cols-2 gap-2 px-1.5 pb-1.5 pt-1.5 md:flex md:items-stretch md:gap-1 overflow-visible"
      >
        {tiles.map((tile, i) => {
          const tone = TONE_CLASS[tile.tone]
          const next = tiles[i + 1]
          return (
            <Fragment key={tile.stage}>
              <Link
                to={tile.to}
                className={`group relative z-0 flex w-full items-center gap-2.5 rounded-md border border-edge-subtle border-l-[4px] bg-surface-raised px-2.5 py-2.5 motion-safe:transition-[transform,opacity] motion-safe:duration-150 hover:bg-surface-overlay hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-w-0 md:flex-1 ${STAGE_BORDER[tile.stage]} ${
                  focusRibbonStage === tile.stage
                    ? 'ring-2 ring-brand/40 shadow-sm'
                    : ''
                }`}
                title={
                  focusRibbonStage === tile.stage
                    ? `${tile.summary} — active project bottleneck`
                    : tile.summary
                }
              >
                <span
                  aria-hidden
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold leading-none shrink-0 shadow-sm ${STAGE_TONE[tile.stage]}`}
                >
                  {tile.stage}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot} ${tile.tone === 'danger' ? 'motion-safe:animate-pulse' : ''}`}
                    />
                    <span className="text-2xs font-medium text-fg-secondary uppercase tracking-wider shrink-0">
                      {tile.label}
                    </span>
                    <span className={`ml-auto text-sm font-mono font-bold tabular-nums tracking-tight leading-none shrink-0 ${tone.label} ${tile.tone === 'danger' ? 'motion-safe:animate-pulse' : ''}`}>
                      {!nav.ready && tile.metric === '—' ? (
                        <span className="inline-block h-3 w-6 animate-pulse rounded bg-fg-faint/25" aria-hidden />
                      ) : (
                        tile.metric
                      )}
                    </span>
                  </span>
                  <span className="block text-xs text-fg-muted leading-snug mt-1 line-clamp-2" title={tile.summary}>
                    {tile.summary}
                  </span>
                </span>
              </Link>
              {next && (
                <PulseArrow
                  fromColor={STAGE_ARROW[tile.stage]}
                  toColor={STAGE_ARROW[next.stage]}
                  fromLabel={STAGE_FLOW_LABEL[tile.stage]}
                  toLabel={STAGE_FLOW_LABEL[next.stage]}
                  animated={arrowsAnimated}
                />
              )}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Check tile reads judge disagreements first, then a "last judge batch ran
 * at" timestamp that HealthPage writes to localStorage on every load.
 */
function computeCheckTile(disagreements: number): RibbonTile {
  if (disagreements > 0) {
    return {
      stage: 'C',
      label: 'Check',
      tone: disagreements > 3 ? 'danger' : 'warn',
      metric: String(disagreements),
      summary: `${disagreements} classifier vs judge ${disagreements === 1 ? 'disagreement' : 'disagreements'}`,
      to: '/judge?tab=evaluations&filter=disagreement',
    }
  }
  const hoursAgo = readJudgeStaleHours()
  if (hoursAgo == null) {
    return {
      stage: 'C',
      label: 'Check',
      tone: 'idle',
      metric: '—',
      summary: 'Open Health to seed judge freshness',
      to: '/health',
    }
  }
  const tone: Tone = hoursAgo > 48 ? 'warn' : 'ok'
  return {
    stage: 'C',
    label: 'Check',
    tone,
    metric: hoursAgo < 1 ? '<1h' : `${Math.floor(hoursAgo)}h`,
    summary: hoursAgo > 48 ? 'Judge batch is overdue' : 'Judge batch is fresh',
    to: '/health',
  }
}
