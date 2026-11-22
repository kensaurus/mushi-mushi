/**
 * FILE: apps/admin/src/components/providers/ProvidersAlerts.tsx
 * PURPOSE: What is wrong on /providers, worst first, as at most three short
 *          cards above the tabs: providers down (critical, pulsing) or warn,
 *          open critical incidents, apps that cost more than they sell. A
 *          click opens the tab with the evidence.
 */

import type { ProvidersAlert, ProvidersTab } from '../../lib/providersView'
import { StatusGlyph } from '../signal/StatusGlyph'

export function ProvidersAlerts({ alerts, onOpen }: { alerts: readonly ProvidersAlert[]; onOpen: (tab: ProvidersTab) => void }) {
  if (alerts.length === 0) return null
  return (
    <ul className="grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-3" aria-label="What needs you" data-testid="providers-alerts">
      {alerts.map((a, i) => {
        const critical = a.severity === 'critical'
        return (
          <li
            key={a.id}
            className={`ci-rise relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border py-2 pr-2.5 pl-3.5 ${
              critical ? 'border-danger/55 bg-danger-muted' : 'border-warn/55 bg-warn-muted'
            }`}
            style={{ animationDelay: `${i * 60}ms` }}
            data-testid={`providers-alert-${a.id}`}
            data-severity={a.severity}
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${critical ? 'bg-danger' : 'bg-warn'}`} aria-hidden="true" />
            <span className="flex items-center gap-1.5">
              <StatusGlyph tone={critical ? 'danger' : 'warn'} pulse={critical} />
              <span className={`text-3xs font-bold tracking-wider uppercase ${critical ? 'text-danger-foreground' : 'text-warn-foreground'}`}>{a.label}</span>
            </span>
            <button
              type="button"
              onClick={() => onOpen(a.tab)}
              className="text-left text-sm leading-snug font-bold text-fg after:absolute after:inset-0 focus-visible:underline focus-visible:outline-none"
            >
              {a.title}
            </button>
            <span className="truncate text-xs leading-snug text-fg-secondary">{a.detail}</span>
            <span className="leading-none">
              <span className="font-mono text-xl font-extrabold text-fg tabular-nums">{a.metric.value}</span>
              <span className="ml-0.5 text-2xs font-semibold text-fg-secondary">{a.metric.unit}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
