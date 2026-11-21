/**
 * FILE: apps/admin/src/components/providers/RoutesPanel.tsx
 * PURPOSE: The Routes tab (2026-11-21 redesign; it used to draw all 332 route rows as cards):
 *            1. overview: one status line, provider cards with their switch, the app × provider
 *               matrix (RoutesOverview);
 *            2. "Cheaper model available", from the weekly model scout's Ops hub event;
 *            3. per app, its fallback orders: features with the same steps fold into one line
 *               ("OpenAI gpt-6-luna → OpenRouter gpt-6-luna → Anthropic claude-haiku-5-5 · 23
 *               features"); clicking one opens it in ChainDrawer.
 *          The last save's outcome stays on top until dismissed when it stopped part-way.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { OpsFeedResponse } from '../../lib/opsTypes'
import { paramChips } from '../../lib/providersView'
import { chainTitle, modelShort, providerName, scoutSuggestions, type AppChains, type ProviderHealth, type RouteChain } from '../../lib/routeChains'
import { usePageData } from '../../lib/usePageData'
import { useActiveOrgId } from '../OrgSwitcher'
import { Btn, Callout } from '../ui'
import { Chip } from '../signal/Chip'
import { StatusMark } from '../signal/StatusMark'
import { healthStatus } from './RoutesOverview'

const featureWord = (f: string) => (f === '*' ? 'default' : f)

function ChainSteps({ chain, health }: { chain: RouteChain; health: ReadonlyMap<string, ProviderHealth> }) {
  return (
    <ol className="flex list-none flex-wrap items-center gap-x-1 gap-y-0.5 p-0" aria-label="Steps, first tried first">
      {chain.steps.map((s, i) => {
        const h = health.get(s.provider)
        const off = !s.enabled || h?.killed
        // The short settings only (effort, reasoning, thinking); a raw body or key name is in the drawer.
        const chips = paramChips(s.params).filter((c) => !c.startsWith('key ') && !c.startsWith('body '))
        return (
          <li key={i} className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
            {i > 0 && (
              <span aria-hidden="true" className="text-fg-faint">
                →
              </span>
            )}
            <StatusMark status={off ? 'cancelled' : healthStatus(h)} label={off ? 'off' : (h?.word ?? '')} />
            <span className={`whitespace-nowrap ${off ? 'text-fg-muted line-through' : 'text-fg'}`}>
              <span className="font-semibold">{providerName(s.provider)}</span> <span className="font-mono">{modelShort(s.model)}</span>
            </span>
            {!s.enabled && <span className="text-3xs text-fg-muted">off</span>}
            {chips.length > 0 && <span className="text-3xs whitespace-nowrap text-fg-muted">{chips.join(' · ')}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function ChainRow({ chain, health, cheaper, onOpen }: { chain: RouteChain; health: ReadonlyMap<string, ProviderHealth>; cheaper: boolean; onOpen: (c: RouteChain) => void }) {
  const features = chain.members.map((m) => featureWord(m.feature))
  return (
    <li className="flex flex-col gap-1 px-2.5 py-2 hover:bg-surface-hover" data-testid={`chain-${chain.app}-${chain.members[0]!.feature}`} data-features={features.length}>
      <button
        type="button"
        className="flex w-full min-w-0 flex-col items-start gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onClick={() => onOpen(chain)}
        aria-label={`Edit ${chainTitle(chain)} fallback order, ${features.length} feature${features.length === 1 ? '' : 's'}`}
        data-testid="chain-open"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`text-xs font-bold ${chain.isDefault ? 'text-fg' : 'text-fg-secondary'}`}>{chainTitle(chain)}</span>
          <span className="text-3xs text-fg-muted">
            {features.length} feature{features.length === 1 ? '' : 's'}
          </span>
          {cheaper && <Chip tone="strong">cheaper model available</Chip>}
          <span className="text-3xs font-semibold text-accent">Edit</span>
        </span>
        <ChainSteps chain={chain} health={health} />
      </button>
      {features.length > 1 && (
        <details className="text-2xs text-fg-secondary">
          <summary className="cursor-pointer select-none">Show features</summary>
          <p className="pt-0.5 font-mono break-words" data-testid="chain-features">
            {features.join(', ')}
          </p>
        </details>
      )}
    </li>
  )
}

/** The weekly model scout's last "cheaper" lines, each linked to the orders it would touch. */
function CheaperModels({ apps, found, appName, onOpen }: { apps: readonly AppChains[]; found: Scout; appName: (a: string) => string; onOpen: (id: string) => void }) {
  const byId = useMemo(() => new Map(apps.flatMap((a) => a.chains.map((c) => [c.id, c] as const))), [apps])
  return (
    <Callout tone="neutral" label="Cheaper model available">
      <div data-testid="routes-cheaper">
        {!found || found.items.length === 0 ? (
          <p className="text-2xs text-fg-secondary" data-testid="routes-cheaper-empty">
            {found
              ? 'The weekly model check found nothing cheaper for the models in use.'
              : 'No suggestions yet. The weekly model check (kensaurus-model-scout on kenji) posts them to the Ops hub, and they show here.'}
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {found.items.map((s) => (
              <li key={`${s.provider}|${s.model}|${s.candidate}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs" data-testid="routes-cheaper-item">
                <span>
                  <span className="font-semibold">{providerName(s.provider)}</span> <span className="font-mono">{modelShort(s.model)}</span> ({s.currentPerM}/M) →{' '}
                  <span className="font-mono font-bold">{s.candidate}</span> ({s.candidatePerM}/M, {s.savingPct}% less)
                </span>
                {s.chains.slice(0, 4).map((id) => {
                  const c = byId.get(id)
                  return c ? (
                    <button key={id} type="button" className="text-2xs font-semibold text-accent underline-offset-2 hover:underline" onClick={() => onOpen(id)}>
                      {appName(c.app)} · {chainTitle(c)}
                    </button>
                  ) : null
                })}
              </li>
            ))}
            <li className="text-3xs text-fg-muted">
              Suggestions only: compare the two side by side before switching. The new model needs a price on kenji first. Checked {found.at.slice(0, 10)}.
            </li>
          </ul>
        )}
      </div>
    </Callout>
  )
}

export interface RoutesPanelProps {
  apps: readonly AppChains[]
  health: ReadonlyMap<string, ProviderHealth>
  appName: (app: string) => string
  overview: ReactNode
  /** The last save's outcome when it stopped part-way. */
  report: { app: string; text: string } | null
  onDismissReport: () => void
  onOpen: (chainId: string) => void
}

type Scout = ReturnType<typeof scoutSuggestions>
const NO_EVENTS: OpsFeedResponse['events'] = []

export function RoutesPanel({ apps, health, appName, overview, report, onDismissReport, onOpen }: RoutesPanelProps) {
  // The scout posts to the Ops hub (kind ai.model_scout, category releases); read it back here.
  const orgId = useActiveOrgId()
  const feed = usePageData<OpsFeedResponse>(orgId ? `/v1/admin/ops/events?org=${encodeURIComponent(orgId)}&category=releases&limit=100` : null, { scope: 'enumeration' })
  const events = feed.data && Array.isArray(feed.data.events) ? feed.data.events : NO_EVENTS
  const found = useMemo(() => scoutSuggestions(events, apps), [events, apps])
  const cheaperIds = useMemo(() => new Set(found?.items.flatMap((s) => s.chains) ?? []), [found])
  return (
    <div className="flex flex-col gap-3" data-testid="providers-routes">
      {report && (
        <Callout
          tone="danger"
          label="Save stopped part-way"
          action={
            <Btn size="sm" variant="ghost" onClick={onDismissReport}>
              Dismiss
            </Btn>
          }
        >
          <p className="text-xs text-fg" role="alert" data-testid="routes-save-report">
            {report.text}
          </p>
        </Callout>
      )}
      {overview}
      {orgId && !(feed.loading && !feed.data) ? <CheaperModels apps={apps} found={found} appName={appName} onOpen={onOpen} /> : null}
      {apps.length === 0 ? (
        <p className="text-xs text-fg-muted">No routes yet.</p>
      ) : (
        <section aria-label="Fallback orders" className="flex flex-col gap-2">
          <h2 className="text-xs font-bold text-fg">
            Fallback orders <span className="font-normal text-fg-muted">· features with the same steps share one line; open one to change it for all of them</span>
          </h2>
          {apps.map((a) => (
            <section key={a.app} aria-label={`${appName(a.app)} fallback orders`} className="overflow-hidden rounded-md border border-edge">
              <h3 className="flex items-baseline justify-between gap-2 border-b border-edge-subtle bg-surface-overlay px-2.5 py-1 text-xs font-bold text-fg" title={a.app}>
                <span>{appName(a.app)}</span>
                <span className="text-3xs font-normal text-fg-muted">
                  {a.features} feature{a.features === 1 ? '' : 's'} · {a.chains.length} order{a.chains.length === 1 ? '' : 's'}
                </span>
              </h3>
              <ul className="flex list-none flex-col divide-y divide-edge-subtle p-0">
                {a.chains.map((c) => (
                  <ChainRow key={c.id} chain={c} health={health} cheaper={cheaperIds.has(c.id)} onOpen={(x) => onOpen(x.id)} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-2xs text-fg-muted">
            Every change is recorded on <Link to="/providers?tab=history" className="font-semibold text-accent">History</Link>.
          </p>
        </section>
      )}
    </div>
  )
}
