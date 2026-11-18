/**
 * FILE: apps/admin/src/components/signal/AlertCards.tsx
 * PURPOSE: "What needs you", worst first, as short cards (2026-11-18, generalised from the CI
 *          page's CiAlertStrip so every page leads with its problems the same way).
 *
 * Each card: a severity colour and shape (red ▲ critical, pulsing; amber ◆ serious), a short
 * label, the app it is about, a title that names the problem, one line of detail, one big
 * number with a small unit ("+17 min", "100 % fail"), and at most one action plus optional
 * icon links (an external log, the evidence on this page). Pointing at a card lights the same
 * thing across the page (components/signal/linkedHighlight); a click pins it, and the
 * "Pinned" trail says what is pinned (Escape clears).
 *
 * The caller ranks the alerts; this component only lays them out (three on a phone, `maxShown`
 * on a wide screen, "Show N more" for the rest).
 */

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowRight, IconCheck, IconClose, IconExternalLink } from '../icons'
import { useLinked, usePinned, type HighlightKey } from './linkedHighlight'
import { StatusGlyph } from './StatusGlyph'

export type SignalSeverity = 'critical' | 'serious'

export interface SignalAlertAction {
  label: string
  /** In-app route (react-router). */
  to?: string
  /** External URL, new tab. */
  href?: string
  onClick?: () => void
}

export interface SignalAlert {
  id: string
  severity: SignalSeverity
  /** Short words for the severity: "Keeps failing", "Stale 14d". Critical cards say "Critical". */
  label: string
  /** The app it is about, when it is one app. */
  app?: string | null
  title: string
  detail: ReactNode
  metric: { value: string; unit: string }
  /** Hovering the card lights these up across the page; the first is the one a click pins. */
  keys?: HighlightKey[]
  /** An external log or source (icon link). */
  href?: string | null
  hrefLabel?: string
  /** The evidence on this page or another view (icon link), e.g. `#checks-failing`. */
  jump?: string | null
  jumpLabel?: string
  /** The one thing to do about it. */
  action?: SignalAlertAction
}

/** Cards on a narrow screen before "Show more". */
const SHOWN_NARROW = 3
const MORE = 'self-start text-2xs font-medium text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg'

export const SIGNAL_ICON_LINK =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm border border-edge bg-surface-raised text-fg-secondary ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

const ACTION =
  'inline-flex h-7 items-center rounded-sm border border-edge bg-surface-raised px-2 text-2xs font-semibold text-fg ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function ActionLink({ action }: { action: SignalAlertAction }) {
  if (action.to) {
    return (
      <Link to={action.to} className={ACTION} onClick={action.onClick}>
        {action.label}
      </Link>
    )
  }
  if (action.href) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={ACTION} onClick={action.onClick}>
        {action.label}
      </a>
    )
  }
  return (
    <button type="button" className={ACTION} onClick={action.onClick}>
      {action.label}
    </button>
  )
}

function AlertCard({
  alert,
  index,
  narrowHidden,
  testIdPrefix,
}: {
  alert: SignalAlert
  index: number
  narrowHidden: boolean
  testIdPrefix: string
}) {
  const keys = alert.keys ?? []
  const link = useLinked(keys, keys[0] ?? alert.id, keys.length > 0)
  const critical = alert.severity === 'critical'
  return (
    <li
      {...link}
      className={`${link.className} ci-rise group relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border py-2 pr-2.5 pl-3.5 motion-safe:hover:-translate-y-0.5 ${keys.length > 0 ? 'cursor-pointer' : ''} ${narrowHidden ? 'hidden @xl:flex' : ''} ${
        critical ? 'border-danger/55 bg-danger-muted' : 'border-warn/55 bg-warn-muted'
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
      data-testid={`${testIdPrefix}-alert-${alert.id}`}
      data-severity={alert.severity}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${critical ? 'bg-danger' : 'bg-warn'}`} aria-hidden="true" />
      <span className="flex items-center gap-1.5">
        <StatusGlyph tone={critical ? 'danger' : 'warn'} pulse={critical} />
        <span className={`text-3xs font-bold tracking-wider uppercase ${critical ? 'text-danger-foreground' : 'text-warn-foreground'}`}>
          {critical ? 'Critical' : alert.label}
        </span>
        {alert.app && <span className="ml-auto truncate text-3xs font-medium text-fg-secondary">{alert.app}</span>}
      </span>
      {keys.length > 0 ? (
        <button
          type="button"
          className="text-left text-sm leading-snug font-bold text-fg focus-visible:outline-none focus-visible:underline"
          aria-pressed={link['data-pinned'] ?? false}
          title="Pin: light this up across the page"
        >
          {alert.title}
        </button>
      ) : (
        <span className="text-sm leading-snug font-bold text-fg">{alert.title}</span>
      )}
      <span className="text-xs leading-snug text-fg-secondary">{alert.detail}</span>
      <span className="mt-auto flex items-end justify-between gap-2 pt-1">
        <span className="leading-none">
          <span className="font-mono text-xl font-extrabold text-fg tabular-nums">{alert.metric.value}</span>
          <span className="ml-0.5 text-2xs font-semibold text-fg-secondary">{alert.metric.unit}</span>
        </span>
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {alert.action && <ActionLink action={alert.action} />}
          {alert.href && (
            <a
              href={alert.href}
              target="_blank"
              rel="noopener noreferrer"
              className={SIGNAL_ICON_LINK}
              aria-label={alert.hrefLabel ?? 'Open the source'}
              title={alert.hrefLabel ?? 'Open the source'}
            >
              <IconExternalLink size={13} />
            </a>
          )}
          {alert.jump && (
            <a href={alert.jump} className={SIGNAL_ICON_LINK} aria-label={alert.jumpLabel ?? 'Show the evidence'} title={alert.jumpLabel ?? 'Show the evidence'}>
              <IconArrowRight size={13} className="rotate-90" />
            </a>
          )}
        </span>
      </span>
    </li>
  )
}

export interface AlertCardsProps {
  alerts: readonly SignalAlert[]
  /** Shown (green ●) when there is nothing to flag. Null renders nothing instead. */
  emptyText: ReactNode | null
  /** The section's accessible name. */
  label?: string
  /** Cards on a wide screen before "Show more". */
  maxShown?: number
  /** Widest grid: 3 columns (most pages) or 6 (the CI page's full-width strip). */
  columns?: 3 | 6
  /** Prefix for data-testid: `<prefix>-alerts`, `<prefix>-alert-<id>`, `<prefix>-pinned`. */
  testIdPrefix?: string
  /** A readable name for a pinned highlight key (the "Pinned" trail). */
  keyLabel?: (key: HighlightKey) => string
}

export function AlertCards({
  alerts,
  emptyText,
  label = 'What needs attention',
  maxShown = 3,
  columns = 3,
  testIdPrefix = 'signal',
  keyLabel,
}: AlertCardsProps) {
  const [all, setAll] = useState(false)
  const { pinned, clear } = usePinned()
  const shown = all ? alerts : alerts.slice(0, maxShown)
  const critical = alerts.filter((a) => a.severity === 'critical').length
  const grid =
    columns === 6
      ? 'grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3 @min-[96rem]:grid-cols-6'
      : 'grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3'

  if (alerts.length === 0 && emptyText == null && !pinned) return null

  return (
    <section aria-label={label} className="flex flex-col gap-2" data-testid={`${testIdPrefix}-alerts`}>
      {alerts.length === 0 ? (
        emptyText != null && (
          <p className="ci-rise flex items-center gap-2 rounded-md border border-ok/45 bg-ok-muted px-3 py-2 text-sm font-semibold text-fg" role="status">
            <IconCheck size={15} className="text-ok" />
            {emptyText}
          </p>
        )
      ) : (
        <>
          <h2 className="sr-only">
            {alerts.length} problem{alerts.length === 1 ? '' : 's'}, {critical} critical
          </h2>
          {/* The worst three on a phone, `maxShown` on a wide screen, so the page itself is still in view. */}
          <div className="@container flex flex-col gap-2">
            <ul className={grid}>
              {shown.map((a, i) => (
                <AlertCard key={a.id} alert={a} index={i} narrowHidden={!all && i >= SHOWN_NARROW} testIdPrefix={testIdPrefix} />
              ))}
            </ul>
            {!all && alerts.length > SHOWN_NARROW && (
              <button type="button" className={`${MORE} @xl:hidden`} onClick={() => setAll(true)}>
                Show {alerts.length - SHOWN_NARROW} more
              </button>
            )}
            {!all && alerts.length > maxShown && (
              <button type="button" className={`${MORE} hidden @xl:inline`} onClick={() => setAll(true)}>
                Show {alerts.length - maxShown} more
              </button>
            )}
            {all && alerts.length > SHOWN_NARROW && (
              <button type="button" className={MORE} onClick={() => setAll(false)}>
                Show the worst only
              </button>
            )}
          </div>
        </>
      )}
      {pinned && (
        <p
          className="ci-rise flex items-center gap-2 rounded-md border border-dashed border-accent bg-accent-muted/40 px-2.5 py-1 text-xs"
          aria-live="polite"
          data-testid={`${testIdPrefix}-pinned`}
        >
          <span className="text-3xs font-bold tracking-wider text-accent-foreground uppercase">Pinned</span>
          <span className="font-semibold text-fg">{keyLabel ? keyLabel(pinned) : pinned}</span>
          <span className="text-fg-secondary">is lit up in every panel below · Esc to clear</span>
          <button type="button" onClick={clear} className={`${SIGNAL_ICON_LINK} ml-auto h-6 w-6`} aria-label="Unpin" title="Unpin">
            <IconClose size={12} />
          </button>
        </p>
      )}
    </section>
  )
}
