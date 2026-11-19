/**
 * FILE: apps/admin/src/components/providers/RoutesPanel.tsx
 * PURPOSE: The Routes tab: per app → feature ('*' shown as "default"), the
 *          ordered chain of candidates the router tries, best first. Each
 *          candidate: priority, provider chip, model, its provider's state
 *          (a down provider is struck and tried last), on/off, params chips.
 *          Controls: ↑/↓ reorder, on/off, switch model (priced models only),
 *          delete (confirmed), add a candidate. A change that would leave the
 *          app with no enabled default is disabled before it can 409.
 */

import { useState } from 'react'
import type { AiRoute, ModelPrice, OpsMeta, RouteParams } from '../../lib/kensaurusOpsTypes'
import {
  LAST_DEFAULT_HINT,
  chainSignature,
  featureLabel,
  groupRoutes,
  nextFreePriority,
  paramChips,
  paramChoices,
  paramFieldsFor,
  pricedModels,
  PROVIDER_STATUS,
  routeKey,
  wouldDropLastDefault,
  type FeatureChain,
} from '../../lib/providersView'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn, Toggle } from '../ui'
import { IconTrash } from '../icons'
import { Chip } from '../signal/Chip'
import { StatusMark } from '../signal/StatusMark'

export const routePendingKey = (r: { app: string; feature: string; priority: number }) => `route:${routeKey(r)}`
export const featurePendingKey = (app: string, feature: string) => `feature:${app}|${feature}`

export interface NewRoute {
  provider: string
  model: string
  priority: number
  params?: RouteParams
}

export interface RoutesPanelProps {
  routes: readonly AiRoute[]
  meta: OpsMeta | null
  prices: readonly ModelPrice[]
  pending: ReadonlySet<string>
  onToggle: (route: AiRoute, enabled: boolean) => void
  onMove: (chain: FeatureChain, index: number, dir: -1 | 1) => void
  onDelete: (route: AiRoute) => void
  onSwitchModel: (route: AiRoute, model: string) => void
  onAdd: (app: string, feature: string, route: NewRoute) => void
  /** The console's app name for an ops-registry app slug (makeAppNamer); the slug on hover. */
  appName?: (app: string) => string
}

const ICON_BTN =
  'inline-flex h-6 w-6 items-center justify-center rounded-sm border border-edge-subtle bg-surface-raised text-2xs font-bold text-fg-secondary ' +
  'hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const SELECT = 'rounded-sm border border-edge-subtle bg-surface-raised px-1 py-0.5 text-2xs text-fg disabled:opacity-50'

function ParamsFields({ meta, provider, value, onChange }: { meta: OpsMeta | null; provider: string; value: RouteParams; onChange: (p: RouteParams) => void }) {
  const fields = paramFieldsFor(meta, provider)
  const set = (k: string, v: unknown) => {
    const next = { ...value }
    if (v === '' || v == null) delete next[k]
    else next[k] = v
    onChange(next)
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="route-params-fields">
      {fields.map((k) => {
        if (k === 'thinking') {
          const spec = meta?.route_params?.thinking as { type?: unknown } | undefined
          const types = Array.isArray(spec?.type) ? (spec.type as string[]) : []
          const t = value.thinking
          return (
            <span key={k} className="inline-flex items-center gap-1">
              <select
                aria-label="thinking"
                className={SELECT}
                value={t?.type ?? ''}
                onChange={(e) => set('thinking', e.target.value ? { type: e.target.value, ...(t?.budget_tokens ? { budget_tokens: t.budget_tokens } : {}) } : null)}
              >
                <option value="">thinking</option>
                {types.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              {t?.type === 'enabled' && (
                <input
                  aria-label="thinking budget_tokens"
                  className={`${SELECT} w-20`}
                  inputMode="numeric"
                  placeholder="budget"
                  value={t.budget_tokens ?? ''}
                  onChange={(e) => set('thinking', { type: 'enabled', ...(e.target.value ? { budget_tokens: Number(e.target.value) } : {}) })}
                />
              )}
            </span>
          )
        }
        const choices = paramChoices(meta, k)
        if (choices) {
          return (
            <select key={k} aria-label={k} className={SELECT} value={String(value[k] ?? '')} onChange={(e) => set(k, e.target.value)}>
              <option value="">{k}</option>
              {choices.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )
        }
        const numeric = k === 'max_output_tokens' || k === 'temperature'
        return (
          <input
            key={k}
            aria-label={k}
            className={`${SELECT} w-28`}
            placeholder={k}
            inputMode={numeric ? 'decimal' : undefined}
            value={value[k] == null ? '' : String(value[k])}
            onChange={(e) => set(k, numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          />
        )
      })}
    </div>
  )
}

/** The add-a-candidate form under a chain. */
function AddCandidate({
  meta,
  prices,
  priority,
  busy,
  onAdd,
}: {
  meta: OpsMeta | null
  prices: readonly ModelPrice[]
  priority: number | null
  busy: boolean
  onAdd: (route: NewRoute) => void
}) {
  const providers = meta?.route_providers ?? []
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState(providers[0] ?? '')
  const models = pricedModels(prices, provider)
  const [model, setModel] = useState('')
  const [params, setParams] = useState<RouteParams>({})
  if (priority == null) return null
  if (!open) {
    return (
      <button type="button" className={`${ICON_BTN} w-auto px-1.5`} onClick={() => setOpen(true)} disabled={busy} aria-label="Add a candidate" title="Add a candidate">
        + add
      </button>
    )
  }
  const chosen = models.includes(model) ? model : (models[0] ?? '')
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-dashed border-edge px-1.5 py-1" data-testid="add-candidate">
      <Chip>#{priority}</Chip>
      <select
        aria-label="Provider"
        className={SELECT}
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value)
          setModel('')
          setParams({})
        }}
      >
        {providers.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {models.length === 0 ? (
        <span className="text-3xs text-warn-foreground">No priced model: add a price in Kenji first</span>
      ) : (
        <select aria-label="Model" className={SELECT} value={chosen} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      <ParamsFields meta={meta} provider={provider} value={params} onChange={setParams} />
      <Btn
        size="sm"
        variant="primary"
        disabled={!chosen || busy}
        onClick={() => {
          onAdd({ provider, model: chosen, priority, ...(Object.keys(params).length > 0 ? { params } : {}) })
          setOpen(false)
          setParams({})
        }}
      >
        Add
      </Btn>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Btn>
    </div>
  )
}

function Candidate({
  route,
  index,
  chain,
  routes,
  prices,
  pending,
  onToggle,
  onMove,
  onAskDelete,
  onSwitchModel,
}: {
  route: AiRoute
  index: number
  chain: FeatureChain
  routes: readonly AiRoute[]
  prices: readonly ModelPrice[]
  pending: ReadonlySet<string>
  onToggle: RoutesPanelProps['onToggle']
  onMove: RoutesPanelProps['onMove']
  onAskDelete: (route: AiRoute) => void
  onSwitchModel: RoutesPanelProps['onSwitchModel']
}) {
  const busy = pending.has(routePendingKey(route)) || pending.has(featurePendingKey(route.app, route.feature))
  const guarded = route.enabled && wouldDropLastDefault(routes, route)
  const down = route.provider_state === 'down'
  const models = pricedModels(prices, route.provider)
  const options = models.includes(route.model) ? models : [route.model, ...models]
  const chips = paramChips(route.params)
  return (
    // A candidate is a column in the chain row, not a card of its own (one level of card).
    <li
      className={`flex min-w-0 flex-col gap-1 py-0.5 ${route.enabled ? '' : 'opacity-60'}`}
      data-testid={`route-${routeKey(route)}`}
      data-enabled={route.enabled ? 'true' : 'false'}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-2xs font-extrabold text-fg-secondary tabular-nums">#{route.priority}</span>
        <StatusMark status={PROVIDER_STATUS[route.provider_state]} label={route.provider_state} />
        <Chip>{route.provider}</Chip>
        {down && <Chip tone="danger">tried last</Chip>}
        {busy && (
          <span role="status" aria-label="Saving" data-testid="pending-mark">
            <StatusMark status="running" />
          </span>
        )}
      </span>
      {/* The model shows once: the switcher is its name. */}
      <select
        aria-label={`Switch model for #${route.priority}`}
        className={`${SELECT} max-w-48 font-mono text-xs font-bold ${down ? 'line-through decoration-danger decoration-2' : ''}`}
        value={route.model}
        title={route.note ?? route.model}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value !== route.model) onSwitchModel(route, e.target.value)
        }}
        data-testid="switch-model"
      >
        {options.map((m) => (
          <option key={m} value={m} disabled={!models.includes(m)}>
            {m}
          </option>
        ))}
      </select>
      {chips.length > 0 && (
        <span className="flex flex-wrap gap-1" data-testid="route-param-chips">
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1">
        <button type="button" className={ICON_BTN} aria-label="Move up" title="Try earlier" disabled={busy || index === 0} onClick={() => onMove(chain, index, -1)}>
          ↑
        </button>
        <button
          type="button"
          className={ICON_BTN}
          aria-label="Move down"
          title="Try later"
          disabled={busy || index === chain.routes.length - 1}
          onClick={() => onMove(chain, index, 1)}
        >
          ↓
        </button>
        <span title={guarded ? LAST_DEFAULT_HINT : undefined} data-testid="route-toggle-wrap" data-guarded={guarded ? 'true' : undefined}>
          <Toggle
            ariaLabel={`${route.enabled ? 'Turn off' : 'Turn on'} ${route.model}`}
            checked={route.enabled}
            disabled={busy || guarded}
            tooltip={guarded ? LAST_DEFAULT_HINT : undefined}
            onChange={(next) => onToggle(route, next)}
          />
        </span>
        <button
          type="button"
          className={`${ICON_BTN} hover:border-danger hover:text-danger`}
          aria-label={`Delete #${route.priority}`}
          title={guarded ? LAST_DEFAULT_HINT : 'Delete'}
          disabled={busy || guarded}
          onClick={() => onAskDelete(route)}
        >
          <IconTrash size={12} />
        </button>
      </span>
    </li>
  )
}

export function RoutesPanel(props: RoutesPanelProps) {
  const { routes, meta, prices, pending, onDelete, onAdd } = props
  const appName = props.appName ?? ((a: string) => a)
  const [confirm, setConfirm] = useState<AiRoute | null>(null)
  const groups = groupRoutes(routes)
  // The first chain of each shape, in page order: later identical chains fold under it.
  const firstWithShape = new Map<string, FeatureChain>()
  for (const g of groups) for (const c of g.features) if (!firstWithShape.has(chainSignature(c))) firstWithShape.set(chainSignature(c), c)
  if (groups.length === 0) return <p className="text-xs text-fg-muted">No routes yet.</p>
  return (
    <div className="flex flex-col gap-3" data-testid="providers-routes">
      {groups.map((g) => (
        <section key={g.app} aria-label={`${appName(g.app)} routes`} className="rounded-md border border-edge">
          {/* App names, as on every other page; the registry slug on hover (round 3). */}
          <h3 className="border-b border-edge-subtle bg-surface-overlay px-2.5 py-1 text-xs font-bold text-fg" title={g.app}>
            {appName(g.app)}
          </h3>
          <div className="flex flex-col divide-y divide-edge-subtle">
            {g.features.map((chain) => {
              const same = firstWithShape.get(chainSignature(chain))
              const twin = same && same !== chain ? same : null
              const body = (
                <ol className="flex list-none flex-wrap items-start gap-x-4 gap-y-1.5 p-0" aria-label={`${g.app} ${featureLabel(chain.feature)}: candidates in order`}>
                  {chain.routes.map((r, i) => (
                    <Candidate
                      key={routeKey(r)}
                      route={r}
                      index={i}
                      chain={chain}
                      routes={routes}
                      prices={prices}
                      pending={pending}
                      onToggle={props.onToggle}
                      onMove={props.onMove}
                      onAskDelete={setConfirm}
                      onSwitchModel={props.onSwitchModel}
                    />
                  ))}
                  <li className="flex items-center self-center">
                    <AddCandidate
                      meta={meta}
                      prices={prices}
                      priority={nextFreePriority(chain.routes, meta)}
                      busy={pending.has(featurePendingKey(g.app, chain.feature))}
                      onAdd={(nr) => onAdd(g.app, chain.feature, nr)}
                    />
                  </li>
                </ol>
              )
              const title = (
                <>
                  {/* Never broken at its hyphen ("scan-/receipt" at 390, round 3). */}
                  <span className={`text-2xs font-bold whitespace-nowrap ${chain.feature === '*' ? 'text-fg' : 'text-fg-secondary'}`}>{featureLabel(chain.feature)}</span>
                  <span className="text-3xs whitespace-nowrap text-fg-muted">{chain.routes.length} tried in order</span>
                </>
              )
              return (
                <div
                  key={chain.feature}
                  className="flex flex-col gap-1.5 px-2.5 py-2"
                  data-testid={`chain-${g.app}-${chain.feature}`}
                  data-same-as={twin ? `${twin.app}|${twin.feature}` : undefined}
                >
                  {twin ? (
                    // The same chain as one above: one line; open it to edit this one.
                    <details>
                      <summary className="flex cursor-pointer items-center gap-1.5">
                        {title}
                        <span className="text-3xs whitespace-nowrap text-fg-secondary">
                          same as {appName(twin.app)} › {featureLabel(twin.feature)}
                        </span>
                      </summary>
                      <div className="pt-1.5">{body}</div>
                    </details>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5">{title}</span>
                      {body}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.model}?`}
          body={`${confirm.app} › ${featureLabel(confirm.feature)} › #${confirm.priority}. The router stops trying it within a minute.`}
          confirmLabel="Delete"
          tone="danger"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onDelete(confirm)
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}
