/**
 * FILE: apps/admin/src/components/tester/tester-ui.tsx
 * PURPOSE: Shared layout + surface primitives for the Mushi Bounties tester portal.
 *
 * OVERVIEW:
 * - Opaque design-token panels (no white/5 dark-mode-only hacks)
 * - Page intro, stat grid, link cards, pipeline rows, progress tracks
 * - Wraps admin design-system Card, StatCard, Section, Btn, Badge
 *
 * DEPENDENCIES:
 * - ../ui (Card, Section, StatCard, Btn, Badge, EmptyState)
 * - react-router-dom Link
 *
 * USAGE:
 * - Import from tester pages instead of ad-hoc border-white/10 classes
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Section } from '../ui'
import { StatCard } from '../ui/metrics'
import { EmptyState } from '../ui/forms'
import type { REP_TIERS } from '../../lib/useTesterStatus'

/** Opaque raised panel — use instead of border-white/10 bg-white/5. */
export const TESTER_PANEL =
  'rounded-md border border-edge-subtle bg-surface-raised'

export const TESTER_PANEL_INTERACTIVE =
  `${TESTER_PANEL} motion-safe:transition-[border-color,box-shadow,transform] hover:border-brand/30 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60`

export interface TesterPageIntroProps {
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}

export function TesterPageIntro({ title, description, actions, meta }: TesterPageIntroProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold text-fg leading-snug">{title}</h1>
        {description && (
          <p className="max-w-2xl text-sm text-fg-muted leading-relaxed text-pretty">{description}</p>
        )}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-0.5">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function TesterTierBadge({ tier }: { tier: (typeof REP_TIERS)[number] }) {
  return (
    <Badge className={`border px-2 py-0.5 text-xs normal-case tracking-normal ${tier.bg} ${tier.color}`}>
      {tier.name} tester
    </Badge>
  )
}

export interface TesterStatItem {
  label: string
  value: string
  hint?: string
  accent?: string
  to?: string
}

export function TesterStatGrid({ items }: { items: TesterStatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          hint={item.hint}
          accent={item.accent}
          to={item.to}
        />
      ))}
    </div>
  )
}

export function TesterLinkCard({
  to,
  children,
  className = '',
}: {
  to: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link to={to} className={`block ${TESTER_PANEL_INTERACTIVE} p-4 ${className}`}>
      {children}
    </Link>
  )
}

export function TesterPipelineRow({
  to,
  icon,
  label,
  sub,
  badge,
  badgeTone = 'info',
}: {
  to: string
  icon: ReactNode
  label: string
  sub: string
  badge?: string
  badgeTone?: 'info' | 'warn' | 'ok' | 'neutral'
}) {
  const badgeClass =
    badgeTone === 'warn'
      ? 'bg-warn-muted text-warning-foreground border-warn/30'
      : badgeTone === 'ok'
        ? 'bg-ok-muted text-ok border-ok/30'
        : badgeTone === 'neutral'
          ? 'bg-surface-overlay text-fg-muted border-edge'
          : 'bg-info-muted text-info-foreground border-info/30'

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2.5 ${TESTER_PANEL_INTERACTIVE}`}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-lg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{label}</p>
        <p className="truncate text-xs text-fg-muted">{sub}</p>
      </div>
      {badge && (
        <Badge className={`shrink-0 border ${badgeClass}`}>{badge}</Badge>
      )}
    </Link>
  )
}

export function TesterLearnTile({
  to,
  icon,
  title,
  description,
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <Link to={to} className={`flex flex-col gap-2 p-4 ${TESTER_PANEL_INTERACTIVE}`}>
      <span className="text-2xl leading-none" aria-hidden>{icon}</span>
      <p className="text-sm font-semibold leading-snug text-fg">{title}</p>
      <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
    </Link>
  )
}

export function TesterSection({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Section title={title} action={action} className={className}>
      {children}
    </Section>
  )
}

export function TesterPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${TESTER_PANEL} p-4 ${className}`}>{children}</div>
}

export function TesterProgressTrack({
  value,
  max,
  markerPct,
  markerLabel,
  barClassName = 'bg-brand',
}: {
  value: number
  max: number
  markerPct?: number
  markerLabel?: string
  barClassName?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-surface-overlay">
      <div
        className={`h-full rounded-full motion-safe:transition-all ${barClassName}`}
        style={{ width: `${pct}%` }}
      />
      {markerPct != null && (
        <div
          className="absolute top-0 h-full w-px bg-warn"
          style={{ left: `${Math.min(100, Math.max(0, markerPct))}%` }}
          title={markerLabel}
        />
      )}
    </div>
  )
}

export function TesterMilestoneRing({
  value,
  max,
  label,
  color,
}: {
  value: number
  max: number
  label: string
  color: string
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90" aria-hidden>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-edge-subtle)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500"
        />
      </svg>
      <p className="-mt-1 text-center text-xs leading-tight text-fg-muted">{label}</p>
    </div>
  )
}

export function TesterLoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`h-24 animate-pulse ${TESTER_PANEL}`} />
      ))}
    </div>
  )
}

export function TesterEmptyPanel({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Card className="p-8">
      <EmptyState title={title} description={description} action={action} />
    </Card>
  )
}

export function TesterPrimaryCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg shadow-card motion-safe:transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      {children}
    </Link>
  )
}

/** Compact contextual help — mirrors PageHeaderBar help without admin chrome. */
export function TesterHelpBanner({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-chrome-border bg-chrome px-4 py-3 text-xs leading-relaxed text-fg-secondary">
      <p className="mb-1 font-semibold text-fg">{title}</p>
      {children}
    </div>
  )
}
