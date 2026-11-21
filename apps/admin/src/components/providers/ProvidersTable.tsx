/**
 * FILE: apps/admin/src/components/providers/ProvidersTable.tsx
 * PURPOSE: The Providers tab: one dense row per provider account, worst
 *          first. State mark with how long it held, label + provider chip,
 *          a balance or usage bar against warn/crit, last probe age, open
 *          incidents, the apps whose routes try it (from the routes, not the
 *          account's stale `depends`; 2026-11-21), an on/off switch and the
 *          thresholds editor (a drawer).
 */

import type { AiRoute, ProviderAccount } from '../../lib/kensaurusOpsTypes'
import { routeUsers } from '../../lib/routeChains'
import { accountLabel, ageLabel, allSharedAccounts, balanceWhy, PROVIDER_STATE_WORD, PROVIDER_STATUS, providerColumns, providerGauge, providerNeeds, providerState, type Gauge } from '../../lib/providersView'
import type { SetupProject } from '../../lib/useSetupStatus'
import { faviconSourceFromProject } from '../../lib/resolveProjectDomain'
import { ProjectFavicon } from '../ProjectFavicon'
import { Btn, Toggle } from '../ui'
import { IconSliders } from '../icons'
import { Chip } from '../signal/Chip'
import { ThresholdBar } from '../signal/BarCell'
import { StatusMark, StatusPill } from '../signal/StatusMark'

/** Column widths shared by the header and every row, so a value always sits under its name. */
const COL = {
  state: 'md:w-32 md:shrink-0',
  account: 'md:min-w-0 md:flex-1',
  balance: 'md:w-44 md:shrink-0',
  probed: 'md:w-16 md:shrink-0',
  incidents: 'md:w-20 md:shrink-0',
  apps: 'md:w-48 md:shrink-0',
  on: 'md:w-24 md:shrink-0',
} as const

function GaugeCell({ gauge, why }: { gauge: Gauge | null; why: string }) {
  // No balance reading: hatched with the reason ("key check only"), never an empty bar.
  if (!gauge)
    return (
      <span className="ci-nodata inline-flex items-center rounded-sm border border-edge-subtle px-1.5 text-3xs whitespace-nowrap text-fg-secondary" data-testid="gauge-not-checked">
        {why}
      </span>
    )
  const fill = gauge.max > 0 ? gauge.value / gauge.max : 0
  const at = (v: number | null) => (v == null || gauge.max <= 0 ? null : v / gauge.max)
  return <ThresholdBar fill={fill} warn={at(gauge.warn)} crit={at(gauge.crit)} level={gauge.level} label={gauge.label} />
}

export interface ProvidersTableProps {
  providers: readonly ProviderAccount[]
  /** The AI routes: "Used by" is the apps whose turned-on routes try the account's provider. */
  routes: readonly AiRoute[]
  incidents: ReadonlyMap<string, { total: number; crit: number }>
  now: number
  pending: ReadonlySet<string>
  onToggle: (account: ProviderAccount, enabled: boolean) => void
  onEditThresholds: (account: ProviderAccount) => void
  /** The console's name for an ops app slug (makeAppNamer); the slug itself when none matches. */
  appName?: (app: string) => string
  /** The console's project for an ops app slug (makeAppProjectFinder), for the chip's icon. */
  appProject?: (app: string) => SetupProject | null
}

/** One app that uses the account: its icon and console name; the features on hover. */
function AppChip({ app, features, name, project }: { app: string; features: string[]; name: string; project: SetupProject | null }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised px-1 py-px text-2xs font-medium text-fg"
      title={features.length > 0 ? `${name} routes to it for: ${features.join(', ')}` : name}
      data-testid="provider-app"
      data-app={app}
    >
      {project ? <ProjectFavicon {...faviconSourceFromProject(project)} size={12} /> : null}
      <span className="truncate">{name}</span>
    </span>
  )
}

export const providerPendingKey = (id: string) => `provider:${id}`

export function ProvidersTable({ providers, routes, incidents, now, pending, onToggle, onEditThresholds, appName = (a) => a, appProject = () => null }: ProvidersTableProps) {
  if (providers.length === 0) return <p className="text-xs text-fg-muted">No provider accounts yet.</p>
  // Balance and Incidents draw only once some row has a value; the note says it once otherwise.
  const cols = providerColumns(providers, incidents)
  const sharedAll = allSharedAccounts(providers)
  return (
    <div className="flex flex-col gap-1.5">
    <ul className="list-none divide-y divide-edge-subtle overflow-hidden rounded-md border border-edge p-0" aria-label="Provider accounts, worst first" data-testid="providers-rows">
      {/* Column names (2026-11-18: "11m" and "—" had no label). Wide screens only; each cell keeps its own title. */}
      <li
        aria-hidden="true"
        className="hidden gap-x-3 bg-surface-raised px-2.5 py-1 text-2xs font-semibold text-fg-secondary md:flex md:items-center"
        data-testid="providers-head"
      >
        <span className={COL.state}>State</span>
        {/* "(shared key)" on every row said once, here (round 3). */}
        <span className={COL.account}>{sharedAll ? 'Shared account' : 'Account'}</span>
        {cols.balance && <span className={COL.balance}>Balance</span>}
        <span className={COL.probed}>Probed</span>
        {cols.incidents && <span className={COL.incidents}>Incidents</span>}
        <span className={COL.apps}>Used by</span>
        <span className={`${COL.on} text-right`}>On</span>
      </li>
      {providers.map((p) => {
        const state = providerState(p)
        const shown = accountLabel(p, sharedAll)
        const inc = incidents.get(p.id)
        const busy = pending.has(providerPendingKey(p.id))
        const apps = routeUsers(routes, p.provider, appName)
        const probed = ageLabel(p.status?.last_probe_at, now)
        const age = ageLabel(p.status?.state_since, now)
        const needs = providerNeeds(p, now)
        return (
          <li
            key={p.id}
            className="flex flex-col gap-x-3 gap-y-1 bg-surface px-2.5 py-1.5 hover:bg-surface-hover md:flex-row md:flex-wrap md:items-center"
            data-testid={`provider-row-${p.id}`}
            data-state={state}
          >
            <span className={COL.state}>
              {/* A plain word beside the glyph ("Working", "Not checked"); how long it held on hover. */}
              <StatusPill
                status={p.enabled ? PROVIDER_STATUS[state] : 'cancelled'}
                label={p.enabled ? PROVIDER_STATE_WORD[state] : 'Off'}
                title={age ? `In this state for ${age}` : undefined}
              />
              {age ? (
                <span className="ml-1 font-mono text-3xs text-fg-muted tabular-nums" title={`In this state for ${age}`}>
                  {age}
                </span>
              ) : null}
            </span>
            <span className={`flex min-w-0 items-center gap-1.5 ${COL.account}`}>
              <span className="truncate text-sm font-bold text-fg" title={p.status?.detail ?? p.label}>
                {shown.text}
              </span>
              {/* The provider chip only when the name does not already say it ("Anthropic" + "anthropic", round 3). */}
              {shown.showProvider && <Chip>{p.provider}</Chip>}
              {p.is_test && <Chip>test</Chip>}
            </span>
            {cols.balance && (
              <span className={COL.balance}>
                <GaugeCell gauge={providerGauge(p)} why={balanceWhy(p)} />
              </span>
            )}
            {/* On a phone there is no header row, so each value carries its own words. */}
            <span className={`font-mono text-2xs whitespace-nowrap text-fg-secondary tabular-nums ${COL.probed}`} title="Last probe" data-testid="provider-probed">
              {probed ? (
                <>
                  <span className="font-sans md:hidden">probed </span>
                  {probed}
                  <span className="font-sans md:hidden"> ago</span>
                </>
              ) : (
                <>
                  <span className="font-sans md:hidden">never probed</span>
                  <span className="hidden md:inline">—</span>
                </>
              )}
            </span>
            {cols.incidents && (
            <span className={COL.incidents} data-testid="provider-incidents">
              {inc ? (
                <Chip tone={inc.crit > 0 ? 'danger' : 'neutral'} title={`${inc.total} open incident${inc.total === 1 ? '' : 's'}`}>
                  ▲ {inc.total}
                  <span className="md:hidden"> open</span>
                </Chip>
              ) : (
                <span className="text-3xs whitespace-nowrap text-fg-faint">
                  <span className="md:hidden">no incidents</span>
                  <span className="hidden md:inline">—</span>
                </span>
              )}
            </span>
            )}
            {/* One chip per app with its icon; the features it calls this account for on hover. */}
            <span className={`flex min-w-0 flex-wrap gap-1 ${COL.apps}`} aria-label="Apps whose routes try it" data-testid="provider-used-by">
              {apps.map((a) => (
                <AppChip key={a.app} app={a.app} features={a.features} name={appName(a.app)} project={appProject(a.app)} />
              ))}
              {apps.length === 0 && <span className="text-3xs text-fg-faint">no AI routes</span>}
            </span>
            <span className={`flex items-center justify-end gap-1.5 ${COL.on}`}>
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
            {needs ? (
              <p className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-secondary md:pl-32" data-testid="provider-needs">
                <span className="min-w-0">{needs.text}</span>
                {needs.action === 'turn_on' ? (
                  <Btn size="sm" variant="primary" disabled={busy} onClick={() => onToggle(p, true)}>
                    Turn on
                  </Btn>
                ) : null}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
    {cols.note && (
      <p className="text-2xs text-fg-muted" data-testid="providers-columns-note">
        {cols.note}
      </p>
    )}
    </div>
  )
}
