/**
 * FILE: apps/admin/src/components/hero-flow/HeroDetailPanel.tsx
 * PURPOSE: Rich detail panel rendered below the ReactFlow lane when the
 *          operator clicks a Decide / Act / Verify tile. Replaces the
 *          cramped 3-line expandedSlot that used to live inside the
 *          fixed-height node.
 *
 *          Five sections, each optional / gracefully collapsed:
 *            1. Why now     — one human sentence from evidence or manifest fallback
 *            2. Live data   — metric chips (metric-breakdown) or last-event card
 *            3. What to do  — CTAs + "Show on page →" spotlight affordance
 *            4. Where it lives — backend lineage from configDocs for this scope+tile
 *            5. Missing config — callout for unset/blocking configDocs IDs
 *
 *          The panel is a real <section> with aria-labelledby so AT users
 *          arrive in a named landmark. Focus moves to the close button on mount.
 *          Escape collapses the panel via the onClose callback.
 */

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
} from 'react'
import { Link } from 'react-router-dom'

import { DetailRows, type DetailRowItem } from '../ui'
import { getConfigDoc } from '../../lib/configDocs'
import { getDavManifest, type DavEvidence } from '../../lib/davManifest'
import type { PageHeroDecide, PageHeroVerify } from '../PageHero'
import type { PageAction } from '../PageActionBar'
import { OperatorTraceLog } from './OperatorTraceLog'
import { buildOperatorTrace } from './operatorTrace'
import type { OperatorTraceLine } from './operatorTrace'
import { CHIP_TONE } from '../../lib/chipTone'

// ─── Props ─────────────────────────────────────────────────────────────────

interface HeroDetailPanelProps {
  tile: 'decide' | 'act' | 'verify'
  scope: string
  /** Full decide tile data from the consumer page. */
  decide: PageHeroDecide
  /** PageAction for the act tile (may be null = all clear). */
  action: PageAction | null
  actEvidence?: DavEvidence
  actAnchor?: string
  actMissingConfigIds?: string[]
  actDebugLines?: OperatorTraceLine[]
  /** Full verify tile data from the consumer page. */
  verify: PageHeroVerify
  /** Trigger on-page spotlight for the given anchor value. */
  onSpotlight: (anchor: string) => boolean
  /** Close / collapse the panel. */
  onClose: () => void
}

// ─── Colour tokens per tile ─────────────────────────────────────────────────

const TILE_COLORS = {
  decide: { rail: 'border-info/60',     heading: 'text-info' },
  act:    { rail: 'border-warn/60',     heading: 'text-warn' },
  verify: { rail: 'border-fg-muted/60', heading: 'text-fg-muted' },
}

// ─── Tone chip ─────────────────────────────────────────────────────────────

const TONE_CLASS: Record<string, string> = {
  ok:      CHIP_TONE.okSubtle + ' border border-ok/30',
  warn:    CHIP_TONE.warnSubtle,
  crit:    'bg-err/15 text-err border border-err/30',
  info:    CHIP_TONE.infoSubtle + ' border border-info/30',
  neutral: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

function MetricChip({ label, value, tone = 'neutral' }: {
  label: string
  value: string | number
  tone?: string
}) {
  const valueStr = String(value)
  const numeric = /^[\d]/.test(valueStr)
  return (
    <div className={`inline-flex min-w-[4.5rem] flex-col items-center rounded-md px-2.5 py-1.5 text-center ${TONE_CLASS[tone] ?? TONE_CLASS.neutral}`}>
      <span className={`tabular-nums leading-none ${numeric ? 'text-lg font-bold tracking-tight' : 'text-sm font-semibold'}`}>
        {value}
      </span>
      <span className="mt-1 text-3xs uppercase tracking-wider opacity-70">{label}</span>
    </div>
  )
}

// ─── Section wrapper ───────────────────────────────────────────────────────

function Section({ heading, children, tone = 'info' }: {
  heading: string
  children: React.ReactNode
  tone?: 'lead' | 'info' | 'action' | 'warn'
}) {
  const railClass =
    tone === 'lead' ? 'border-brand/60'
    : tone === 'action' ? 'border-ok/60'
    : tone === 'warn' ? 'border-warn/60'
    : 'border-edge'
  const headingClass =
    tone === 'lead' ? 'text-brand/90'
    : tone === 'action' ? 'text-ok'
    : tone === 'warn' ? 'text-warn'
    : 'text-fg-muted'
  return (
    <div className={`pl-2.5 border-l-2 ${railClass}`}>
      <p className={`mb-1 text-3xs font-semibold uppercase tracking-[0.08em] ${headingClass}`}>
        {heading}
      </p>
      <div className="text-2xs text-fg-secondary leading-relaxed">{children}</div>
    </div>
  )
}

// ─── Backend lineage strip ──────────────────────────────────────────────────

function LineageStrip({ configId }: { configId: string }) {
  const doc = getConfigDoc(configId)
  if (!doc) return null
  const { backend, label } = doc
  const writes = backend ? [backend.table, backend.column].filter(Boolean).join('.') : null

  const rows: DetailRowItem[] = []
  if (writes) {
    rows.push({ label: 'Writes', value: writes, mono: true, tone: 'info', wrap: true, hint: 'Database table.column this config persists to.' })
  }
  if (backend?.endpoint) {
    rows.push({ label: 'Endpoint', value: backend.endpoint, mono: true, tone: 'muted', wrap: true, hint: 'API endpoint that mutates this config server-side.' })
  }
  if (backend?.readBy && backend.readBy.length > 0) {
    rows.push({ label: 'Read by', value: backend.readBy.join(', '), mono: true, tone: 'muted', wrap: true, hint: 'Surfaces in the app that consume this config.' })
  }
  if (!backend) {
    rows.push({ label: 'Type', value: 'Client-only setting', tone: 'muted' })
  }

  return (
    <div className="rounded-sm border border-edge-subtle bg-surface-raised/60 px-2.5 py-1.5 space-y-1">
      <p className="text-2xs font-medium text-fg truncate">{label}</p>
      <DetailRows dense items={rows} />
    </div>
  )
}

// ─── Missing config callout ────────────────────────────────────────────────

function MissingConfigCallout({ configId }: { configId: string }) {
  const doc = getConfigDoc(configId)
  if (!doc) return null
  // Derive a best-guess anchor path for "Configure" link
  const route = configId.startsWith('settings.') ? '/settings'
    : configId.startsWith('integrations.') ? '/integrations'
    : configId.startsWith('compliance.') ? '/compliance'
    : configId.startsWith('storage.') ? '/storage'
    : configId.startsWith('anti-gaming.') ? '/anti-gaming'
    : configId.startsWith('intelligence.') ? '/intelligence'
    : configId.startsWith('marketplace.') ? '/marketplace'
    : configId.startsWith('billing.') ? '/billing'
    : configId.startsWith('prompt-lab.') ? '/prompt-lab'
    : configId.startsWith('mcp.') ? '/mcp'
    : '/settings'
  const anchor = `#${configId.replace(/\./g, '-')}`

  return (
    <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
      <span aria-hidden className="mt-0.5 text-warn text-xs flex-shrink-0">⚠</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-2xs font-semibold text-fg">{doc.label}</p>
        <p className="text-2xs text-fg-muted">{doc.summary}</p>
        <Link
          to={`${route}${anchor}`}
          className="inline-flex items-center gap-1 text-2xs text-brand hover:text-brand-hover underline-offset-2 hover:underline"
          data-dav-action="config-link"
        >
          Configure →
        </Link>
      </div>
    </div>
  )
}

// ─── Fallback chip derivation for un-wired pages ───────────────────────────
// Parses a "3 red · 1 warn · 0 ok" style metric string into MetricChip items.
// This lets pages that haven't supplied structured `evidence` still render a
// chip grid rather than nothing, buying time while they migrate at their pace.

function parseFallbackChips(metric?: string): Array<{ label: string; value: string }> {
  if (!metric) return []
  // Try "VALUE LABEL" segment patterns separated by · or , or spaces
  const segments = metric.split(/[·,|]+/).map((s) => s.trim()).filter(Boolean)
  const chips: Array<{ label: string; value: string }> = []
  for (const seg of segments) {
    // Match "42 label" or "label: 42" or "label=42"
    const numFirst = seg.match(/^([\d.%]+)\s+(.+)$/)
    const labelFirst = seg.match(/^(.+?)[:=]\s*([\d.%]+)$/)
    if (numFirst) {
      chips.push({ value: numFirst[1], label: numFirst[2] })
    } else if (labelFirst) {
      chips.push({ value: labelFirst[2], label: labelFirst[1] })
    } else {
      chips.push({ value: '—', label: seg })
    }
  }
  return chips.slice(0, 5)
}

// ─── CTA renderer (mirrors HeroNodes HeroCta) ──────────────────────────────

function DetailCta({
  cta,
  variant = 'primary',
}: {
  cta: NonNullable<PageAction['primary']>
  variant?: 'primary' | 'ghost'
}) {
  if (cta.kind === 'link') {
    return variant === 'primary'
      ? (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-1 rounded-sm bg-brand px-3 py-1.5 text-2xs font-bold text-brand-fg hover:bg-brand-hover shadow-sm shadow-brand/25 motion-safe:transition-[background-color,border-color,color,box-shadow,transform,opacity]"
          data-dav-action="follow-cta"
        >
          {cta.label} <span aria-hidden>→</span>
        </Link>
      )
      : (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
          data-dav-action="follow-cta"
        >
          {cta.label}
        </Link>
      )
  }
  return (
    <button
      type="button"
      onClick={cta.onClick}
      disabled={cta.disabled}
      className={
        variant === 'primary'
          ? 'inline-flex items-center gap-1 rounded-sm bg-brand px-3 py-1.5 text-2xs font-bold text-brand-fg hover:bg-brand-hover shadow-sm disabled:opacity-50'
          : 'inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay disabled:opacity-50'
      }
      data-dav-action="follow-cta"
    >
      {cta.label}
    </button>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export function HeroDetailPanel({
  tile,
  scope,
  decide,
  action,
  actEvidence,
  actAnchor,
  actMissingConfigIds,
  actDebugLines,
  verify,
  onSpotlight,
  onClose,
}: HeroDetailPanelProps) {
  const panelId = useId()
  const headingId = `${panelId}-heading`
  const closeRef = useRef<HTMLButtonElement>(null)
  const manifest = getDavManifest(scope)
  const colors = TILE_COLORS[tile]

  // Focus the close button when the panel mounts.
  useEffect(() => {
    closeRef.current?.focus()
  }, [tile])

  // Escape key collapses the panel.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // ── Derive per-tile data ───────────────────────────────────────────────

  const evidence: DavEvidence | undefined =
    tile === 'decide' ? decide.evidence
    : tile === 'act'  ? actEvidence
    :                   verify.evidence

  const anchor: string | undefined =
    tile === 'decide' ? decide.anchor
    : tile === 'act'  ? actAnchor
    :                   verify.anchor

  const missingConfigIds: string[] =
    tile === 'decide' ? (decide.missingConfigIds ?? [])
    : tile === 'act'  ? (actMissingConfigIds ?? [])
    :                   (verify.missingConfigIds ?? [])

  const manifestTile = manifest?.[tile]
  const configIds: string[] = manifestTile?.configIds ?? []

  // ── Why now ──────────────────────────────────────────────────────────

  let whyNow: string | undefined
  if (evidence?.kind === 'metric-breakdown') whyNow = evidence.whyNow
  else if (evidence?.kind === 'rule-trace') whyNow = evidence.why
  else if (evidence?.kind === 'last-event') {
    const ts = new Date(evidence.at)
    const isValid = !isNaN(ts.getTime())
    whyNow = isValid
      ? `Last recorded by ${evidence.by} at ${ts.toLocaleString()} — ${evidence.payloadSummary}`
      : `Recorded by ${evidence.by} — ${evidence.payloadSummary}`
  }
  if (!whyNow) whyNow = manifestTile?.tileMeaning

  // Decide/Verify fallbacks from metric + summary
  if (!whyNow && tile === 'decide') {
    whyNow = decide.metric
      ? `Current metric: ${decide.metric}. ${decide.summary}`
      : decide.summary
  }
  if (!whyNow && tile === 'verify') {
    whyNow = verify.detail
      ? `${verify.label} — ${verify.detail}`
      : verify.label
  }
  if (!whyNow && tile === 'act' && action) {
    whyNow = action.reason ?? action.title
  }
  if (!whyNow && tile === 'act' && !action) {
    whyNow = 'No action is required right now. When the engine detects a condition that needs your attention, it will surface a primary CTA here.'
  }

  // ── Tile heading label ────────────────────────────────────────────────

  const tileLabel = tile === 'decide' ? 'Decide' : tile === 'act' ? 'Act' : 'Verify'

  const operatorTrace = buildOperatorTrace({
    scope,
    tile,
    decide,
    action,
    verify,
    evidence,
    anchor,
    extraDebugLines: tile === 'act' ? actDebugLines : undefined,
  })

  // ── Spot-on-page handler ──────────────────────────────────────────────

  function handleSpotlight() {
    if (!anchor) return
    onSpotlight(anchor)
  }

  // ─────────────────────────────────────────────────────────────────────

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      className="border-t border-edge-subtle/60 bg-surface-raised/20 animate-mushi-fade-in"
    >
      {/* Panel header ─────────────────────────────────────────────────── */}
      <div className={`flex items-center justify-between px-4 py-2 border-l-4 ${colors.rail} bg-surface-raised/30`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-3xs font-bold uppercase tracking-[0.1em] ${colors.heading}`}>
            {tileLabel}
          </span>
          <span aria-hidden className="text-fg-faint">·</span>
          <h4 id={headingId} className="text-2xs font-medium text-fg-muted truncate">
            {tile === 'decide' ? decide.label
              : tile === 'act' ? (action?.title ?? 'All clear')
              : verify.label}
          </h4>
          <span className="hidden md:inline font-mono text-3xs text-fg-faint truncate" title="DAV scope and anchor">
            {scope}
            {anchor ? ` · ${anchor}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {anchor && (
            <button
              type="button"
              onClick={handleSpotlight}
              className="inline-flex items-center gap-1 text-2xs text-brand hover:text-brand-hover motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 rounded-sm px-1.5 py-0.5 hover:bg-brand/10"
              data-dav-action="spotlight"
              title="Scroll to and highlight the related section on this page"
            >
              Show on page <span aria-hidden>↗</span>
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Collapse ${tileLabel} detail`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-faint hover:text-fg-muted hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 motion-safe:transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel body ───────────────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-3">

        {/* 1. Why now ─────────────────────────────────────────────────── */}
        {whyNow && (
          <Section heading="Why now" tone="lead">
            <p className="text-fg">{whyNow}</p>
            {evidence?.kind === 'rule-trace' && evidence.threshold && (
              <pre className="mt-1.5 overflow-x-auto rounded-md border border-edge-subtle/60 bg-viz-terminal-bg/80 px-2 py-1.5 font-mono text-3xs text-brand leading-relaxed">
                {evidence.threshold}
              </pre>
            )}
          </Section>
        )}

        <OperatorTraceLog lines={operatorTrace} variant="full" />

        {/* 2. Live data ───────────────────────────────────────────────── */}
        {evidence?.kind === 'metric-breakdown' && evidence.items.length > 0 && (
          <Section heading="Live data">
            <div className="flex flex-wrap gap-2 mt-1">
              {evidence.items.map((item, i) => (
                <MetricChip
                  key={i}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                />
              ))}
            </div>
          </Section>
        )}

        {evidence?.kind === 'last-event' && (
          <Section heading="Last event">
            <div className="flex items-start gap-3 rounded-md border border-edge-subtle bg-surface-raised/60 px-3 py-2 mt-1">
              <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${
                evidence.status === 'ok' ? 'bg-ok'
                : evidence.status === 'error' ? 'bg-err'
                : evidence.status === 'warn' ? 'bg-warn'
                : 'bg-fg-faint'
              }`} aria-hidden />
              <div className="min-w-0 space-y-0.5">
                <p className="text-2xs font-medium text-fg">{evidence.payloadSummary}</p>
                <p className="text-2xs text-fg-muted font-mono">{evidence.by}</p>
                <p className="text-2xs text-fg-faint">{new Date(evidence.at).toLocaleString()}</p>
              </div>
            </div>
          </Section>
        )}

        {/* Fallback chip grid for pages that haven't supplied structured evidence.
            parseFallbackChips tries to split the metric string (e.g. "3 red · 1 warn")
            into readable chips so even un-wired pages render more than an empty panel. */}
        {!evidence && tile === 'decide' && (() => {
          const chips = parseFallbackChips(decide.metric)
          return chips.length > 0 ? (
            <Section heading="Live data">
              <div className="flex flex-wrap gap-2 mt-1">
                {chips.map((c, i) => (
                  <MetricChip key={i} label={c.label} value={c.value} tone="neutral" />
                ))}
              </div>
            </Section>
          ) : null
        })()}

        {!evidence && tile === 'verify' && verify.detail && (
          <Section heading="Last known state">
            <p className="text-fg-secondary mt-1">{verify.detail}</p>
          </Section>
        )}

        {/* 3. What you can do here ────────────────────────────────────── */}
        {tile === 'act' && (
          <Section heading="What you can do here" tone="action">
            {action ? (
              <div className="space-y-2 mt-1">
                {action.reason && (
                  <p className="text-fg-secondary">{action.reason}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {action.primary && <DetailCta cta={action.primary} variant="primary" />}
                  {(action.secondary ?? []).map((s, i) => (
                    <DetailCta key={i} cta={s} variant="ghost" />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-fg-muted mt-1">
                Nothing actionable right now — the pipeline is nominal for this scope.
              </p>
            )}
          </Section>
        )}

        {tile === 'decide' && (decide.missingConfigIds ?? []).length === 0 && (
          <Section heading="What you can do here" tone="action">
            <p className="text-fg-secondary mt-1">
              Review the metrics above. If the state is wrong, check the configuration knobs
              listed under "Where it lives" or look for a related action in the Act tile.
            </p>
          </Section>
        )}

        {tile === 'verify' && (
          <Section heading="What you can do here" tone="action">
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {verify.to && (
                <Link
                  to={verify.to}
                  className="inline-flex items-center gap-1 rounded-sm bg-brand/90 px-2.5 py-1 text-2xs font-semibold text-brand-fg hover:bg-brand motion-safe:transition-colors shadow-sm"
                  data-dav-action="follow-cta"
                >
                  Open evidence <span aria-hidden>→</span>
                </Link>
              )}
              {verify.secondaryTo && verify.secondaryLabel && (
                <Link
                  to={verify.secondaryTo}
                  className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay/60 px-2 py-0.5 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors"
                  data-dav-action="follow-cta"
                >
                  {verify.secondaryLabel}
                </Link>
              )}
            </div>
          </Section>
        )}

        {/* 4. Where it lives ──────────────────────────────────────────── */}
        {configIds.length > 0 && (
          <Section heading="Where it lives">
            <div className="space-y-1.5 mt-1">
              {configIds.map((id) => (
                <LineageStrip key={id} configId={id} />
              ))}
            </div>
          </Section>
        )}

        {/* 5. Missing config ──────────────────────────────────────────── */}
        {missingConfigIds.length > 0 && (
          <Section heading="Missing configuration" tone="warn">
            <p className="text-fg-muted mb-2">
              The following settings are unset or misconfigured. Fill them in to restore this tile's state.
            </p>
            <div className="space-y-1.5">
              {missingConfigIds.slice(0, 3).map((id) => (
                <MissingConfigCallout key={id} configId={id} />
              ))}
            </div>
          </Section>
        )}

        {/* Unmigrated-page notice — shown when the consumer page has not yet
            supplied structured evidence for this tile. Provides a degraded but
            still-meaningful experience while migration happens at the page's
            own pace. Hidden in production-like environments (no dev flag needed;
            the absence of evidence is the signal). */}
        {!evidence && tile !== 'act' && (
          <p className="text-3xs text-fg-faint border-t border-edge-subtle/40 pt-2 mt-1">
            Connect live data for richer insights —{' '}
            <a
              href="https://github.com/kensa-dev/mushi-mushi#enriching-dav-tiles"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-fg-muted motion-safe:transition-colors"
            >
              see how to wire evidence →
            </a>
          </p>
        )}

      </div>
    </section>
  )
}
