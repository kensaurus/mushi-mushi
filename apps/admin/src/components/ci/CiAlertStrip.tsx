/**
 * FILE: apps/admin/src/components/ci/CiAlertStrip.tsx
 * PURPOSE: The first thing on /ci (2026-11-17): what is wrong, worst first, as short cards.
 *          Critical cards are red with a pulsing triangle; serious ones amber with a diamond.
 *          Pointing at a card lights the same app, job or machine in every panel below; a
 *          click pins it (the "Pinned" trail says what, Escape clears). Each card has icon
 *          actions: open the GitHub log, and jump to the evidence.
 */

import { useMemo, useState } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import type { CiStatus } from '../../lib/ciStatus'
import { ALERTS_SHOWN, rankCiAlerts, type CiAlert } from '../../lib/ciAlerts'
import { useCiLink, useCiPinned, type CiKey } from '../../lib/ciHighlight'
import { repoShortName } from '../../lib/ciView'
import { IconArrowRight, IconCheck, IconClose, IconExternalLink } from '../icons'

/** Cards on a narrow screen before "Show more". */
const ALERTS_SHOWN_NARROW = 3
const MORE = 'self-start text-2xs font-medium text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg'

const ICON_LINK =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm border border-edge bg-surface-raised text-fg-secondary ' +
  'motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-px hover:border-accent hover:text-accent ' +
  'active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

/** The severity's shape: a pulsing triangle for critical, a diamond for serious. */
function SeverityMark({ severity }: { severity: CiAlert['severity'] }) {
  if (severity === 'critical') {
    return (
      <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-60 motion-safe:animate-ping" />
        <svg viewBox="0 0 12 12" className="relative h-3 w-3 text-danger" fill="currentColor">
          <path d="M6 1 11.5 11H.5z" />
        </svg>
      </span>
    )
  }
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-warn" fill="currentColor" aria-hidden="true">
      <path d="M6 .5 11.5 6 6 11.5.5 6z" />
    </svg>
  )
}

function AlertCard({ alert, index, narrowHidden }: { alert: CiAlert; index: number; narrowHidden: boolean }) {
  const link = useCiLink(alert.keys, alert.keys[0] ?? alert.id, true)
  const critical = alert.severity === 'critical'
  return (
    <li
      {...link}
      className={`${link.className} ci-rise group relative flex min-w-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-md border py-2 pr-2.5 pl-3.5 motion-safe:hover:-translate-y-0.5 ${narrowHidden ? 'hidden @xl:flex' : ''} ${
        critical ? 'border-danger/55 bg-danger-muted' : 'border-warn/55 bg-warn-muted'
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
      data-testid={`ci-alert-${alert.id}`}
      data-severity={alert.severity}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${critical ? 'bg-danger' : 'bg-warn'}`} aria-hidden="true" />
      <span className="flex items-center gap-1.5">
        <SeverityMark severity={alert.severity} />
        <span className={`text-3xs font-bold tracking-wider uppercase ${critical ? 'text-danger-foreground' : 'text-warn-foreground'}`}>
          {critical ? 'Critical' : alert.label}
        </span>
        {alert.app && <span className="ml-auto truncate text-3xs font-medium text-fg-secondary">{alert.app}</span>}
      </span>
      <button
        type="button"
        className="text-left text-sm leading-snug font-bold text-fg focus-visible:outline-none focus-visible:underline"
        aria-pressed={link['data-pinned'] ?? false}
        title="Pin: light this up across the page"
      >
        {alert.title}
      </button>
      <span className="text-xs leading-snug text-fg-secondary">{alert.detail}</span>
      <span className="mt-auto flex items-end justify-between gap-2 pt-1">
        <span className="leading-none">
          <span className="font-mono text-xl font-extrabold text-fg tabular-nums">{alert.metric.value}</span>
          <span className="ml-0.5 text-2xs font-semibold text-fg-secondary">{alert.metric.unit}</span>
        </span>
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {alert.href && (
            <a
              href={alert.href}
              target="_blank"
              rel="noopener noreferrer"
              className={ICON_LINK}
              aria-label="Open the log on GitHub"
              title="Open the log on GitHub"
            >
              <IconExternalLink size={13} />
            </a>
          )}
          <a href={alert.jump} className={ICON_LINK} aria-label="Show the evidence" title="Show the evidence">
            <IconArrowRight size={13} className="rotate-90" />
          </a>
        </span>
      </span>
    </li>
  )
}

/** A readable name for a highlight key. */
function keyLabel(overview: Pick<CiOverview, 'repos'>, key: CiKey): string {
  const [kind, rest = ''] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  const app = (repo: string) => overview.repos.find((r) => r.repo === repo)?.projectName || repoShortName(repo)
  if (kind === 'repo') return app(rest)
  if (kind === 'job') {
    const [repo = '', job = ''] = [rest.slice(0, rest.indexOf('|')), rest.slice(rest.indexOf('|') + 1)]
    return `${job} · ${app(repo)}`
  }
  return rest
}

export function CiAlertStrip({ overview, status, now }: { overview: CiOverview; status: CiStatus; now: number }) {
  const alerts = useMemo(() => rankCiAlerts(overview, status, now), [overview, status, now])
  const [all, setAll] = useState(false)
  const { pinned, clear } = useCiPinned()
  const shown = all ? alerts : alerts.slice(0, ALERTS_SHOWN)
  const critical = alerts.filter((a) => a.severity === 'critical').length

  return (
    <section aria-label="What needs attention" className="flex flex-col gap-2" data-testid="ci-alerts">
      {alerts.length === 0 ? (
        <p className="ci-rise flex items-center gap-2 rounded-md border border-ok/45 bg-ok-muted px-3 py-2 text-sm font-semibold text-fg" role="status">
          <IconCheck size={15} className="text-ok" />
          Nothing needs you: no failing jobs, nothing stuck, no machine down.
        </p>
      ) : (
        <>
          <h2 className="sr-only">
            {alerts.length} problem{alerts.length === 1 ? '' : 's'}, {critical} critical
          </h2>
          {/* The worst three on a phone, six on a wide screen, so the page itself is still in view. */}
          <div className="@container flex flex-col gap-2">
            <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3 @min-[96rem]:grid-cols-6">
              {shown.map((a, i) => (
                <AlertCard key={a.id} alert={a} index={i} narrowHidden={!all && i >= ALERTS_SHOWN_NARROW} />
              ))}
            </ul>
            {!all && alerts.length > ALERTS_SHOWN_NARROW && (
              <button type="button" className={`${MORE} @xl:hidden`} onClick={() => setAll(true)}>
                Show {alerts.length - ALERTS_SHOWN_NARROW} more
              </button>
            )}
            {!all && alerts.length > ALERTS_SHOWN && (
              <button type="button" className={`${MORE} hidden @xl:inline`} onClick={() => setAll(true)}>
                Show {alerts.length - ALERTS_SHOWN} more
              </button>
            )}
            {all && alerts.length > ALERTS_SHOWN_NARROW && (
              <button type="button" className={MORE} onClick={() => setAll(false)}>
                Show the worst only
              </button>
            )}
          </div>
        </>
      )}
      {/* Always in the layout while pinned, so nothing below jumps. */}
      {pinned && (
        <p
          className="ci-rise flex items-center gap-2 rounded-md border border-dashed border-accent bg-accent-muted/40 px-2.5 py-1 text-xs"
          aria-live="polite"
          data-testid="ci-pinned"
        >
          <span className="text-3xs font-bold tracking-wider text-accent-foreground uppercase">Pinned</span>
          <span className="font-semibold text-fg">{keyLabel(overview, pinned)}</span>
          <span className="text-fg-secondary">is lit up in every panel below · Esc to clear</span>
          <button type="button" onClick={clear} className={`${ICON_LINK} ml-auto h-6 w-6`} aria-label="Unpin" title="Unpin">
            <IconClose size={12} />
          </button>
        </p>
      )}
    </section>
  )
}
