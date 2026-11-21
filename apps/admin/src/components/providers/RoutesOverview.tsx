/**
 * FILE: apps/admin/src/components/providers/RoutesOverview.tsx
 * PURPOSE: The top of the Routes tab: one status line, one card per routed provider (health,
 *          24 h calls and cost, how many apps try it, and its switch for every app, confirmed
 *          with the apps it affects), then the app × provider matrix: each app's role for each
 *          provider in its default order, a health mark, and 24 h calls and cost. A table on
 *          wide screens, one line per app on a phone.
 */

import { useState } from 'react'
import type { AiRoute } from '../../lib/kensaurusOpsTypes'
import { formatMicroUsd, PROVIDER_STATUS } from '../../lib/providersView'
import {
  killImpact,
  providerName,
  ROLE_WORD,
  routeUsers,
  type OverviewCell,
  type OverviewRow,
  type ProviderHealth,
  type ProviderRole,
} from '../../lib/routeChains'
import type { RunStatus } from '../signal/StatusMark'
import { StatusMark, StatusPill } from '../signal/StatusMark'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn } from '../ui'

export const healthStatus = (h: ProviderHealth | undefined): RunStatus =>
  !h ? 'idle' : h.kind === 'no_check' ? 'idle' : h.kind === 'off' ? 'cancelled' : PROVIDER_STATUS[h.kind]

const ROLE_CLASS: Record<ProviderRole, string> = {
  primary: 'font-bold text-fg',
  backup: 'font-semibold text-fg-secondary',
  last: 'text-fg-secondary',
  off: 'text-fg-muted line-through',
  none: 'text-fg-faint',
}

const calls = (n: number) => `${n.toLocaleString('en-US')} call${n === 1 ? '' : 's'}`

function cellStatus(cell: OverviewCell, h: ProviderHealth | undefined): RunStatus {
  if (cell.role === 'off') return 'cancelled'
  if (cell.crit) return 'failed'
  if (cell.incidents > 0) return 'slow'
  return healthStatus(h)
}

function cellTitle(app: string, provider: string, cell: OverviewCell, h: ProviderHealth | undefined): string {
  const role =
    cell.role === 'none'
      ? `${providerName(provider)} is not in ${app}'s default order`
      : cell.role === 'off'
        ? cell.offReason === 'provider'
          ? `${providerName(provider)} is switched off for every app`
          : `${providerName(provider)}'s step is turned off in ${app}'s default order`
        : `${ROLE_WORD[cell.role]} in ${app}'s default order`
  const parts = [role, h ? `health: ${h.word}` : null, cell.incidents > 0 ? `${cell.incidents} open incident${cell.incidents === 1 ? '' : 's'} reported` : null]
  if (cell.overrides > 0) parts.push(`${cell.overrides} feature${cell.overrides === 1 ? '' : 's'} with their own order try it too`)
  parts.push(`last 24 h: ${calls(cell.calls)}, ${cell.errors} failed, ${formatMicroUsd(cell.cost)}`)
  return parts.filter(Boolean).join(' · ')
}

export interface RoutesOverviewProps {
  routes: readonly AiRoute[]
  providers: readonly string[]
  health: ReadonlyMap<string, ProviderHealth>
  rows: readonly OverviewRow[]
  status: { text: string; tone: 'ok' | 'warn' | 'danger' }
  busy: ReadonlySet<string>
  appName: (app: string) => string
  onSwitch: (health: ProviderHealth, enabled: boolean) => void
}

export const switchPendingKey = (provider: string) => `switch:${provider}`

export function RoutesOverview({ routes, providers, health, rows, status, busy, appName, onSwitch }: RoutesOverviewProps) {
  const [confirm, setConfirm] = useState<{ h: ProviderHealth; enabled: boolean } | null>(null)
  const totals = new Map(providers.map((p) => [p, rows.reduce((t, r) => ({ calls: t.calls + (r.cells.get(p)?.calls ?? 0), cost: t.cost + (r.cells.get(p)?.cost ?? 0) }), { calls: 0, cost: 0 })]))
  const impact = confirm ? killImpact(routes, confirm.h.provider, health) : null
  const users = confirm ? routeUsers(routes, confirm.h.provider, appName).map((u) => appName(u.app)) : []
  const names = (list: string[]) => (list.length === 0 ? 'none' : list.join(', '))

  return (
    <section aria-label="Overview" className="flex flex-col gap-2" data-testid="routes-overview">
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-edge bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-fg"
        data-testid="routes-status-line"
        data-tone={status.tone}
      >
        <span className="pt-px">
          <StatusMark status={status.tone === 'danger' ? 'failed' : status.tone === 'warn' ? 'slow' : 'passed'} />
        </span>
        <span className="min-w-0">{status.text}</span>
      </p>

      <ul className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4" aria-label="Providers the routes use">
        {providers.map((p) => {
          const h = health.get(p)!
          const t = totals.get(p)!
          const appsOn = new Set(routes.filter((r) => r.provider === p && r.enabled).map((r) => r.app)).size
          const isBusy = busy.has(switchPendingKey(p))
          return (
            <li key={p} className="flex flex-col gap-1 rounded-md border border-edge bg-surface px-2.5 py-2" data-testid={`provider-card-${p}`} data-health={h.kind}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-fg">{providerName(p)}</span>
                <StatusPill status={healthStatus(h)} label={h.word} />
              </div>
              <span className="text-2xs text-fg-secondary tabular-nums">
                {appsOn === 1 ? '1 app tries it' : `${appsOn} apps try it`} · 24 h: {calls(t.calls)} · {formatMicroUsd(t.cost)}
              </span>
              {h.kind === 'no_check' ? (
                <span className="flex flex-col gap-1">
                  <Btn size="sm" variant="ghost" disabled aria-label={`Switch off ${providerName(p)} for every app (not available)`} data-testid={`provider-switch-${p}`}>
                    Switch off for every app
                  </Btn>
                  <span className="text-3xs text-fg-muted">No account for it on kenji yet, so there is no health check or switch. Turn its steps off in each order instead.</span>
                </span>
              ) : (
                <Btn
                  size="sm"
                  variant={h.killed ? 'primary' : 'danger'}
                  loading={isBusy}
                  disabled={isBusy}
                  onClick={() => setConfirm({ h, enabled: h.killed })}
                  data-testid={`provider-switch-${p}`}
                >
                  {h.killed ? 'Switch on for every app' : 'Switch off for every app'}
                </Btn>
              )}
            </li>
          )
        })}
      </ul>

      {/* Wide: app × provider table. */}
      <div className="hidden overflow-x-auto rounded-md border border-edge sm:block">
        <table className="w-full border-collapse text-2xs" data-testid="routes-matrix">
          <caption className="sr-only">Each app's role for each provider in its default order, with the last 24 hours</caption>
          <thead>
            <tr className="bg-surface-overlay">
              <th scope="col" className="px-2 py-1 text-left font-bold text-fg-secondary">
                App
              </th>
              {providers.map((p) => (
                <th key={p} scope="col" className="px-2 py-1 text-left font-bold text-fg-secondary">
                  {providerName(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.app} className="border-t border-edge-subtle" data-testid={`matrix-row-${r.app}`}>
                <th scope="row" className="px-2 py-1.5 text-left align-top font-bold text-fg" title={r.app}>
                  {appName(r.app)}
                  {r.incidents > 0 && <span className="ml-1 font-semibold text-st-failed-ink">▲ {r.incidents}</span>}
                </th>
                {providers.map((p) => {
                  const c = r.cells.get(p)!
                  const h = health.get(p)
                  return (
                    <td key={p} className="px-2 py-1.5 align-top" title={cellTitle(appName(r.app), p, c, h)} data-testid={`matrix-cell-${r.app}-${p}`} data-role={c.role}>
                      <span className="flex items-center gap-1">
                        {c.role !== 'none' && <StatusMark status={cellStatus(c, h)} />}
                        <span className={ROLE_CLASS[c.role]}>{ROLE_WORD[c.role]}</span>
                        {c.overrides > 0 && (
                          <span className="text-3xs text-fg-muted">
                            {c.role === 'none' ? `in ${c.overrides} override${c.overrides === 1 ? '' : 's'}` : `+${c.overrides} override${c.overrides === 1 ? '' : 's'}`}
                          </span>
                        )}
                      </span>
                      {(c.calls > 0 || c.cost > 0) && (
                        <span className="block font-mono text-3xs text-fg-muted tabular-nums">
                          {c.calls.toLocaleString('en-US')} · {formatMicroUsd(c.cost)}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one line per app, its providers in the order they are tried. */}
      <ul className="flex list-none flex-col divide-y divide-edge-subtle rounded-md border border-edge p-0 sm:hidden" aria-label="Each app's default order" data-testid="routes-matrix-phone">
        {rows.map((r) => {
          const tried = providers
            .map((p) => ({ p, c: r.cells.get(p)! }))
            .filter((x) => x.c.role !== 'none')
            .sort((a, b) => ROLE_RANK[a.c.role] - ROLE_RANK[b.c.role])
          return (
            <li key={r.app} className="flex flex-col gap-0.5 px-2.5 py-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-fg">{appName(r.app)}</span>
                <span className="font-mono text-3xs text-fg-muted tabular-nums">
                  {r.incidents > 0 && <span className="mr-1 font-sans font-semibold text-st-failed-ink">▲ {r.incidents}</span>}
                  24 h {r.calls.toLocaleString('en-US')} · {formatMicroUsd(r.cost)}
                </span>
              </span>
              <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-2xs">
                {tried.map(({ p, c }) => (
                  <span key={p} className="inline-flex items-center gap-1" title={cellTitle(appName(r.app), p, c, health.get(p))}>
                    <StatusMark status={cellStatus(c, health.get(p))} />
                    <span className="text-fg-secondary">{providerName(p)}</span>
                    <span className={ROLE_CLASS[c.role]}>{ROLE_WORD[c.role].toLowerCase()}</span>
                  </span>
                ))}
              </span>
            </li>
          )
        })}
      </ul>

      {confirm && impact && (
        <ConfirmDialog
          title={confirm.enabled ? `Switch ${providerName(confirm.h.provider)} on for every app?` : `Switch ${providerName(confirm.h.provider)} off for every app?`}
          body={
            confirm.enabled
              ? `The router tries it again within a minute, wherever an order has it. Apps whose orders have it: ${names(users)}.`
              : `The router stops trying it within a minute and moves to each order's next step. Apps that use it now: ${names(impact.apps.map(appName))}.`
          }
          details={
            !confirm.enabled && impact.stranded.length > 0 ? (
              <div className="rounded-sm border border-st-failed/55 bg-st-failed-soft px-2 py-1 text-st-failed-ink" data-testid="kill-stranded">
                Nothing left to try for:{' '}
                {impact.stranded.map((s) => `${appName(s.app)} (${s.features.map((f) => (f === '*' ? 'default' : f)).join(', ')})`).join('; ')}. Those calls will fail until it is back.
              </div>
            ) : undefined
          }
          confirmLabel={confirm.enabled ? 'Switch on' : 'Switch off'}
          tone={confirm.enabled ? 'default' : 'danger'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onSwitch(confirm.h, confirm.enabled)
            setConfirm(null)
          }}
        />
      )}
    </section>
  )
}

const ROLE_RANK: Record<ProviderRole, number> = { primary: 0, backup: 1, last: 2, off: 3, none: 4 }
