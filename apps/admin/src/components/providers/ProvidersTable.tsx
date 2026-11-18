/**
 * FILE: apps/admin/src/components/providers/ProvidersTable.tsx
 * PURPOSE: The Providers tab: one dense row per provider account, worst
 *          first. State mark with how long it held, label + provider chip,
 *          a balance or usage bar against warn/crit, last probe age, open
 *          incidents, dependent apps, an on/off switch and the thresholds
 *          editor (a drawer).
 */

import type { ProviderAccount } from '../../lib/kensaurusOpsTypes'
import { ageLabel, dependentApps, PROVIDER_STATUS, providerGauge, providerState, type Gauge } from '../../lib/providersView'
import { Btn, Toggle } from '../ui'
import { IconSliders } from '../icons'
import { Chip } from '../signal/Chip'
import { ThresholdBar } from '../signal/BarCell'
import { StatusMark, StatusPill } from '../signal/StatusMark'

function GaugeCell({ gauge }: { gauge: Gauge | null }) {
  if (!gauge) return <span className="text-3xs text-fg-faint">no balance</span>
  const fill = gauge.max > 0 ? gauge.value / gauge.max : 0
  const at = (v: number | null) => (v == null || gauge.max <= 0 ? null : v / gauge.max)
  return <ThresholdBar fill={fill} warn={at(gauge.warn)} crit={at(gauge.crit)} level={gauge.level} label={gauge.label} />
}

export interface ProvidersTableProps {
  providers: readonly ProviderAccount[]
  incidents: ReadonlyMap<string, { total: number; crit: number }>
  now: number
  pending: ReadonlySet<string>
  onToggle: (account: ProviderAccount, enabled: boolean) => void
  onEditThresholds: (account: ProviderAccount) => void
}

export const providerPendingKey = (id: string) => `provider:${id}`

export function ProvidersTable({ providers, incidents, now, pending, onToggle, onEditThresholds }: ProvidersTableProps) {
  if (providers.length === 0) return <p className="text-xs text-fg-muted">No provider accounts yet.</p>
  return (
    <ul className="list-none divide-y divide-edge-subtle overflow-hidden rounded-md border border-edge p-0" aria-label="Provider accounts, worst first" data-testid="providers-rows">
      {providers.map((p) => {
        const state = providerState(p)
        const inc = incidents.get(p.id)
        const busy = pending.has(providerPendingKey(p.id))
        const apps = dependentApps(p)
        return (
          <li
            key={p.id}
            className={`flex flex-col gap-x-3 gap-y-1 bg-surface px-2.5 py-1.5 hover:bg-surface-hover md:flex-row md:items-center ${p.enabled ? '' : 'opacity-60'}`}
            data-testid={`provider-row-${p.id}`}
            data-state={state}
          >
            <span className="md:w-32 md:shrink-0">
              <StatusPill status={PROVIDER_STATUS[state]} label={[state, ageLabel(p.status?.state_since, now)].filter(Boolean).join(' · ')} />
            </span>
            <span className="flex min-w-0 items-center gap-1.5 md:flex-1">
              <span className="truncate text-sm font-bold text-fg" title={p.status?.detail ?? undefined}>
                {p.label}
              </span>
              <Chip>{p.provider}</Chip>
              {p.is_test && <Chip>test</Chip>}
            </span>
            <span className="md:w-44 md:shrink-0">
              <GaugeCell gauge={providerGauge(p)} />
            </span>
            <span className="font-mono text-2xs text-fg-secondary tabular-nums md:w-12 md:shrink-0" title="Last probe">
              {ageLabel(p.status?.last_probe_at, now) ?? '—'}
            </span>
            <span className="md:w-14 md:shrink-0">
              {inc ? (
                <Chip tone={inc.crit > 0 ? 'danger' : 'neutral'} title={`${inc.total} open incident${inc.total === 1 ? '' : 's'}`}>
                  ▲ {inc.total}
                </Chip>
              ) : (
                <span className="text-3xs text-fg-faint">—</span>
              )}
            </span>
            <span className="flex min-w-0 flex-wrap gap-1 md:w-48 md:shrink-0" aria-label="Apps that use it">
              {apps.map((a) => (
                <Chip key={a} tone="strong">
                  {a}
                </Chip>
              ))}
            </span>
            <span className="flex items-center justify-end gap-1.5 md:ml-auto">
              {busy && (
                <span role="status" aria-label="Saving" data-testid="pending-mark">
                  <StatusMark status="running" />
                </span>
              )}
              <Toggle
                ariaLabel={`${p.enabled ? 'Turn off' : 'Turn on'} ${p.label}`}
                checked={p.enabled}
                disabled={busy}
                onChange={(next) => onToggle(p, next)}
              />
              <Btn size="sm" variant="ghost" aria-label={`Thresholds for ${p.label}`} title="Thresholds" disabled={busy} onClick={() => onEditThresholds(p)}>
                <IconSliders size={14} />
              </Btn>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
