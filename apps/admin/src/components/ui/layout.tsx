import React from 'react';
import type { ReactNode } from 'react';
import { ConfigHelp } from '../ConfigHelp';
import { isDevFacingHint } from '../../lib/devHintCopy';
import { ContainedBlock } from '../report-detail/ReportSurface';
import { InfoHint } from './fields';
import { RelativeTime, formatRelative } from './metrics';


/* ── LabelHelp ──────────────────────────────────────────────────────────────
 *
 * Tiny shared helper used by every form primitive below. Picks the right help
 * affordance for a label given the two opt-in props every primitive now
 * accepts:
 *
 *   - `helpId`  → rich click-to-open <ConfigHelp> popover (5-section card,
 *                 dictionary-backed, also feeds docs/CONFIG_REFERENCE.md).
 *   - `tooltip` → legacy short-string hover tooltip via <InfoHint>. Kept for
 *                 backwards compatibility with the dozens of existing call
 *                 sites that pass a one-line hint inline.
 *
 * `helpId` wins when both are set — the dictionary entry's `summary` already
 * powers the trigger's hover preview, so showing both would duplicate the
 * one-liner. */
export function LabelHelp({ helpId, tooltip }: { helpId?: string; tooltip?: string }) {
  if (helpId) return <ConfigHelp helpId={helpId} />
  if (tooltip) return <InfoHint content={tooltip} />
  return null
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

interface BadgeProps {
  children: ReactNode
  className?: string
  title?: string
}

export function Badge({ children, className = '', title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs leading-tight font-medium ${className}`}
    >
      {children}
    </span>
  )
}

/* ── Card ───────────────────────────────────────────────────────────────── */

interface CardProps {
  children: ReactNode
  className?: string
  interactive?: boolean
  elevated?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  title?: string
}

export function Card({ children, className = '', interactive, elevated, onClick, title }: CardProps) {
  // When the card has an onClick handler we promote it to button semantics so
  // the keyboard story is honest — a div with a click handler isn't reachable.
  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
        },
      }
    : {}
  const interactiveCls =
    interactive || onClick
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:transition-all motion-safe:duration-150 hover:border-edge hover:-translate-y-px hover:shadow-raised motion-safe:active:translate-y-0 motion-safe:active:scale-[0.995] motion-safe:active:shadow-card'
      : ''
  if (elevated) {
    return (
      <div
        className={`card-elevated ${interactiveCls} ${className}`}
        onClick={onClick}
        title={title}
        {...interactiveProps}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      className={`bg-surface-raised border border-edge-subtle rounded-md shadow-card ${interactiveCls} ${interactive || onClick ? 'hover:bg-surface-overlay' : ''} ${className}`}
      onClick={onClick}
      title={title}
      {...interactiveProps}
    >
      {children}
    </div>
  )
}

/* ── PanelHeader — canonical card section title + separator ───────────────
 *
 * Every dashboard tile, chart card, and table panel uses this for the
 * title→content boundary. Do not roll ad-hoc uppercase labels — import
 * PanelHeader (inside Card) or CardPanel (Card + header bundled).
 *
 * NN/g #4 Consistency: one separator rhythm across the admin console.
 */

export const PANEL_HEADER_SEPARATOR = 'border-b border-edge-subtle/80'
export const PANEL_SUBHEADER_SEPARATOR = 'border-b border-edge-subtle/60'

interface PanelHeaderProps {
  title: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
  /** Dashboard tiles default to uppercase; detail sections pass false. */
  uppercase?: boolean
  as?: 'h2' | 'h3' | 'p' | 'div'
}

export function PanelHeader({
  title,
  action,
  icon,
  className = '',
  uppercase = true,
  as: TitleTag = 'h3',
}: PanelHeaderProps) {
  const titleCls = uppercase
    ? 'text-xs font-medium uppercase tracking-wider text-fg-muted'
    : 'text-xs font-semibold text-fg-secondary'
  return (
    <div className={`mb-2 pb-2 ${PANEL_HEADER_SEPARATOR} ${className}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <TitleTag className={`flex min-w-0 items-center gap-1.5 ${titleCls}`}>
          {icon && (
            <span className="shrink-0 text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
          )}
          <span className="truncate">{title}</span>
        </TitleTag>
        {action != null && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}

export function PanelSubheader({ title, className = '' }: { title: string; className?: string }) {
  return (
    <p
      className={`mb-1 pb-1 text-3xs font-medium uppercase tracking-wider text-fg-faint ${PANEL_SUBHEADER_SEPARATOR} ${className}`}
    >
      {title}
    </p>
  )
}

interface CardPanelProps {
  title: ReactNode
  children: ReactNode
  className?: string
  action?: ReactNode
}

/** Opaque bordered panel — use instead of ad-hoc bg-surface-2 divs. */
export function SurfacePanel({
  children,
  className = '',
  ...props
}: {
  children: ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md border border-edge-subtle bg-surface-raised shadow-card ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

/** Card + PanelHeader — standard dashboard / insight tile shell. */
export function CardPanel({ title, children, className = '', action }: CardPanelProps) {
  return (
    <Card className={`min-w-0 p-3 ${className}`}>
      <PanelHeader title={title} action={action} />
      {children}
    </Card>
  )
}

/* ── Section (labeled card for detail views) ────────────────────────────── */

/**
 * Freshness metadata accepted by `<Section>` and rendered through
 * `<FreshnessPill>`. Pages typically forward `usePageData`'s
 * `lastFetchedAt`, `isValidating`, and `useRealtimeReload`'s `channelState`.
 *
 * Wave T.1 (2026-04-23): Sections that show live data win a tiny "Updated
 * 4 s ago" pill in the top-right that pulses while a background refetch is
 * in flight and turns red when realtime drops — gives users a constant
 * trust signal that the page isn't lying about its data.
 */
export interface SectionFreshness {
  /** ISO timestamp of the last successful data fetch, or null until first
   *  load resolves. */
  at: string | null
  /** True while a background refetch is in flight (post-first-load). */
  isValidating?: boolean
  /** Realtime channel state — `dropped` adds a red ring + screen-reader
   *  warning so users know stale data is possible. */
  channel?: 'idle' | 'live' | 'dropped'
}

interface SectionProps {
  title: string
  children: ReactNode
  className?: string
  action?: ReactNode
  icon?: ReactNode
  /** Optional freshness pill rendered top-right. Pages opt in by passing
   *  `lastFetchedAt`/`isValidating` from `usePageData` plus the realtime
   *  channel state. */
  freshness?: SectionFreshness
}

export function Section({ title, children, className = '', action, icon, freshness }: SectionProps) {
  return (
    <Card className={`p-3 ${className}`}>
      <PanelHeader
        title={title}
        icon={icon}
        uppercase={false}
        action={
          <>
            {freshness && <FreshnessPill {...freshness} />}
            {action}
          </>
        }
      />
      {children}
    </Card>
  )
}

/** Suppresses internal TAB_META / "Banner + …" dev copy under snapshot sections. */
export function SnapshotSectionHint({
  text,
  className = 'mb-3',
}: {
  text?: string | null
  className?: string
}) {
  if (isDevFacingHint(text) || !text) return null
  return (
    <ContainedBlock tone="muted" className={className}>
      <p className="text-2xs leading-relaxed text-fg-muted">{text}</p>
    </ContainedBlock>
  )
}

/** Same filter for one-line scope hints under page headers. */
export function PageScopeHint({
  text,
  className = 'mb-1',
}: {
  text?: string | null
  className?: string
}) {
  if (isDevFacingHint(text) || !text) return null
  return (
    <ContainedBlock tone="muted" className={className}>
      <p className="text-xs leading-relaxed text-fg-muted">{text}</p>
    </ContainedBlock>
  )
}

/* ── FreshnessPill — "Updated 4 s ago" trust signal ─────────────────────── */

interface FreshnessPillProps extends SectionFreshness {
  className?: string
}

/**
 * Top-right chip that gives every section an "I'm not lying" receipt:
 *
 *   - Renders `Updated <relative-time>` so users always know the age of
 *     the data on screen. No timestamp = neutral "Loading…".
 *   - `motion-safe:animate-pulse` on the dot while `isValidating` so a
 *     background refetch is visible without flashing the panel.
 *   - Red ring + assertive aria-live when the realtime channel has
 *     dropped, so users know the live affordance has gone silent and
 *     the data may already be stale.
 *
 * Cheap to render; safe to mount on every Section. Use directly via the
 * `<Section freshness={...}>` prop, or render inline next to bespoke
 * headers (e.g. KpiRow on Dashboard which is a grid, not a Section).
 */
/* ── StatGrid — responsive metric tile row ────────────────────────────────
 *
 * auto-fit grid so stat cards grow on wide viewports instead of leaving
 * dead gutters. Used on Explore, Dashboard KPI strips, and any 3–6 tile row.
 */

interface StatGridProps {
  children: ReactNode
  className?: string
  /** Minimum track width before wrapping (default 10.5rem). */
  minCol?: string
}

export function StatGrid({ children, className = '', minCol = '10.5rem' }: StatGridProps) {
  return (
    <div
      className={`grid gap-2 sm:gap-3 min-w-0 ${className}`}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minCol}), 1fr))` }}
    >
      {children}
    </div>
  )
}

/* ── WorkbenchSplit — sidebar + primary pane ──────────────────────────────
 *
 * Atlas/chat workbench: stacks on compact widths, side-by-side from xl up,
 * and reserves viewport height so the primary pane can scroll internally.
 */

const WORKBENCH_SIDEBAR_WIDTH = {
  sm: 'minmax(11rem, 13rem)',
  md: 'minmax(13rem, 16rem)',
  lg: 'minmax(14rem, 20rem)',
} as const

interface WorkbenchSplitProps {
  sidebar: ReactNode
  children: ReactNode
  className?: string
  sidebarWidth?: keyof typeof WORKBENCH_SIDEBAR_WIDTH
  /** Minimum workbench height on xl+ (defaults to viewport-aware clamp). */
  minHeightClass?: string
}

export function WorkbenchSplit({
  sidebar,
  children,
  className = '',
  sidebarWidth = 'md',
  minHeightClass = 'xl:min-h-[min(72dvh,calc(100dvh-13rem))]',
}: WorkbenchSplitProps) {
  const sidebarTrack = WORKBENCH_SIDEBAR_WIDTH[sidebarWidth]
  return (
    <div
      className={`grid min-h-0 min-w-0 grid-cols-1 gap-3 xl:grid-cols-[var(--workbench-sidebar)_minmax(0,1fr)] xl:items-stretch ${minHeightClass} ${className}`}
      style={{ ['--workbench-sidebar' as string]: sidebarTrack }}
    >
      <aside className="min-w-0 shrink-0 xl:flex xl:max-h-full xl:flex-col">{sidebar}</aside>
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  )
}

export function FreshnessPill({ at, isValidating, channel, className = '' }: FreshnessPillProps) {
  const dropped = channel === 'dropped'
  const dotClass = dropped
    ? 'bg-danger'
    : isValidating
    ? 'bg-info motion-safe:animate-pulse'
    : channel === 'live'
    ? 'bg-ok'
    : 'bg-fg-faint'
  const ringClass = dropped
    ? 'ring-1 ring-danger/40 border-danger/40'
    : isValidating
    ? 'border-info/30'
    : 'border-edge-subtle'
  const label = dropped
    ? 'Realtime channel dropped — data may be stale'
    : isValidating
    ? 'Refreshing data…'
    : at
    ? `Updated ${formatRelative(at)}`
    : 'Awaiting first data'
  return (
    <span
      role="status"
      aria-live={dropped ? 'assertive' : 'polite'}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface-overlay/40 px-1.5 py-0.5 text-3xs leading-tight text-fg-faint ${ringClass} ${className}`}
    >
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {at ? (
        <span className="tabular-nums">
          <RelativeTime value={at} className="cursor-default" />
        </span>
      ) : (
        <span>{isValidating ? 'Loading…' : '—'}</span>
      )}
    </span>
  )
}
