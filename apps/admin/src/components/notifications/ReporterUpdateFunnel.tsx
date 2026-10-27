/**
 * FILE: apps/admin/src/components/notifications/ReporterUpdateFunnel.tsx
 * PURPOSE: Did my users hear back about their bugs? (console journeys
 *          2026-10-27). Reporter updates opened on message counts and an
 *          Inbox/Outbox split; it now leads with a funnel counted in bug
 *          reports: the reporter was told, opened the update, and replied.
 *
 *          The numbers come from GET /v1/admin/notifications/stats
 *          (`funnel`, over the latest 500 updates). With no funnel (an older
 *          server, or the replies could not be read) the card is left out:
 *          the status sentence above still says what was sent.
 */

import { Card } from '../ui'
import type { ReporterFunnel } from './types'

interface Stage {
  key: 'told' | 'opened' | 'replied'
  label: string
  value: number
  bar: string
}

/** @internal Exported for tests. Share of told reports, rounded; 0 when nothing was told. */
export function funnelPct(value: number, told: number): number {
  if (told <= 0) return 0
  return Math.round((Math.min(value, told) / told) * 100)
}

/** @internal Exported for tests. The one sentence under the bars. */
export function funnelSentence(f: ReporterFunnel): string {
  if (f.told === 0) return 'No reporter has been told about a bug yet.'
  const notOpened = f.told - Math.min(f.opened, f.told)
  if (notOpened === 0) return 'Every reporter opened their update.'
  return `${notOpened} of ${f.told} reporters have not opened their update yet. They see it the next time they open the widget.`
}

export function ReporterUpdateFunnel({ funnel }: { funnel: ReporterFunnel }) {
  const stages: Stage[] = [
    { key: 'told', label: 'Told', value: funnel.told, bar: 'bg-info' },
    { key: 'opened', label: 'Opened', value: funnel.opened, bar: 'bg-brand' },
    { key: 'replied', label: 'Replied', value: funnel.replied, bar: 'bg-ok' },
  ]
  return (
    <Card className="p-4" data-testid="reporter-update-funnel">
      <h2 className="text-sm font-semibold text-fg">Did reporters hear back?</h2>
      <p className="mb-3 text-2xs text-fg-muted">Counted in bug reports, over your latest 500 updates.</p>
      <dl className="space-y-2">
        {stages.map((s) => {
          const pct = funnelPct(s.value, funnel.told)
          return (
            <div key={s.key} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
              <dt className="text-xs text-fg-secondary">{s.label}</dt>
              <div aria-hidden="true" className="h-2.5 min-w-0 overflow-hidden rounded-full bg-surface-overlay">
                <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${s.key === 'told' ? (funnel.told > 0 ? 100 : 0) : pct}%` }} />
              </div>
              <dd className="m-0 text-right text-xs tabular-nums text-fg">
                {s.value}
                {s.key !== 'told' && funnel.told > 0 ? <span className="ml-1 text-fg-faint">({pct}%)</span> : null}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="mt-3 text-xs text-fg-secondary">{funnelSentence(funnel)}</p>
    </Card>
  )
}
